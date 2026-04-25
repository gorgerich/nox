import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers, emitToChat } from "@/lib/realtime";

export async function POST(
  _request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const prisma = getPrisma();

  // Update lastReadAt for this user in this chat
  await prisma.chatMember.updateMany({
    where: {
      chatId,
      userId: user.id,
      status: "ACTIVE",
    },
    data: {
      lastReadAt: new Date(),
    },
  });

  // Update receipts readAt for messages received by current user in this chat
  // where message sender is NOT current user
  await prisma.messageReceipt.updateMany({
    where: {
      userId: user.id,
      readAt: null,
      message: {
        chatId: chatId,
        senderUserId: { not: user.id },
        deletedAt: null,
      },
    },
    data: {
      readAt: new Date(),
      deliveredAt: new Date(), // If it's read, it's definitely delivered
    },
  });

  // Notify everyone in the chat about the receipt updates
  // For MVP, we'll just say all receipts for current user in this chat are updated
  emitToChat(chatId, "message:receipts-updated", {
    chatId,
    userId: user.id,
    readAt: new Date(),
    deliveredAt: new Date(),
  });

  // Notify the user that their chat has been updated (read status changed)
  emitToUsers([user.id], "chat:updated", { chatId });

  return NextResponse.json({ success: true });
}
