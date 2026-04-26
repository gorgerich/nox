import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat, emitToUsers, isUserActiveInChat, isUserOnline } from "@/lib/realtime";
import { getAttachmentRule, normalizeAttachmentMimeType, saveObject } from "@/lib/storage";

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";

function logRealtime(label: string, data: Record<string, unknown>) {
  if (!DEBUG_REALTIME) {
    return;
  }

  console.log(`[realtime-server] ${label}`, data);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
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

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Выберите файл." }, { status: 400 });
  }

  const rule = getAttachmentRule(file.type);
  const normalizedMimeType = normalizeAttachmentMimeType(file.type);

  if (!rule) {
    return NextResponse.json({ error: "Тип файла не разрешён." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > rule.maxSizeBytes) {
    return NextResponse.json({ error: "Размер файла не разрешён." }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const { storageKey } = await saveObject(fileBuffer);
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

  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        chatId,
        senderUserId: user.id,
        type: rule.kind,
        receipts: {
          create: activeMembers
            .filter((member) => member.userId !== user.id)
            .map((member) => ({ userId: member.userId })),
        },
        attachments: {
          create: {
            uploaderUserId: user.id,
            storageKey,
            fileName: file.name || "file",
            mimeType: normalizedMimeType,
            sizeBytes: file.size,
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

    return createdMessage;
  });

  logRealtime("message created", { messageId: message.id, chatId, senderId: user.id, type: message.type });
  emitToChat(chatId, "message:new", { chatId, message });
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
    if (message.type === "VOICE") bodyPreview = "Голосовое сообщение";
    if (message.type === "FILE") bodyPreview = `Файл: ${file.name}`;

    sendPushToUsers(recipients, {
      title: senderName,
      body: bodyPreview,
      url: `/chats/${chatId}`,
      type: "message",
      chatId,
      tag: `chat:${chatId}`,
    }).catch(err => console.error("Push failed:", err));
  }

  return NextResponse.json({ message }, { status: 201 });
}
