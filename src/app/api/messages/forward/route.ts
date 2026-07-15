import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat, emitToUsers, isUserActiveInChat, isUserOnline } from "@/lib/realtime";

const payloadSchema = z.object({
  targetChatId: z.string().uuid(),
  messageIds: z.array(z.string().uuid()).min(1).max(20),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  const prisma = getPrisma();
  const { targetChatId, messageIds } = parsed.data;
  const membership = await requireActiveChatMembership(targetChatId, user.id);
  if (!membership) {
    return NextResponse.json({ error: "Целевой чат недоступен." }, { status: 404 });
  }
  if (membership.chat.isLocked && !isChatAdminRole(membership.role)) {
    return NextResponse.json({ error: "Чат закрыт." }, { status: 403 });
  }

  const sourceMemberships = await prisma.chatMember.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      chat: { messages: { some: { id: { in: messageIds } } } },
    },
    select: { chatId: true, clearedAt: true },
  });
  const visibleSourceScopes = sourceMemberships.map((sourceMembership) => ({
    chatId: sourceMembership.chatId,
    ...(sourceMembership.clearedAt
      ? { createdAt: { gt: sourceMembership.clearedAt } }
      : {}),
  }));

  const sourceMessages = await prisma.message.findMany({
    where: {
      id: { in: messageIds },
      deletedAt: null,
      OR: visibleSourceScopes,
    },
    orderBy: { createdAt: "asc" },
    include: {
      attachments: true,
    },
  });

  if (sourceMessages.length !== messageIds.length) {
    return NextResponse.json({ error: "Не все сообщения доступны для пересылки." }, { status: 400 });
  }

  const activeMembers = await prisma.chatMember.findMany({
    where: {
      chatId: targetChatId,
      status: "ACTIVE",
    },
    select: {
      userId: true,
      mutedUntil: true,
    },
  });

  const createdMessages = await prisma.$transaction(async (tx) => {
    const forwarded = [];

    for (const sourceMessage of sourceMessages) {
      const createdMessage = await tx.message.create({
        data: {
          chatId: targetChatId,
          senderUserId: user.id,
          type: sourceMessage.type,
          body: sourceMessage.body,
          receipts: {
            create: activeMembers
              .filter((member) => member.userId !== user.id)
              .map((member) => ({ userId: member.userId })),
          },
          attachments: sourceMessage.attachments.length > 0
            ? {
                create: sourceMessage.attachments.map((attachment) => ({
                  uploaderUserId: user.id,
                  storageKey: attachment.storageKey,
                  fileName: attachment.fileName,
                  mimeType: attachment.mimeType,
                  sizeBytes: attachment.sizeBytes,
                  width: attachment.width,
                  height: attachment.height,
                  durationSeconds: attachment.durationSeconds,
                  encryptionKeyId: attachment.encryptionKeyId,
                })),
              }
            : undefined,
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

      forwarded.push(createdMessage);
    }

    await tx.chat.update({
      where: { id: targetChatId },
      data: { updatedAt: new Date() },
    });

    await tx.chatMember.updateMany({
      where: {
        chatId: targetChatId,
        status: "ACTIVE",
      },
      data: {
        deletedAt: null,
      },
    });

    return forwarded;
  });

  for (const message of createdMessages) {
    emitToChat(targetChatId, "message:new", { chatId: targetChatId, message, clientId: null });
  }
  emitToUsers(activeMembers.map((member) => member.userId), "chat:updated", { chatId: targetChatId });

  const now = new Date();
  const pushRecipients = activeMembers
    .filter((member) => member.userId !== user.id && (!member.mutedUntil || member.mutedUntil < now))
    .map((member) => member.userId)
    .filter((recipientId) => !isUserOnline(recipientId) || !isUserActiveInChat(recipientId, targetChatId));

  if (pushRecipients.length > 0) {
    const { sendPushToUsers } = await import("@/lib/push");
    const senderName = user.profile?.displayName ?? user.username;
    const firstMessage = createdMessages[0];
    let bodyPreview = firstMessage.body || "Пересланное сообщение";
    if (!firstMessage.body && firstMessage.type === "IMAGE") bodyPreview = "Пересланная фотография";
    if (!firstMessage.body && firstMessage.type === "VIDEO") bodyPreview = "Пересланное видео";
    if (!firstMessage.body && firstMessage.type === "VOICE") bodyPreview = "Пересланное голосовое сообщение";
    if (!firstMessage.body && firstMessage.type === "FILE") bodyPreview = "Пересланный файл";

    sendPushToUsers(pushRecipients, {
      title: senderName,
      body: bodyPreview.slice(0, 100),
      url: `/chats/${targetChatId}`,
      type: "message",
      chatId: targetChatId,
      tag: `chat:${targetChatId}`,
    }).catch(() => undefined);
  }

  return NextResponse.json({
    ok: true,
    forwardedCount: createdMessages.length,
    messages: createdMessages,
  });
}
