import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat } from "@/lib/realtime";

const editSchema = z.object({
  body: z.string().trim().min(1).max(4000),
});

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { messageId } = await context.params;
  const prisma = getPrisma();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      chat: {
        include: {
          members: {
            where: { userId: user.id },
            select: {
              role: true,
              status: true,
            },
          },
        },
      },
    },
  });

  const membership = message?.chat.members[0];

  if (!message || !membership || membership.status !== "ACTIVE") {
    return NextResponse.json({ error: "Сообщение не найдено." }, { status: 404 });
  }

  const canDelete = message.senderUserId === user.id || isChatAdminRole(membership.role);

  if (!canDelete) {
    return NextResponse.json({ error: "Доступ запрещён." }, { status: 403 });
  }

  const deletedMessage = await prisma.message.update({
    where: { id: message.id },
    data: { deletedAt: message.deletedAt ?? new Date() },
  });

  emitToChat(message.chatId, "message:deleted", {
    chatId: message.chatId,
    messageId: message.id,
  });

  return NextResponse.json({ message: deletedMessage });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { messageId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = editSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректное сообщение." }, { status: 400 });
  }

  const prisma = getPrisma();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      chat: {
        include: {
          members: {
            where: { userId: user.id },
            select: {
              status: true,
            },
          },
        },
      },
    },
  });

  const membership = message?.chat.members[0];

  if (!message || !membership || membership.status !== "ACTIVE") {
    return NextResponse.json({ error: "Сообщение не найдено." }, { status: 404 });
  }

  if (message.senderUserId !== user.id) {
    return NextResponse.json({ error: "Доступ запрещён." }, { status: 403 });
  }

  if (message.deletedAt) {
    return NextResponse.json({ error: "Нельзя редактировать удалённое сообщение." }, { status: 400 });
  }

  const updatedMessage = await prisma.message.update({
    where: { id: message.id },
    data: {
      body: parsed.data.body,
      editedAt: new Date(),
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
    },
  });

  emitToChat(message.chatId, "message:updated", {
    chatId: message.chatId,
    message: updatedMessage,
  });

  return NextResponse.json({ message: updatedMessage });
}
