import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat } from "@/lib/realtime";

const reactionSchema = z.object({
  emoji: z.enum(["👍", "❤️", "😂", "😮", "👎"]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { messageId } = await context.params;
  const body = await request.json().catch(() => null);
  const parsed = reactionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректная реакция." }, { status: 400 });
  }

  const prisma = getPrisma();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, chatId: true, deletedAt: true },
  });

  if (!message || message.deletedAt) {
    return NextResponse.json({ error: "Сообщение не найдено." }, { status: 404 });
  }

  const membership = await requireActiveChatMembership(message.chatId, user.id);
  if (!membership) {
    return NextResponse.json({ error: "Доступ запрещён." }, { status: 403 });
  }

  const { emoji } = parsed.data;

  // Check if this reaction already exists from this user
  const existing = await prisma.reaction.findUnique({
    where: {
      messageId_userId: {
        messageId,
        userId: user.id,
      },
    },
  });

  if (existing) {
    if (existing.emoji === emoji) {
      // Remove reaction if same emoji
      await prisma.reaction.delete({
        where: { id: existing.id },
      });
    } else {
      // Update reaction if different emoji
      await prisma.reaction.update({
        where: { id: existing.id },
        data: { emoji },
      });
    }
  } else {
    // Create new reaction
    await prisma.reaction.create({
      data: {
        messageId,
        userId: user.id,
        emoji,
      },
    });
  }

  // Get updated reactions for this message
  const reactions = await prisma.reaction.findMany({
    where: { messageId },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          profile: { select: { displayName: true } },
        },
      },
    },
  });

  emitToChat(message.chatId, "message:reactions-updated", {
    chatId: message.chatId,
    messageId,
    reactions,
  });

  return NextResponse.json({ reactions });
}
