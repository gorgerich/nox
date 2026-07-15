import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat, emitToUsers } from "@/lib/realtime";

const payloadSchema = z.object({
  messageId: z.string().uuid().nullable(),
});

export async function PATCH(
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

  const body = await request.json().catch(() => null);
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  const prisma = getPrisma();

  if (parsed.data.messageId) {
    const message = await prisma.message.findFirst({
      where: {
        id: parsed.data.messageId,
        chatId,
        deletedAt: null,
        ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
      },
      select: { id: true },
    });

    if (!message) {
      return NextResponse.json({ error: "Сообщение для закрепления не найдено." }, { status: 404 });
    }
  }

  const activeMembers = await prisma.chatMember.findMany({
    where: { chatId, status: "ACTIVE" },
    select: { userId: true },
  });

  const chat = await prisma.chat.update({
    where: { id: chatId },
    data: {
      pinnedMessageId: parsed.data.messageId,
      updatedAt: new Date(),
    },
    select: {
      id: true,
      pinnedMessage: {
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
      },
    },
  });

  emitToChat(chatId, "chat:pinned-message-updated", {
    chatId,
    pinnedMessage: chat.pinnedMessage,
  });
  emitToUsers(activeMembers.map((member) => member.userId), "chat:updated", { chatId });

  return NextResponse.json({
    pinnedMessageId: chat.pinnedMessage?.id ?? null,
    pinnedMessage: chat.pinnedMessage,
  });
}
