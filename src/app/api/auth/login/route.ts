import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { canUseApp, isEmergencyLocked } from "@/lib/permissions";

const loginSchema = z.object({
  identifier: z.string().min(3).max(128).trim(),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные для входа." }, { status: 400 });
  }

  const identifier = parsed.data.identifier.toLowerCase();
  const prisma = getPrisma();
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { username: identifier }],
    },
    select: {
      id: true,
      email: true,
      username: true,
      passwordHash: true,
      role: true,
      status: true,
    },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "Неверный логин или пароль." }, { status: 401 });
  }

  const passwordMatches = await bcrypt.compare(parsed.data.password, user.passwordHash);

  if (!passwordMatches) {
    return NextResponse.json({ error: "Неверный логин или пароль." }, { status: 401 });
  }

  const emergencyLocked = await isEmergencyLocked();

  if (!canUseApp(user, emergencyLocked)) {
    return NextResponse.json({ error: "Доступ запрещён." }, { status: 403 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastSeenAt: new Date() },
  });

  const token = await createSessionToken({ userId: user.id, role: user.role });
  const response = NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
    },
  });
  response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

  return response;
}
