import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers, isUserActiveInChat, isUserOnline } from "@/lib/realtime";
import { getAttachmentRule, normalizeAttachmentMimeType, saveObject } from "@/lib/storage";
import { checkRateLimit } from "@/lib/rate-limit";

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";
const MEDIA_KEY_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES-GCM-MEDIA-KEY";

const mediaKeyEnvelopeSchema = z.object({
  recipientUserId: z.string().uuid(),
  recipientDeviceId: z.string().min(8).max(120),
  senderDeviceId: z.string().min(8).max(120),
  encryptedMediaKey: z.string().min(1).max(2_048),
  iv: z.string().min(16).max(64),
  salt: z.string().min(16).max(128),
  algorithm: z.literal(MEDIA_KEY_ALGORITHM),
  encryptionVersion: z.literal(1),
});

type MediaKeyEnvelopeInput = z.infer<typeof mediaKeyEnvelopeSchema>;

function logRealtime(label: string, data: Record<string, unknown>) {
  if (!DEBUG_REALTIME) {
    return;
  }

  console.log(`[realtime-server] ${label}`, data);
}

function filterAttachmentEnvelopesForUser<T extends { attachments: { mediaKeyEnvelopes?: { recipientUserId: string }[] }[] }>(
  message: T,
  userId: string,
): T {
  return {
    ...message,
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
      mediaKeyEnvelopes: attachment.mediaKeyEnvelopes?.filter((envelope) => envelope.recipientUserId === userId) ?? [],
    })),
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(request, `attachments:create:${user.id}`, { limit: 30, windowMs: 5 * 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Слишком много файлов. Подождите немного." }, { status: 429 });
  }

  const { chatId } = await context.params;
  const membership = await requireActiveChatMembership(chatId, user.id);

  if (!membership) {
    return NextResponse.json({ error: "Чат не найден." }, { status: 404 });
  }

  if (membership.chat.isLocked && !isChatAdminRole(membership.role)) {
    return NextResponse.json({ error: "Чат закрыт." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const body = formData?.get("body") as string | null;
  const encrypted = formData?.get("encrypted") === "true";
  const mediaEncryptionVersion = Number(formData?.get("mediaEncryptionVersion") ?? 0);
  const fileIv = formData?.get("fileIv") as string | null;
  const fileAlgorithm = formData?.get("fileAlgorithm") as string | null;
  const senderDeviceId = formData?.get("senderDeviceId") as string | null;
  const envelopesRaw = formData?.get("mediaKeyEnvelopes") as string | null;
  const clientMimeType = (formData?.get("clientMimeType") as string | null) || (file instanceof File ? file.type : "");
  const originalSizeBytes = Number(formData?.get("originalSizeBytes") ?? 0);
  const isVideoNote = (formData?.get("videoNote") as string | null) === "true";

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Выберите файл." }, { status: 400 });
  }

  const prisma = getPrisma();
  const activeMembers = await prisma.chatMember.findMany({
    where: {
      chatId,
      status: "ACTIVE",
    },
    select: {
      userId: true,
      mutedUntil: true,
    },
  });

  const directPeerUserId = membership.chat.type === "DIRECT"
    ? activeMembers.find((member) => member.userId !== user.id)?.userId ?? null
    : null;
  const requiresEncryptedMedia = membership.chat.type === "DIRECT";

  if (requiresEncryptedMedia && !encrypted) {
    return NextResponse.json({ error: "Direct media messages must be encrypted" }, { status: 400 });
  }

  if (encrypted && body?.trim()) {
    return NextResponse.json({ error: "Подписи к зашифрованным медиа пока не поддержаны." }, { status: 400 });
  }

  const rule = getAttachmentRule(clientMimeType);
  const normalizedMimeType = normalizeAttachmentMimeType(clientMimeType);

  if (!rule) {
    return NextResponse.json({ error: "Тип файла не разрешён." }, { status: 400 });
  }

  const plainSizeBytes = encrypted ? originalSizeBytes : file.size;
  if (
    !Number.isFinite(plainSizeBytes) ||
    plainSizeBytes <= 0 ||
    plainSizeBytes > rule.maxSizeBytes ||
    file.size <= 0 ||
    file.size > rule.maxSizeBytes + 1024 * 1024
  ) {
    return NextResponse.json({ error: "Размер файла не разрешён." }, { status: 400 });
  }

  let mediaKeyEnvelopes: MediaKeyEnvelopeInput[] = [];
  if (encrypted) {
    if (mediaEncryptionVersion !== 1 || !fileIv || !fileAlgorithm || !senderDeviceId || !envelopesRaw) {
      return NextResponse.json({ error: "Некорректные параметры шифрования медиа." }, { status: 400 });
    }

    try {
      const parsed = z.array(mediaKeyEnvelopeSchema).min(1).max(64).safeParse(JSON.parse(envelopesRaw));
      if (!parsed.success) throw new Error("invalid-envelopes");
      mediaKeyEnvelopes = parsed.data;
    } catch {
      return NextResponse.json({ error: "Некорректные media key envelopes." }, { status: 400 });
    }

    if (mediaKeyEnvelopes.length === 0) {
      return NextResponse.json({ error: "Некорректные media key envelopes." }, { status: 400 });
    }

    const allowedUserIds = new Set(activeMembers.map((member) => member.userId));
    allowedUserIds.add(user.id);
    if (directPeerUserId) allowedUserIds.add(directPeerUserId);

    const deviceIds = Array.from(new Set(mediaKeyEnvelopes.map((envelope) => envelope.recipientDeviceId).concat(senderDeviceId)));
    const deviceBundles = await prisma.deviceKeyBundle.findMany({
      where: {
        deviceId: { in: deviceIds },
        revokedAt: null,
        userDevice: { revokedAt: null },
      },
      select: { deviceId: true, userId: true },
    });
    const deviceOwnerById = new Map(deviceBundles.map((device) => [device.deviceId, device.userId]));

    if (deviceOwnerById.get(senderDeviceId) !== user.id) {
      return NextResponse.json({ error: "Invalid sender device" }, { status: 400 });
    }

    for (const envelope of mediaKeyEnvelopes) {
      const ownerId = deviceOwnerById.get(envelope.recipientDeviceId);
      if (!ownerId || ownerId !== envelope.recipientUserId || !allowedUserIds.has(ownerId)) {
        return NextResponse.json({ error: "Envelope recipient device is not allowed" }, { status: 400 });
      }
      if (
        envelope.senderDeviceId !== senderDeviceId ||
        envelope.algorithm !== MEDIA_KEY_ALGORITHM ||
        envelope.encryptionVersion !== 1 ||
        !envelope.encryptedMediaKey ||
        !envelope.iv ||
        !envelope.salt
      ) {
        return NextResponse.json({ error: "Invalid media key envelope metadata" }, { status: 400 });
      }
    }

    if (directPeerUserId && !mediaKeyEnvelopes.some((envelope) => envelope.recipientUserId === directPeerUserId)) {
      return NextResponse.json({ error: "Missing recipient media key envelope" }, { status: 400 });
    }
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const { storageKey } = await saveObject(fileBuffer);

  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        chatId,
        senderUserId: user.id,
        type: isVideoNote && rule.kind === "VIDEO" ? "VIDEO_NOTE" : rule.kind,
        body: encrypted ? null : body || null,
        isEncrypted: encrypted,
        encryptionVersion: encrypted ? 2 : 0,
        senderKeyId: encrypted ? senderDeviceId : null,
        expiresAt: membership.chat.disappearingSeconds
          ? new Date(Date.now() + membership.chat.disappearingSeconds * 1000)
          : null,
        receipts: {
          create: activeMembers
            .filter((member) => member.userId !== user.id)
            .map((member) => ({ userId: member.userId })),
        },
        attachments: {
          create: {
            uploaderUserId: user.id,
            storageKey,
            fileName: encrypted ? "encrypted-file" : file.name || "file",
            mimeType: normalizedMimeType,
            sizeBytes: plainSizeBytes,
            encryptedSizeBytes: encrypted ? file.size : null,
            isEncrypted: encrypted,
            mediaEncryptionVersion: encrypted ? 1 : null,
            fileIv: encrypted ? fileIv : null,
            fileAlgorithm: encrypted ? fileAlgorithm : null,
            mediaKeyEnvelopes: encrypted
              ? {
                  create: mediaKeyEnvelopes.map((envelope) => ({
                    recipientUserId: envelope.recipientUserId,
                    recipientDeviceId: envelope.recipientDeviceId,
                    senderDeviceId: envelope.senderDeviceId,
                    encryptedMediaKey: envelope.encryptedMediaKey,
                    iv: envelope.iv,
                    salt: envelope.salt,
                    algorithm: envelope.algorithm,
                    encryptionVersion: envelope.encryptionVersion,
                  })),
                }
              : undefined,
          },
        },
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        attachments: {
          select: {
            id: true,
            fileName: true,
            mimeType: true,
            sizeBytes: true,
            encryptedSizeBytes: true,
            isEncrypted: true,
            mediaEncryptionVersion: true,
            fileIv: true,
            fileAlgorithm: true,
            mediaKeyEnvelopes: {
              select: {
                id: true,
                recipientUserId: true,
                recipientDeviceId: true,
                senderDeviceId: true,
                encryptedMediaKey: true,
                iv: true,
                salt: true,
                algorithm: true,
                encryptionVersion: true,
                deliveredAt: true,
                revokedAt: true,
              },
            },
          },
        },
        replyToMessage: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                profile: { select: { displayName: true } },
              },
            },
          },
        },
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profile: { select: { displayName: true } },
              },
            },
          },
        },
        receipts: {
          select: {
            userId: true,
            deliveredAt: true,
            readAt: true,
          },
        },
      },
    });

    await tx.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    await tx.chatMember.updateMany({
      where: {
        chatId,
        status: "ACTIVE",
      },
      data: {
        deletedAt: null,
      },
    });

    return createdMessage;
  });

  logRealtime("message created", { messageId: message.id, chatId, senderId: user.id, type: message.type });
  for (const member of activeMembers) {
    emitToUsers([member.userId], "message:new", {
      chatId,
      message: filterAttachmentEnvelopesForUser(message, member.userId),
    });
  }
  logRealtime("emitting message:new", { chatId, messageId: message.id });
  emitToUsers(
    activeMembers.map((member) => member.userId),
    "chat:updated",
    { chatId },
  );

  // Send Push Notifications (non-blocking)
  const recipients = activeMembers
    .map((m) => m.userId)
    .filter((id) => id !== user.id)
    .filter((id) => {
      const member = activeMembers.find((activeMember) => activeMember.userId === id);
      const muted = member?.mutedUntil && member.mutedUntil > new Date();
      if (muted) {
        return false;
      }
      return !isUserOnline(id) || !isUserActiveInChat(id, chatId);
    });

  if (recipients.length > 0) {
    const { sendPushToUsers } = await import("@/lib/push");
    const senderName = message.sender.profile?.displayName || message.sender.username;
    
    let bodyPreview = "Вложение";
    if (message.type === "IMAGE") bodyPreview = "Фотография";
    if (message.type === "VIDEO") bodyPreview = "Видео";
    if (message.type === "VIDEO_NOTE") bodyPreview = "Видеосообщение";
    if (message.type === "VOICE") bodyPreview = "Голосовое сообщение";
    if (message.type === "FILE") bodyPreview = encrypted ? "Файл" : `Файл: ${file.name}`;

    sendPushToUsers(recipients, {
      title: senderName,
      body: bodyPreview,
      url: `/chats/${chatId}`,
      type: "message",
      chatId,
      tag: `chat:${chatId}`,
    }).catch(err => console.error("Push failed:", err));
  }

  return NextResponse.json({ message: filterAttachmentEnvelopesForUser(message, user.id) }, { status: 201 });
}
