import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat, emitToUsers, isUserActiveInChat, isUserOnline } from "@/lib/realtime";
import { checkBlockStatus } from "@/lib/contacts";

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";

function logRealtime(label: string, data: Record<string, unknown>) {
  if (!DEBUG_REALTIME) {
    return;
  }

  console.log(`[realtime-server] ${label}`, data);
}

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  replyToMessageId: z.string().uuid().optional(),
});

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
    include: {
      sender: {
        select: {
          id: true,
          username: true,
          profile: { select: { displayName: true, avatarUrl: true } },
        },
      },
      attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
      replyToMessage: {
        include: {
          sender: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
        },
      },
      reactions: { include: { user: { select: { id: true, username: true, profile: { select: { displayName: true } } } } } },
      receipts: { select: { userId: true, deliveredAt: true, readAt: true } }
    },
  });

  return NextResponse.json({ messages: messages.reverse() });
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

  // Security: Check Blocks
  if (membership.chat.type === "DIRECT") {
    const otherMember = await prisma.chatMember.findFirst({
      where: { chatId, userId: { not: user.id } },
      select: { userId: true }
    });
    if (otherMember && await checkBlockStatus(user.id, otherMember.userId)) {
      return NextResponse.json({ error: "Вы не можете отправить сообщение этому пользователю." }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Некорректное сообщение." }, { status: 400 });

  const activeMembers = await prisma.chatMember.findMany({
    where: { chatId, status: "ACTIVE" },
    select: { userId: true, mutedUntil: true },
  });

  const message = await prisma.message.create({
    data: {
      chatId,
      senderUserId: user.id,
      type: "TEXT",
      body: parsed.data.body,
      replyToMessageId: parsed.data.replyToMessageId,
      receipts: {
        create: activeMembers.filter(m => m.userId !== user.id).map(m => ({ userId: m.userId }))
      }
    },
    include: {
      sender: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
      attachments: { select: { id: true, fileName: true, mimeType: true, sizeBytes: true } },
      replyToMessage: {
        include: { sender: { select: { id: true, username: true, profile: { select: { displayName: true } } } } },
      },
      reactions: { include: { user: { select: { id: true, username: true, profile: { select: { displayName: true } } } } } },
      receipts: { select: { userId: true, deliveredAt: true, readAt: true } }
    },
  });

  await prisma.chat.update({ where: { id: chatId }, data: { updatedAt: new Date() } });

  logRealtime("message created", { messageId: message.id, chatId, senderId: user.id });
  emitToChat(chatId, "message:new", { chatId, message });
  logRealtime("emitting message:new", { chatId, messageId: message.id });
  emitToUsers(activeMembers.map(m => m.userId), "chat:updated", { chatId });

  // Filter out muted users for push notifications
  const now = new Date();
  const pushRecipients = activeMembers
    .filter(m => m.userId !== user.id && (!m.mutedUntil || m.mutedUntil < now))
    .map(m => m.userId)
    .filter((recipientId) => !isUserOnline(recipientId) || !isUserActiveInChat(recipientId, chatId));

  if (pushRecipients.length > 0) {
    const { sendPushToUsers } = await import("@/lib/push");
    const senderName = message.sender.profile?.displayName || message.sender.username;
    sendPushToUsers(pushRecipients, {
      title: senderName,
      body: (message.body || "").substring(0, 100),
      url: `/chats/${chatId}`,
      type: "message",
      chatId,
      tag: `chat:${chatId}`,
    }).catch(() => {});
  }

  return NextResponse.json({ message }, { status: 201 });
}
