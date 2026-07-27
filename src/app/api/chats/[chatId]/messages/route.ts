import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat, emitToUser, emitToUsers, isUserActiveInChat, isUserOnline } from "@/lib/realtime";
import { checkBlockStatus } from "@/lib/contacts";
import { checkRateLimit } from "@/lib/rate-limit";

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";

function logRealtime(label: string, data: Record<string, unknown>) {
  if (!DEBUG_REALTIME) return;
  console.log(`[realtime-server] ${label}`, data);
}

const envelopeSchema = z.object({
  recipientUserId: z.string().uuid(),
  recipientDeviceId: z.string().min(8).max(120),
  senderDeviceId: z.string().min(8).max(120),
  ciphertext: z.string().trim().min(1).max(16_384),
  iv: z.string().trim().min(16).max(64),
  salt: z.string().trim().min(16).max(128),
  algorithm: z.string().trim().min(1).max(120),
  encryptionVersion: z.literal(2),
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000).optional(),
  replyToMessageId: z.string().uuid().optional(),
  clientId: z.string().min(1).max(100).optional(),
  encrypted: z.boolean().optional(),
  isEncrypted: z.boolean().optional(),
  type: z.literal("TEXT").optional(),
  encryptionVersion: z.number().int().positive().optional(),
  senderDeviceId: z.string().min(8).max(120).optional(),
  envelopes: z.array(envelopeSchema).min(1).max(64).optional(),
  ciphertext: z.string().trim().min(1).max(16_384).optional(),
  iv: z.string().trim().min(16).max(64).optional(),
  salt: z.string().trim().min(16).max(128).optional(),
  algorithm: z.string().trim().min(1).max(120).optional(),
  senderKeyId: z.string().trim().min(1).max(160).optional(),
});

/**
 * Returns the message this sender already committed for `clientMessageId`, if
 * any. Sending is idempotent on (senderUserId, clientMessageId): a retry after
 * a lost response must return the original message rather than create a second
 * one. Without this the client cannot safely retry at all.
 */
async function findExistingByClientId(
  prisma: ReturnType<typeof getPrisma>,
  senderUserId: string,
  clientMessageId: string | null | undefined,
) {
  if (!clientMessageId) return null;
  return prisma.message.findUnique({
    where: { senderUserId_clientMessageId: { senderUserId, clientMessageId } },
    include: messageInclude,
  });
}

const DIRECT_E2EE_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES-GCM";
const PLAINTEXT_FIELDS = ["body", "content", "text", "message"] as const;

function getPlaintextFields(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  return PLAINTEXT_FIELDS.filter((field) => {
    const value = (payload as Record<string, unknown>)[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

const messageInclude = {
  sender: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
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
          createdAt: true,
          deliveredAt: true,
          revokedAt: true,
        },
      },
    },
  },
  replyToMessage: {
    include: { sender: { select: { id: true, username: true, profile: { select: { displayName: true } } } } },
  },
  reactions: { include: { user: { select: { id: true, username: true, profile: { select: { displayName: true } } } } } },
  receipts: { select: { userId: true, deliveredAt: true, readAt: true } },
  envelopes: {
    select: {
      id: true,
      recipientUserId: true,
      recipientDeviceId: true,
      senderDeviceId: true,
      ciphertext: true,
      iv: true,
      salt: true,
      algorithm: true,
      encryptionVersion: true,
      createdAt: true,
      deliveredAt: true,
      readAt: true,
      encryptedPayloadDeletedAt: true,
    },
  },
} as const;

type MessageWithEnvelopes = {
  envelopes?: { recipientUserId: string }[];
  attachments?: { mediaKeyEnvelopes?: { recipientUserId: string }[] }[];
};

function filterMessageEnvelopesForUser<T extends MessageWithEnvelopes>(message: T, userId: string): T {
  return {
    ...message,
    envelopes: message.envelopes?.filter((envelope) => envelope.recipientUserId === userId) ?? [],
    attachments: message.attachments?.map((attachment) => ({
      ...attachment,
      mediaKeyEnvelopes: attachment.mediaKeyEnvelopes?.filter((envelope) => envelope.recipientUserId === userId) ?? [],
    })),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const { chatId } = await context.params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) return NextResponse.json({ error: "Чат не найден." }, { status: 404 });

  // Cursor pagination for "load older". `before` is the oldest message id the
  // client already has; we return up to `limit` messages older than it. Without
  // `before` this returns the latest page (unchanged initial-load behavior).
  // Optimistic temp- ids are never valid cursors.
  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before");
  const cursorId = beforeParam && !beforeParam.startsWith("temp-") ? beforeParam : null;
  // `Number(null)` is 0, not NaN, so an absent `limit` used to clamp to 1 and
  // the history refresh returned a single message — which is what made the
  // conversation look emptied after leaving and coming back.
  const limitParam = url.searchParams.get("limit");
  const parsedLimit = limitParam === null ? Number.NaN : Number(limitParam);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
    ? Math.min(Math.max(Math.trunc(parsedLimit), 1), 50)
    : 50;

  const prisma = getPrisma();
  // History loads only need THIS user's envelopes. Filter at the DB instead of
  // fetching every recipient/device envelope and discarding them in JS — a real
  // payload/latency win in group chats with many devices.
  const historyInclude = {
    ...messageInclude,
    attachments: {
      select: {
        ...messageInclude.attachments.select,
        mediaKeyEnvelopes: {
          ...messageInclude.attachments.select.mediaKeyEnvelopes,
          where: { recipientUserId: user.id },
        },
      },
    },
    envelopes: {
      ...messageInclude.envelopes,
      where: { recipientUserId: user.id },
    },
  };

  const rows = await prisma.message.findMany({
    where: {
      chatId,
      deletedAt: null,
      ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
      // Hide disappearing messages whose timer has elapsed.
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Fetch one extra row to know whether older history exists.
    take: limit + 1,
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    include: historyInclude,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return NextResponse.json({
    messages: page.reverse().map((message) => filterMessageEnvelopesForUser(message, user.id)),
    hasMore,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const rateLimit = checkRateLimit(request, `messages:create:${user.id}`, { limit: 120, windowMs: 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Слишком много сообщений. Подождите немного." }, { status: 429 });
  }

  const { chatId } = await context.params;
  const prisma = getPrisma();
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) return NextResponse.json({ error: "Чат не найден." }, { status: 404 });

  if (membership.chat.isLocked && !isChatAdminRole(membership.role)) {
    return NextResponse.json({ error: "Чат закрыт." }, { status: 403 });
  }

  // Per-chat disappearing-messages timer (seconds). When set, every new message
  // gets an expiry and is hidden once it elapses.
  const disappearingSeconds = membership.chat.disappearingSeconds;
  const disappearingExpiry = disappearingSeconds && disappearingSeconds > 0
    ? new Date(Date.now() + disappearingSeconds * 1000)
    : null;

  let directPeerUserId: string | null = null;
  if (membership.chat.type === "DIRECT") {
    const otherMember = await prisma.chatMember.findFirst({
      where: { chatId, userId: { not: user.id }, status: "ACTIVE" },
      select: { userId: true },
    });
    directPeerUserId = otherMember?.userId ?? null;
    if (otherMember && await checkBlockStatus(user.id, otherMember.userId)) {
      return NextResponse.json({ error: "Вы не можете отправить сообщение этому пользователю." }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Некорректное сообщение." }, { status: 400 });

  const isEncrypted = parsed.data.encrypted === true || parsed.data.isEncrypted === true;
  const plaintextFields = getPlaintextFields(body);
  const requiresDirectEncryption = membership.chat.type === "DIRECT" && Boolean(directPeerUserId);
  const isV2 = isEncrypted && parsed.data.encryptionVersion === 2;

  if (isEncrypted && plaintextFields.length > 0) {
    return NextResponse.json({ error: "Зашифрованное сообщение не должно содержать текст в открытом виде." }, { status: 400 });
  }

  if (requiresDirectEncryption && !isEncrypted) {
    return NextResponse.json({ error: "Direct text messages must be encrypted" }, { status: 400 });
  }

  if (requiresDirectEncryption && !isV2) {
    return NextResponse.json({ error: "Direct text messages must use device envelopes" }, { status: 400 });
  }

  if (isV2) {
    if (!parsed.data.senderDeviceId || !parsed.data.envelopes?.length) {
      return NextResponse.json({ error: "Некорректные encrypted envelopes." }, { status: 400 });
    }

    if (parsed.data.replyToMessageId) {
      const replyTarget = await prisma.message.findUnique({
        where: { id: parsed.data.replyToMessageId },
        select: { id: true, chatId: true },
      });

      if (!replyTarget || replyTarget.chatId !== chatId) {
        return NextResponse.json({ error: "Нельзя ответить на сообщение из другого чата." }, { status: 400 });
      }
    }

    const activeMembers = await prisma.chatMember.findMany({
      where: { chatId, status: "ACTIVE" },
      select: { userId: true, mutedUntil: true },
    });
    const allowedUserIds = new Set(activeMembers.map((member) => member.userId));
    if (directPeerUserId) allowedUserIds.add(directPeerUserId);
    allowedUserIds.add(user.id);

    const deviceIds = Array.from(new Set(parsed.data.envelopes.map((envelope) => envelope.recipientDeviceId).concat(parsed.data.senderDeviceId)));
    const deviceBundles = await prisma.deviceKeyBundle.findMany({
      where: {
        deviceId: { in: deviceIds },
        revokedAt: null,
        userDevice: { revokedAt: null },
      },
      select: { deviceId: true, userId: true },
    });
    const deviceOwnerById = new Map(deviceBundles.map((device) => [device.deviceId, device.userId]));

    if (deviceOwnerById.get(parsed.data.senderDeviceId) !== user.id) {
      return NextResponse.json({ error: "Invalid sender device" }, { status: 400 });
    }

    for (const envelope of parsed.data.envelopes) {
      const ownerId = deviceOwnerById.get(envelope.recipientDeviceId);
      if (!ownerId || ownerId !== envelope.recipientUserId || !allowedUserIds.has(ownerId)) {
        return NextResponse.json({ error: "Envelope recipient device is not allowed" }, { status: 400 });
      }
      if (envelope.senderDeviceId !== parsed.data.senderDeviceId || envelope.algorithm !== DIRECT_E2EE_ALGORITHM) {
        return NextResponse.json({ error: "Invalid envelope metadata" }, { status: 400 });
      }
    }

    if (!parsed.data.envelopes.some((envelope) => envelope.recipientUserId === directPeerUserId)) {
      return NextResponse.json({ error: "Missing recipient envelope" }, { status: 400 });
    }

    const alreadyCommitted = await findExistingByClientId(prisma, user.id, parsed.data.clientId);
    if (alreadyCommitted) {
      // Idempotent replay: no second Message, no second envelopes, no second
      // socket event — just the canonical result the client missed.
      return NextResponse.json({ message: alreadyCommitted, clientId: parsed.data.clientId ?? null }, { status: 200 });
    }

    const message = await prisma.message.create({
      data: {
        chatId,
        senderUserId: user.id,
        clientMessageId: parsed.data.clientId ?? null,
        type: "TEXT",
        body: null,
        isEncrypted: true,
        encryptionVersion: 2,
        senderKeyId: parsed.data.senderDeviceId,
        replyToMessageId: parsed.data.replyToMessageId,
        expiresAt: disappearingExpiry,
        receipts: {
          create: activeMembers.filter((member) => member.userId !== user.id).map((member) => ({ userId: member.userId })),
        },
        envelopes: {
          create: parsed.data.envelopes.map((envelope) => ({
            recipientUserId: envelope.recipientUserId,
            recipientDeviceId: envelope.recipientDeviceId,
            senderDeviceId: envelope.senderDeviceId,
            ciphertext: envelope.ciphertext,
            iv: envelope.iv,
            salt: envelope.salt,
            algorithm: envelope.algorithm,
            encryptionVersion: envelope.encryptionVersion,
          })),
        },
      },
      include: messageInclude,
    });

    await prisma.$transaction([
      prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
      prisma.chatMember.updateMany({ where: { chatId, status: "ACTIVE" }, data: { deletedAt: null } }),
    ]);

    logRealtime("message created", { messageId: message.id, chatId, senderId: user.id });
    for (const member of activeMembers) {
      emitToUser(member.userId, "message:new", {
        chatId,
        message: filterMessageEnvelopesForUser(message, member.userId),
        clientId: parsed.data.clientId ?? null,
      });
    }
    logRealtime("emitting message:new", { chatId, messageId: message.id });
    emitToUsers(activeMembers.map((member) => member.userId), "chat:updated", { chatId });

    const now = new Date();
    const pushRecipients = activeMembers
      .filter((member) => member.userId !== user.id && (!member.mutedUntil || member.mutedUntil < now))
      .map((member) => member.userId)
      .filter((recipientId) => !isUserOnline(recipientId) || !isUserActiveInChat(recipientId, chatId));

    if (pushRecipients.length > 0) {
      const { sendPushToUsers } = await import("@/lib/push");
      const senderName = message.sender.profile?.displayName || message.sender.username;
      sendPushToUsers(pushRecipients, {
        title: senderName,
        body: "Новое сообщение",
        url: `/chats/${chatId}`,
        type: "message",
        chatId,
        tag: `chat:${chatId}`,
      }).catch(() => undefined);
    }

    return NextResponse.json({
      message: filterMessageEnvelopesForUser(message, user.id),
      clientId: parsed.data.clientId ?? null,
    }, { status: 201 });
  }

  if (parsed.data.replyToMessageId) {
    const replyTarget = await prisma.message.findUnique({
      where: { id: parsed.data.replyToMessageId },
      select: { id: true, chatId: true },
    });

    if (!replyTarget || replyTarget.chatId !== chatId) {
      return NextResponse.json({ error: "Нельзя ответить на сообщение из другого чата." }, { status: 400 });
    }
  }

  const activeMembers = await prisma.chatMember.findMany({
    where: { chatId, status: "ACTIVE" },
    select: { userId: true, mutedUntil: true },
  });

  const existing = await findExistingByClientId(prisma, user.id, parsed.data.clientId);
  if (existing) {
    return NextResponse.json({ message: existing, clientId: parsed.data.clientId ?? null }, { status: 200 });
  }

  const message = await prisma.message.create({
    data: {
      chatId,
      senderUserId: user.id,
      clientMessageId: parsed.data.clientId ?? null,
      type: "TEXT",
      body: isEncrypted ? null : parsed.data.body,
      isEncrypted,
      ciphertext: parsed.data.ciphertext,
      iv: parsed.data.iv,
      salt: parsed.data.salt,
      algorithm: parsed.data.algorithm,
      encryptionVersion: parsed.data.encryptionVersion || 0,
      senderKeyId: parsed.data.senderKeyId,
      replyToMessageId: parsed.data.replyToMessageId,
      expiresAt: disappearingExpiry ?? (isEncrypted ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null),
      receipts: {
        create: activeMembers.filter((member) => member.userId !== user.id).map((member) => ({ userId: member.userId })),
      },
    },
    include: messageInclude,
  });

  await prisma.$transaction([
    prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } }),
    prisma.chatMember.updateMany({ where: { chatId, status: "ACTIVE" }, data: { deletedAt: null } }),
  ]);

  logRealtime("message created", { messageId: message.id, chatId, senderId: user.id });
  emitToChat(chatId, "message:new", { chatId, message, clientId: parsed.data.clientId ?? null });
  emitToUsers(activeMembers.map((member) => member.userId), "chat:updated", { chatId });

  return NextResponse.json({ message, clientId: parsed.data.clientId ?? null }, { status: 201 });
}
