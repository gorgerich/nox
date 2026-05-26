import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { canUseApp, isEmergencyLocked } from "@/lib/permissions";

const loginSchema = z.object({
  login: z.string().min(3).max(128).trim(),
  password: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные для входа." }, { status: 400 });
  }

  const loginInput = parsed.data.login.toLowerCase();

  try {
    const prisma = getPrisma();

    // Run the user lookup and the emergency-lock check in parallel — they are
    // independent, so this avoids an extra sequential DB round-trip on every login.
    const [user, emergencyLocked] = await Promise.all([
      prisma.user.findFirst({
        where: {
          OR: [
            { login: loginInput },
            { username: loginInput },
            { email: loginInput },
          ],
        },
        select: {
          id: true,
          login: true,
          email: true,
          username: true,
          passwordHash: true,
          role: true,
          status: true,
        },
      }),
      isEmergencyLocked(),
    ]);

    if (!user || !user.passwordHash) {
      return NextResponse.json({ error: "Неверный логин или пароль." }, { status: 401 });
    }

    // Check if user is blocked or revoked
    if (user.status === "BLOCKED" || user.status === "REVOKED") {
      return NextResponse.json({ error: "Доступ к вашему аккаунту ограничен." }, { status: 403 });
    }

    const passwordMatches = await bcrypt.compare(parsed.data.password, user.passwordHash);

    if (!passwordMatches) {
      return NextResponse.json({ error: "Неверный логин или пароль." }, { status: 401 });
    }

    if (!canUseApp(user, emergencyLocked)) {
      return NextResponse.json({ error: "Доступ временно ограничен." }, { status: 403 });
    }

    // Non-blocking: lastSeenAt is presence metadata, not required for the login
    // response. Awaiting it added a full round-trip to the critical path. The custom
    // long-lived server keeps the event loop alive, so the write still completes.
    void prisma.user.update({
      where: { id: user.id },
      data: { lastSeenAt: new Date() },
    }).catch((error) => {
      console.error("Failed to update lastSeenAt on login", error);
    });

    const token = await createSessionToken({ userId: user.id, role: user.role });
    const response = NextResponse.json({
      user: {
        id: user.id,
        login: user.login,
        email: user.email,
        username: user.username,
        role: user.role,
      },
    });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

    return response;
  } catch (error) {
    // Most commonly a database connectivity/config failure (e.g. wrong DATABASE_URL,
    // unreachable Postgres). Log the full cause for server logs (Railway) and return a
    // clean, explicit error instead of a bare 500 so the UI can show something useful.
    console.error("[login] request failed:", error);
    return NextResponse.json(
      { error: "Сервис временно недоступен. Попробуйте позже." },
      { status: 503 },
    );
  }
}
