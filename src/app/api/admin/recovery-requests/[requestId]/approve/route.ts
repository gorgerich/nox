import { NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdminUser } from "@/lib/admin";
import { getPrisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { user: adminUser, response } = await requireAdminUser();

    if (response) {
      return response;
    }

    if (!adminUser) {
      return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
    }

    const { requestId } = await context.params;
    const prisma = getPrisma();
    const recoveryRequest = await prisma.accountRecoveryRequest.findUnique({
      where: { id: requestId },
    });

    if (!recoveryRequest) {
      return NextResponse.json({ error: "Запрос не найден." }, { status: 404 });
    }

    if (recoveryRequest.status !== "PENDING" || new Date() > recoveryRequest.expiresAt) {
      return NextResponse.json({ error: "Запрос истек или уже обработан." }, { status: 400 });
    }

    const ip = request.headers.get("x-forwarded-for") || "unknown";
    const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

    await prisma.$transaction(async (tx) => {
      const updated = await tx.accountRecoveryRequest.updateMany({
        where: { id: requestId, status: "PENDING", expiresAt: { gt: new Date() } },
        data: {
          status: "APPROVED",
          approvedAt: new Date(),
        },
      });
      if (updated.count !== 1) throw new Error("RECOVERY_REQUEST_CONFLICT");
      await tx.adminActionLog.create({
        data: {
          adminUserId: adminUser.id,
          action: "ACCOUNT_RECOVERY_ADMIN_APPROVED",
          targetType: "ACCOUNT_RECOVERY_REQUEST",
          targetId: requestId,
          metadata: {
            userId: recoveryRequest.userId,
          },
          ipHash,
        },
      });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "RECOVERY_REQUEST_CONFLICT") {
      return NextResponse.json({ error: "Запрос уже обработан." }, { status: 409 });
    }
    console.error("Admin approve recovery error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
