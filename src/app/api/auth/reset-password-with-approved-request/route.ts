import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  publicCode: z.string().min(1),
  newPassword: z.string().min(8, "Пароль должен быть не менее 8 символов"),
});

export async function POST(request: Request) {
  try {
    const rateLimit = checkRateLimit(request, "auth:approved-reset", { limit: 10, windowMs: 15 * 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Слишком много попыток. Попробуйте позже." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const prisma = getPrisma();
    const { publicCode, newPassword } = parsed.data;

    const recoveryRequest = await prisma.accountRecoveryRequest.findUnique({
      where: { publicCode },
      include: { user: true },
    });

    if (!recoveryRequest) {
      return NextResponse.json({ error: "Недействительный код подтверждения" }, { status: 400 });
    }

    if (recoveryRequest.status !== "APPROVED") {
      return NextResponse.json({ error: "Запрос не подтвержден на доверенном устройстве" }, { status: 400 });
    }

    if (recoveryRequest.usedAt) {
      return NextResponse.json({ error: "Этот код уже был использован" }, { status: 400 });
    }

    if (new Date() > recoveryRequest.expiresAt) {
      return NextResponse.json({ error: "Срок действия кода истек" }, { status: 400 });
    }

    const user = recoveryRequest.user;
    const passwordHash = await bcrypt.hash(newPassword, 12);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await tx.accountRecoveryRequest.update({
        where: { id: recoveryRequest.id },
        data: { 
          usedAt: new Date(),
          status: "USED", 
        },
      });

      const ip = request.headers.get("x-forwarded-for") || "unknown";
      const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

      await tx.adminActionLog.create({
        data: {
          adminUserId: user.id,
          action: "PASSWORD_RESET_FROM_REQUEST",
          targetType: "ACCOUNT_RECOVERY_REQUEST",
          targetId: recoveryRequest.id,
          metadata: { devicesRevoked: false },
          ipHash,
        },
      });
    });

    console.log(`[AUTH] User ${user.username} successfully reset password via device approval.`);

    return NextResponse.json({
      message: "Пароль успешно изменён. Пожалуйста, войдите с новым паролем.",
    });

  } catch (error) {
    console.error("Reset password with request error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
