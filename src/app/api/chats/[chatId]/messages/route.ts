import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat, emitToUser, emitToUsers, isUserActiveInChat, isUserOnline } from "@/lib/realtime";
import { checkBlockStatus } from "@/lib/contacts";

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";

function logRealtime(label: string, data: Record<string, unknown>) {
  if (!DEBUG_REALTIME) return;
  console.log(`[realtime-server] ${label}`, data);
}

const envelopeSchema = z.object({
  recipientUserId: z.string().uuid(),
  recipientDeviceId: z.string().min(8).max(120),
  senderDeviceId: z.string().min(8).max(120),
  ciphertext: z.string().trim().min(1),
  iv: z.string().trim().min(1),
  salt: z.string().trim().min(1),
  algorithm: z.string().trim().min(1),
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
  envelopes: z.array(envelopeSchema).optional(),
  ciphertext: z.string().trim().min(1).optional(),
  iv: z.string().trim().min(1).optional(),
  salt: z.string().trim().min(1).optional(),
  algorithm: z.string().trim().min(1).optional(),
  senderKeyId: z.string().trim().min(1).max(160).optional(),
});

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
  attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
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
    },
  },
} as const;

type MessageWithEnvelopes = {
  envelopes?: { recipientUserId: string }[];
};

function filterMessageEnvelopesForUser<T extends MessageWithEnvelopes>(message: T, userId: string): T {
  return {
    ...message,
    envelopes: message.envelopes?.filter((envelope) => envelope.recipientUserId === userId) ?? [],
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const { chatId } = await context.params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) return NextResponse.json({ error: "Чат не найден." }, { status: 404 });

  const prisma = getPrisma();
  const messages = await prisma.message.findMany({
    where: { chatId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: messageInclude,
  });

  return NextResponse.json({
    messages: messages.reverse().map((message) => filterMessageEnvelopesForUser(message, user.id)),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const { chatId } = await context.params;
  const prisma = getPrisma();
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) return NextResponse.json({ error: "Чат не найден." }, { status: 404 });

  if (membership.chat.isLocked && !isChatAdminRole(membership.role)) {
    return NextResponse.json({ error: "Чат закрыт." }, { status: 403 });
  }

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

    const message = await prisma.message.create({
      data: {
        chatId,
        senderUserId: user.id,
        type: "TEXT",
        body: null,
        isEncrypted: true,
        encryptionVersion: 2,
        senderKeyId: parsed.data.senderDeviceId,
        replyToMessageId: parsed.data.replyToMessageId,
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

  const message = await prisma.message.create({
    data: {
      chatId,
      senderUserId: user.id,
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
      expiresAt: isEncrypted ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) : null,
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
