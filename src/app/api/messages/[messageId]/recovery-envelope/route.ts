import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

/**
 * Adds an envelope addressed to the caller's own recovery key to a message
 * they can already read.
 *
 * This is the backfill: a recovery key only covers messages sealed after it
 * existed, and everything older stays unreadable on a new device even though a
 * live device can still open it today. Re-sealing that history to the recovery
 * key closes the gap while it is still possible — once the last device holding
 * a message's key is gone, nothing can.
 *
 * What the server refuses to take on trust:
 *
 *   - the envelope must be addressed to `recovery:<caller>` and to nobody else,
 *     so this cannot be used to plant an envelope in someone else's name;
 *   - the caller must be an active member of the chat the message is in;
 *   - a recovery envelope that already exists is left alone rather than
 *     replaced, so a repeated backfill cannot overwrite a good one with a bad.
 *
 * The server still cannot read any of it. The ciphertext arrives sealed and is
 * stored sealed.
 */
const bodySchema = z.object({
  recipientDeviceId: z.string().min(8).max(120),
  senderDeviceId: z.string().min(8).max(120),
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  salt: z.string().min(1),
  algorithm: z.string().min(1),
  encryptionVersion: z.literal(2),
});

export async function POST(request: Request, context: { params: Promise<{ messageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const { messageId } = await context.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Некорректный конверт." }, { status: 400 });

  const expected = `recovery:${user.id}`;
  if (parsed.data.recipientDeviceId !== expected) {
    return NextResponse.json({ error: "Конверт можно добавить только своему ключу." }, { status: 403 });
  }

  const prisma = getPrisma();

  // The caller must own a recovery key, and must be in the chat.
  const [recoveryKey, message] = await Promise.all([
    prisma.accountRecoveryKey.findUnique({ where: { userId: user.id }, select: { userId: true } }),
    prisma.message.findUnique({
      where: { id: messageId },
      select: { id: true, chatId: true, deletedAt: true },
    }),
  ]);
  if (!recoveryKey) return NextResponse.json({ error: "Ключ восстановления не создан." }, { status: 400 });
  if (!message || message.deletedAt) return NextResponse.json({ error: "Сообщение не найдено." }, { status: 404 });

  const membership = await prisma.chatMember.findFirst({
    where: { chatId: message.chatId, userId: user.id, status: "ACTIVE" },
    select: { id: true },
  });
  if (!membership) return NextResponse.json({ error: "Нет доступа." }, { status: 403 });

  // The sealing device must be one of the caller's own.
  const sealingDevice = await prisma.deviceKeyBundle.findFirst({
    where: { deviceId: parsed.data.senderDeviceId, userId: user.id, revokedAt: null },
    select: { deviceId: true },
  });
  if (!sealingDevice) {
    return NextResponse.json({ error: "Неизвестное устройство отправителя." }, { status: 403 });
  }

  const existing = await prisma.messageEnvelope.findFirst({
    where: { messageId: message.id, recipientDeviceId: expected },
    select: { id: true },
  });
  if (existing) return NextResponse.json({ ok: true, created: false });

  await prisma.messageEnvelope.create({
    data: {
      messageId: message.id,
      recipientUserId: user.id,
      recipientDeviceId: expected,
      senderDeviceId: parsed.data.senderDeviceId,
      ciphertext: parsed.data.ciphertext,
      iv: parsed.data.iv,
      salt: parsed.data.salt,
      algorithm: parsed.data.algorithm,
      encryptionVersion: parsed.data.encryptionVersion,
    },
  });

  return NextResponse.json({ ok: true, created: true }, { status: 201 });
}
