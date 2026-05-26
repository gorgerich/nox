import { NextResponse } from "next/server";
import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import crypto from "crypto";
import { emitToUser } from "@/lib/realtime";

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

    // Generate an 8-character uppercase alphanumeric code (easily typable)
    const publicCode = crypto.randomBytes(4).toString("hex").toUpperCase(); 
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create AccountRecoveryRequest unconditionally so even if socket delivery fails,
    // if the user has another way to view it (or later opens the app within 10 mins), it's there.
    const recoveryRequest = await prisma.accountRecoveryRequest.create({
      data: {
        userId: user.id,
        publicCode,
        expiresAt,
        requesterIpHash: ipHash,
        requesterUserAgent: userAgent,
      }
    });

    // Emit to active user sessions
    emitToUser(user.id, "account-recovery:requested", {
      requestId: recoveryRequest.id,
      publicCode,
      requesterUserAgent: userAgent,
      expiresAt: expiresAt.toISOString(),
    });

    console.log(`[AUTH] Recovery request emitted for user id: ${user.id}`);

    // Also support email fallback if email exists
    if (user.email) {
      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
          ipHash,
          userAgent,
        },
      });
      if (process.env.NODE_ENV !== "production" || process.env.DEBUG_AUTH === "true") {
        console.log(`[DEV ONLY] Password reset token for ${user.username}: ${token}`);
      }
    }

    return genericSuccessResponse;
  } catch (error) {
    console.error("Forgot password error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
