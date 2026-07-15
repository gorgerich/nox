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

    await prisma.$transaction(async (tx) => {
      const updated = await tx.accountRecoveryRequest.updateMany({
        where: { id: requestId, userId: user.id, status: "PENDING", expiresAt: { gt: new Date() } },
        data: {
          status: "DENIED",
          deniedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new Error("RECOVERY_REQUEST_CONFLICT");
      await tx.adminActionLog.create({
        data: {
          adminUserId: user.id,
          action: "ACCOUNT_RECOVERY_DENIED",
          targetType: "ACCOUNT_RECOVERY_REQUEST",
          targetId: requestId,
          ipHash,
        }
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "RECOVERY_REQUEST_CONFLICT") {
      return NextResponse.json({ error: "Request is expired or no longer pending" }, { status: 409 });
    }
    console.error("Deny recovery error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
