import { NextResponse } from "next/server";
import { z } from "zod";
import { createCredentialStamp, createSessionToken, getCurrentUser, getSessionCookieOptions, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const schema = z.object({
  newPassword: z.string().min(8, "Новый пароль должен быть не менее 8 символов"),
  revokeOtherSessions: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const prisma = getPrisma();
    const { newPassword, revokeOtherSessions } = parsed.data;

    const newPasswordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: newPasswordHash },
      });

      const ip = request.headers.get("x-forwarded-for") || "unknown";
      const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

      await tx.adminActionLog.create({
        data: {
          adminUserId: user.id,
          action: "PASSWORD_CHANGED_FROM_TRUSTED_DEVICE",
          targetType: "USER",
          targetId: user.id,
          metadata: { revokeOtherSessions },
          ipHash,
        },
      });
    });

    const token = await createSessionToken({
      userId: user.id,
      role: user.role,
      credentialStamp: createCredentialStamp(newPasswordHash),
    });
    const response = NextResponse.json({ message: "Пароль успешно изменен с доверенного устройства." });
    response.cookies.set(SESSION_COOKIE_NAME, token, getSessionCookieOptions());
    return response;
  } catch (error) {
    console.error("Trusted device reset error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
