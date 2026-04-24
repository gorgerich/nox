import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth";
import { validateInvite } from "@/lib/invites";
import { getPrisma } from "@/lib/prisma";

const registerSchema = z.object({
  email: z.email().trim().toLowerCase(),
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/)
    .transform((value) => value.toLowerCase()),
  displayName: z.string().min(2).max(80).trim(),
  password: z.string().min(8).max(128),
  inviteCode: z.string().min(4).max(128).trim(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = registerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные регистрации." }, { status: 400 });
  }

  const { email, username, displayName, password, inviteCode } = parsed.data;
  const inviteResult = await validateInvite({ inviteCode, email, username });

  if (!inviteResult.ok) {
    return NextResponse.json({ error: inviteResult.reason }, { status: 403 });
  }

  const prisma = getPrisma();
  const passwordHash = await bcrypt.hash(password, 12);
  const role = process.env.OWNER_EMAIL?.toLowerCase() === email ? "OWNER" : "MEMBER";

  try {
    const user = await prisma.$transaction(async (tx) => {
      const currentInvite = await tx.invite.findUnique({
        where: { id: inviteResult.invite.id },
      });

      if (
        !currentInvite ||
        currentInvite.status !== "ACTIVE" ||
        currentInvite.usedCount >= currentInvite.maxUses ||
        (currentInvite.expiresAt && currentInvite.expiresAt <= new Date())
      ) {
        throw new Error("Invite is no longer available.");
      }

      const createdUser = await tx.user.create({
        data: {
          email,
          username,
          passwordHash,
          status: "ACTIVE",
          role,
          profile: {
            create: {
              displayName,
            },
          },
        },
        select: {
          id: true,
          role: true,
          email: true,
          username: true,
        },
      });

      const nextUsedCount = currentInvite.usedCount + 1;

      await tx.invite.update({
        where: { id: currentInvite.id },
        data: {
          usedCount: nextUsedCount,
          status: nextUsedCount >= currentInvite.maxUses ? "USED" : "ACTIVE",
        },
      });

      return createdUser;
    });

    const token = await createSessionToken({ userId: user.id, role: user.role });
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());

    return response;
  } catch (error) {
    const message =
      error instanceof Error && error.message === "Invite is no longer available."
        ? "Приглашение больше недоступно."
        : "Не удалось создать аккаунт.";

    return NextResponse.json({ error: message }, { status: 400 });
  }
}
