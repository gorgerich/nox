import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers } from "@/lib/realtime";

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";

function logReceipts(label: string, data: Record<string, unknown>) {
  if (!DEBUG_REALTIME) {
    return;
  }

  console.log(`[receipts] ${label}`, data);
}

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
  const now = new Date();

  // Update lastReadAt for this user in this chat
  await prisma.chatMember.updateMany({
    where: {
      chatId,
      userId: user.id,
      status: "ACTIVE",
    },
    data: {
      lastReadAt: now,
    },
  });

  // Update receipts readAt for messages received by current user in this chat
  // where message sender is NOT current user
  const receiptsUpdateResult = await prisma.messageReceipt.updateMany({
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
      readAt: now,
      deliveredAt: now,
    },
  });

  logReceipts("read route", {
    userId: user.id,
    chatId,
    updatedCount: receiptsUpdateResult.count,
  });

  // Notify only other active members so sender-side receipts update,
  // but avoid self updates that could incorrectly mark own messages as read.
  const recipients = await prisma.chatMember.findMany({
    where: {
      chatId,
      status: "ACTIVE",
      userId: { not: user.id },
    },
    select: { userId: true },
  });

  emitToUsers(
    recipients.map((member) => member.userId),
    "message:receipts-updated",
    {
      chatId,
      userId: user.id,
      readAt: now,
      deliveredAt: now,
    },
  );
  emitToUsers(recipients.map((member) => member.userId), "chat:updated", { chatId });

  // Notify the user that their chat has been updated (read status changed)
  emitToUsers([user.id], "chat:updated", { chatId });

  return NextResponse.json({ success: true });
}
