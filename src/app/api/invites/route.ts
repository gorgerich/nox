import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createInviteCode, hashInviteCode } from "@/lib/invites";
import { getPrisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const MAX_ACTIVE_INVITES_PER_USER = 10;
const INVITE_TTL_DAYS = 14;

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Нужно войти в профиль." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(request, `invites:create:${user.id}`, { limit: 10, windowMs: 24 * 60 * 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Лимит приглашений исчерпан. Попробуйте позже." }, { status: 429 });
  }

  const prisma = getPrisma();
  const now = new Date();
  const activeInvites = await prisma.invite.count({
    where: {
      createdByUserId: user.id,
      status: "ACTIVE",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  if (activeInvites >= MAX_ACTIVE_INVITES_PER_USER) {
    return NextResponse.json(
      { error: "У вас уже много активных приглашений. Подождите, пока ими воспользуются." },
      { status: 429 },
    );
  }

  const rawInviteCode = createInviteCode();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const invite = await prisma.invite.create({
    data: {
      codeHash: hashInviteCode(rawInviteCode),
      createdByUserId: user.id,
      maxUses: 1,
      expiresAt,
      status: "ACTIVE",
    },
    select: {
      id: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
    },
  });

  return NextResponse.json(
    {
      invite,
      rawInviteCode,
      notice: "Приглашение одноразовое. Администратор увидит, кто его создал.",
    },
    { status: 201 },
  );
}
