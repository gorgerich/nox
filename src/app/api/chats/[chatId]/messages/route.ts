import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat, emitToUsers } from "@/lib/realtime";

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  replyToMessageId: z.string().uuid().optional(),
});

export async function GET(
  _request: Request,
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

  const prisma = getPrisma();
  const messages = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: "desc" },
    take: 50,
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

  return NextResponse.json({ messages: messages.reverse() });
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

  const body = await request.json().catch(() => null);
  const parsed = messageSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректное сообщение." }, { status: 400 });
  }

  const prisma = getPrisma();

  // If replying, check if parent message exists in the same chat
  if (parsed.data.replyToMessageId) {
    const parent = await prisma.message.findUnique({
      where: { id: parsed.data.replyToMessageId },
      select: { chatId: true, deletedAt: true },
    });

    if (!parent || parent.chatId !== chatId || parent.deletedAt) {
      return NextResponse.json({ error: "Нельзя ответить на это сообщение." }, { status: 400 });
    }
  }

  const message = await prisma.message.create({
    data: {
      chatId,
      senderUserId: user.id,
      type: "TEXT",
      body: parsed.data.body,
      replyToMessageId: parsed.data.replyToMessageId,
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

  await prisma.chat.update({
    where: { id: chatId },
    data: { updatedAt: new Date() },
  });

  const activeMembers = await prisma.chatMember.findMany({
    where: {
      chatId,
      status: "ACTIVE",
    },
    select: {
      userId: true,
    },
  });

  emitToChat(chatId, "message:new", { chatId, message });
  emitToUsers(
    activeMembers.map((member) => member.userId),
    "chat:updated",
    { chatId },
  );

  return NextResponse.json({ message }, { status: 201 });
}
