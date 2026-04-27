import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import crypto from "crypto";

const forgotPasswordSchema = z.object({
  usernameOrEmail: z.string().min(1),
});

export async function POST(request: Request) {
  try {
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
          { email: identifier },
          { username: identifier },
        ],
      },
    });

    // Always return the same generic success message to prevent user enumeration.
    const genericSuccessResponse = NextResponse.json({
      message: "Если аккаунт с такими данными существует, мы отправили на него инструкции по восстановлению.",
    });

    if (!user) {
      // Simulate some processing time to prevent timing attacks.
      await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 200));
      return genericSuccessResponse;
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Extract basic IP and user-agent info for security logging, if available.
    const userAgent = request.headers.get("user-agent")?.substring(0, 255) ?? null;
    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

    // Store the hashed token with a 30-minute expiration
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
        ipHash,
        userAgent,
      },
    });

    // In a real application, you would send an email here containing the cleartext `token`.
    // We cannot log the token in production, but for MVP demonstration, we might
    // need a way to access it, so we'll log it carefully marked as a dev-only feature.
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "true") {
      console.log(`[DEV ONLY] Password reset token for ${user.username}: ${token}`);
    } else {
       console.log(`[AUTH] Password reset requested for user id: ${user.id}`);
    }
    
    // TODO: Implement actual email sending.
    // await sendEmail(user.email, "Восстановление пароля Nox", `Ваш токен: ${token}`);

    return genericSuccessResponse;
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
