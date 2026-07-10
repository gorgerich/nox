import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "Пароль должен быть не менее 8 символов"),
});

export async function POST(request: Request) {
  try {
    const rateLimit = checkRateLimit(request, "auth:reset-password", { limit: 10, windowMs: 15 * 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Слишком много попыток. Попробуйте позже." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = resetPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const prisma = getPrisma();
    const { token, newPassword } = parsed.data;

    // Hash the incoming token
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Look up the token in the database
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!resetToken) {
      return NextResponse.json({ error: "Недействительный или истекший токен" }, { status: 400 });
    }

    if (resetToken.usedAt) {
      return NextResponse.json({ error: "Этот токен уже был использован" }, { status: 400 });
    }

    if (new Date() > resetToken.expiresAt) {
      return NextResponse.json({ error: "Срок действия токена истек" }, { status: 400 });
    }

    const user = resetToken.user;

    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 12);

    // Perform the password reset and session invalidation atomically
    await prisma.$transaction(async (tx) => {
      // 1. Update user's password
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      // 2. Mark token as used
      await tx.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      // 3. Revoke all active devices for this user
      // This is crucial for E2EE security. The user must re-verify their devices.
      // And a new DeviceKeyBundle will be created on their next login.
      await tx.userDevice.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });

      // 4. Revoke existing device key bundles
      const activeDevices = await tx.userDevice.findMany({
         where: { userId: user.id },
         select: { id: true }
      });
      
      const deviceIds = activeDevices.map(d => d.id);
      if (deviceIds.length > 0) {
        await tx.deviceKeyBundle.updateMany({
           where: {
              userDeviceId: { in: deviceIds },
              revokedAt: null,
           },
           data: {
              revokedAt: new Date()
           }
        });
      }

      // 5. Log the security event (using AdminActionLog for now as a generic event log)
      const ip = request.headers.get("x-forwarded-for") || "unknown";
      const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

      await tx.adminActionLog.create({
        data: {
          adminUserId: user.id, // Using user.id since they performed the action on themselves
          action: "PASSWORD_RESET",
          targetType: "USER",
          targetId: user.id,
          metadata: {
            reason: "forgot_password_flow",
            devicesRevoked: true,
          },
          ipHash,
        },
      });
    });

    console.log(`[AUTH] User ${user.username} successfully reset their password via token.`);

    return NextResponse.json({
      message: "Пароль успешно изменён. Пожалуйста, войдите с новым паролем.",
    });

  } catch (error) {
    console.error("Reset password error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
