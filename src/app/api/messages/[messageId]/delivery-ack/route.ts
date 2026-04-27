import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers } from "@/lib/realtime";

/**
 * POST /api/messages/[messageId]/delivery-ack
 * Recipient confirms successful delivery and local decryption.
 * Server then deletes the encrypted payload.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId } = await context.params;
  const prisma = getPrisma();

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { chat: { include: { members: true } } },
  });

  if (!message) {
    return NextResponse.json({ error: "Сообщение не найдено" }, { status: 404 });
  }

  // Security: only recipient can ack
  const isMember = message.chat.members.some(m => m.userId === user.id);
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (message.senderUserId === user.id) {
    // Sender doesn't need to ack own message for deletion logic
    return NextResponse.json({ ok: true });
  }

  // Update receipt and message
  const now = new Date();
  await prisma.$transaction([
    prisma.messageReceipt.upsert({
      where: { messageId_userId: { messageId, userId: user.id } },
      update: { deliveredAt: now },
      create: { messageId, userId: user.id, deliveredAt: now },
    }),
    prisma.message.update({
      where: { id: messageId },
      data: {
        deliveredAt: now,
        // Delete encrypted payload after delivery to one-to-one recipient
        ciphertext: message.isEncrypted ? null : undefined,
        iv: message.isEncrypted ? null : undefined,
        salt: message.isEncrypted ? null : undefined,
      },
    }),
  ]);

  // Notify sender about delivery
  emitToUsers([message.senderUserId], "message:receipts-updated", {
    chatId: message.chatId,
    userId: user.id,
    deliveredAt: now,
  });

  return NextResponse.json({ ok: true });
}
