import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers } from "@/lib/realtime";

const deliveryAckSchema = z.object({
  deviceId: z.string().min(8).max(120).optional(),
});

/**
 * POST /api/messages/[messageId]/delivery-ack
 * Device confirms successful local decrypt. Server then deletes only that device envelope payload.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ messageId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { messageId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = deliveryAckSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid delivery ack" }, { status: 400 });
  }

  const prisma = getPrisma();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      chat: {
        include: {
          members: { select: { userId: true, status: true } },
        },
      },
    },
  });

  if (!message) {
    return NextResponse.json({ error: "Сообщение не найдено" }, { status: 404 });
  }

  const isMember = message.chat.members.some((member) => member.userId === user.id && member.status === "ACTIVE");
  if (!isMember) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const now = new Date();

  if ((message.encryptionVersion ?? 0) >= 2) {
    const { deviceId } = parsed.data;
    if (!deviceId) {
      return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
    }

    const device = await prisma.userDevice.findFirst({
      where: {
        userId: user.id,
        deviceId,
        revokedAt: null,
      },
      select: { deviceId: true },
    });

    if (!device) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    const envelope = await prisma.messageEnvelope.findUnique({
      where: { messageId_recipientDeviceId: { messageId, recipientDeviceId: deviceId } },
      select: { id: true, recipientUserId: true, deliveredAt: true, encryptedPayloadDeletedAt: true },
    });

    if (!envelope || envelope.recipientUserId !== user.id) {
      return NextResponse.json({ error: "Envelope not found" }, { status: 404 });
    }

    const updatedEnvelope = await prisma.messageEnvelope.update({
      where: { id: envelope.id },
      data: {
        deliveredAt: envelope.deliveredAt ?? now,
        encryptedPayloadDeletedAt: envelope.encryptedPayloadDeletedAt ?? now,
        ciphertext: null,
        iv: null,
        salt: null,
      },
      select: {
        recipientDeviceId: true,
        deliveredAt: true,
        encryptedPayloadDeletedAt: true,
      },
    });

    if (message.senderUserId !== user.id) {
      await prisma.messageReceipt.upsert({
        where: { messageId_userId: { messageId, userId: user.id } },
        update: { deliveredAt: updatedEnvelope.deliveredAt ?? now },
        create: { messageId, userId: user.id, deliveredAt: updatedEnvelope.deliveredAt ?? now },
      });

      emitToUsers([message.senderUserId], "message:receipts-updated", {
        chatId: message.chatId,
        userId: user.id,
        deliveredAt: updatedEnvelope.deliveredAt ?? now,
      });
    }

    return NextResponse.json({
      ok: true,
      messageId,
      deviceId: updatedEnvelope.recipientDeviceId,
      deliveredAt: updatedEnvelope.deliveredAt?.toISOString() ?? null,
      encryptedPayloadDeletedAt: updatedEnvelope.encryptedPayloadDeletedAt?.toISOString() ?? null,
    });
  }

  if (message.senderUserId === user.id) {
    return NextResponse.json({ ok: true });
  }

  await prisma.messageReceipt.upsert({
    where: { messageId_userId: { messageId, userId: user.id } },
    update: { deliveredAt: now },
    create: { messageId, userId: user.id, deliveredAt: now },
  });

  emitToUsers([message.senderUserId], "message:receipts-updated", {
    chatId: message.chatId,
    userId: user.id,
    deliveredAt: now,
  });

  return NextResponse.json({ ok: true, messageId, deliveredAt: now.toISOString() });
}
