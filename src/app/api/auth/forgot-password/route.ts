import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import crypto from "crypto";
import { emitToUser } from "@/lib/realtime";
import { checkRateLimit } from "@/lib/rate-limit";

const forgotPasswordSchema = z.object({
  usernameOrEmail: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const rateLimit = checkRateLimit(request, "auth:forgot-password", { limit: 6, windowMs: 15 * 60_000 });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Слишком много запросов. Попробуйте позже." },
        { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds) } },
      );
    }

    const body = await request.json().catch(() => ({}));
    const parsed = forgotPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const prisma = getPrisma();
    const identifier = parsed.data.usernameOrEmail.toLowerCase();

    // Look up the user
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { login: identifier },
          { email: identifier },
          { username: identifier },
        ],
      },
    });

    // Always return the same generic success message
    const genericSuccessResponse = NextResponse.json({
      message: "Если аккаунт существует, мы создали запрос. Его может подтвердить активное устройство или администратор.",
    });

    if (!user) {
      // Simulate some processing time to prevent timing attacks.
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));
      return genericSuccessResponse;
    }

    const userAgent = request.headers.get("user-agent")?.substring(0, 255) ?? null;
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

    // 48 bits keeps the code typable while making online guessing impractical.
    const publicCode = crypto.randomBytes(6).toString("hex").toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const recoveryRequest = await prisma.$transaction(async (tx) => {
      await tx.accountRecoveryRequest.updateMany({
        where: { userId: user.id, status: "PENDING" },
        data: { status: "EXPIRED" },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const createdRequest = await tx.accountRecoveryRequest.create({
        data: {
          userId: user.id,
          publicCode,
          expiresAt,
          requesterIpHash: ipHash,
          requesterUserAgent: userAgent,
        },
      });

      if (user.email) {
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        await tx.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            ipHash,
            userAgent,
          },
        });
        if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "true") {
          console.log(`[DEV ONLY] Password reset token for ${user.username}: ${token}`);
        }
      }

      return createdRequest;
    });

    // Emit to active user sessions
    emitToUser(user.id, "account-recovery:requested", {
      requestId: recoveryRequest.id,
      publicCode,
      requesterUserAgent: userAgent,
      expiresAt: expiresAt.toISOString(),
    });

    console.log(`[AUTH] Recovery request emitted for user id: ${user.id}`);

    return genericSuccessResponse;
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
