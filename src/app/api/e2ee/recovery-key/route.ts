import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

/**
 * The account recovery key.
 *
 * Two audiences, deliberately given different things:
 *
 *   - **Anyone who shares a chat with the owner** may read the *public* key.
 *     They need it to address an envelope, exactly as they need each device's
 *     public key, and a public key is public.
 *
 *   - **Only the owner** may read the sealed private key. It is useless
 *     without the passphrase, which the server never sees — but there is no
 *     reason to hand a ciphertext to anyone who cannot be its owner, and every
 *     reason not to.
 */

async function sharesAChat(currentUserId: string, targetUserId: string, chatId: string | null) {
  if (currentUserId === targetUserId) return true;
  if (!chatId) return false;
  const prisma = getPrisma();
  const shared = await prisma.chat.findFirst({
    where: {
      id: chatId,
      members: { some: { userId: currentUserId, status: "ACTIVE" } },
      AND: { members: { some: { userId: targetUserId, status: "ACTIVE" } } },
    },
    select: { id: true },
  });
  return Boolean(shared);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const url = new URL(request.url);
  const targetUserId = url.searchParams.get("userId") ?? user.id;
  const chatId = url.searchParams.get("chatId");

  if (!(await sharesAChat(user.id, targetUserId, chatId))) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }

  const prisma = getPrisma();
  const record = await prisma.accountRecoveryKey.findUnique({ where: { userId: targetUserId } });
  if (!record) return NextResponse.json({ recoveryKey: null });

  // The sealed key goes only to its owner.
  if (targetUserId !== user.id) {
    return NextResponse.json({
      recoveryKey: { userId: record.userId, publicKey: record.publicKey },
    });
  }

  return NextResponse.json({
    recoveryKey: {
      userId: record.userId,
      publicKey: record.publicKey,
      ciphertext: record.ciphertext,
      iv: record.iv,
      salt: record.salt,
      kdf: record.kdf,
      algorithm: record.algorithm,
      iterations: record.iterations,
      createdAt: record.createdAt,
    },
  });
}

/**
 * Stores or replaces the caller's own recovery key.
 *
 * Replacing one invalidates nothing already sent: past envelopes stay addressed
 * to the previous key, so a user who forgets a passphrase and sets a new one
 * keeps whatever their live devices can still open, and loses the rest. That is
 * the honest consequence of having no escrow, and the UI has to say it.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  const payload = body as Partial<{
    publicKey: string;
    ciphertext: string;
    iv: string;
    salt: string;
    kdf: string;
    algorithm: string;
    iterations: number;
  }>;

  const required = ["publicKey", "ciphertext", "iv", "salt", "kdf", "algorithm"] as const;
  for (const field of required) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      return NextResponse.json({ error: `Отсутствует поле ${field}.` }, { status: 400 });
    }
  }
  // A low iteration count would be a weak backup that looks like a strong one.
  if (typeof payload.iterations !== "number" || payload.iterations < 100_000) {
    return NextResponse.json({ error: "Слишком слабые параметры вывода ключа." }, { status: 400 });
  }

  const prisma = getPrisma();
  const data = {
    publicKey: payload.publicKey!,
    ciphertext: payload.ciphertext!,
    iv: payload.iv!,
    salt: payload.salt!,
    kdf: payload.kdf!,
    algorithm: payload.algorithm!,
    iterations: payload.iterations,
  };

  const record = await prisma.accountRecoveryKey.upsert({
    where: { userId: user.id },
    create: { userId: user.id, ...data },
    update: data,
    select: { userId: true, publicKey: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ recoveryKey: record }, { status: 201 });
}

/** Removes the caller's recovery key. History already addressed to it stays. */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const prisma = getPrisma();
  await prisma.accountRecoveryKey.deleteMany({ where: { userId: user.id } });
  return NextResponse.json({ ok: true });
}
