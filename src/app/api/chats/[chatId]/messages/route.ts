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
      receipts: {
        select: {
          userId: true,
          deliveredAt: true,
          readAt: true,
        }
      }
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

  const activeMembers = await prisma.chatMember.findMany({
    where: {
      chatId,
      status: "ACTIVE",
    },
    select: {
      userId: true,
    },
  });

  const message = await prisma.message.create({
    data: {
      chatId,
      senderUserId: user.id,
      type: "TEXT",
      body: parsed.data.body,
      replyToMessageId: parsed.data.replyToMessageId,
      receipts: {
        create: activeMembers
          .filter(m => m.userId !== user.id)
          .map(m => ({ userId: m.userId }))
      }
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
        }
      }
    },
  });

  await prisma.chat.update({
    where: { id: chatId },
    data: { updatedAt: new Date() },
  });

  emitToChat(chatId, "message:new", { chatId, message });
  emitToUsers(
    activeMembers.map((member) => member.userId),
    "chat:updated",
    { chatId },
  );

  // Send Push Notifications (non-blocking)
  const recipients = activeMembers
    .map((m) => m.userId)
    .filter((id) => id !== user.id);

  if (recipients.length > 0) {
    const { sendPushToUsers } = await import("@/lib/push");
    const senderName = message.sender.profile?.displayName || message.sender.username;
    const bodyPreview = (message.body || "").length > 100 
      ? (message.body || "").substring(0, 97) + "..." 
      : (message.body || "");

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
