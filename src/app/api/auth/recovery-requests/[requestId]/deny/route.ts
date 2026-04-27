import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import crypto from "crypto";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { requestId } = await context.params;
    const prisma = getPrisma();

    const recoveryRequest = await prisma.accountRecoveryRequest.findUnique({
      where: { id: requestId },
    });

    if (!recoveryRequest || recoveryRequest.userId !== user.id) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (recoveryRequest.status !== "PENDING" || new Date() > recoveryRequest.expiresAt) {
      return NextResponse.json({ error: "Request is expired or no longer pending" }, { status: 400 });
    }

    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

    await prisma.$transaction([
      prisma.accountRecoveryRequest.update({
        where: { id: requestId },
        data: {
          status: "DENIED",
          deniedAt: new Date(),
        },
      }),
      prisma.adminActionLog.create({
        data: {
          adminUserId: user.id,
          action: "ACCOUNT_RECOVERY_DENIED",
          targetType: "ACCOUNT_RECOVERY_REQUEST",
          targetId: requestId,
          ipHash,
        }
      })
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Deny recovery error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
