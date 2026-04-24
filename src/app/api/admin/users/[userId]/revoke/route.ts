import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/audit";
import { getPrisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { user: admin, response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const { userId } = await context.params;
  const prisma = getPrisma();
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, status: true },
  });

  if (!target) {
    return NextResponse.json({ error: "Пользователь не найден." }, { status: 404 });
  }

  if (target.role === "OWNER" && admin.role !== "OWNER") {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }

  if (target.role === "OWNER") {
    const ownerCount = await prisma.user.count({
      where: { role: "OWNER", status: { not: "REVOKED" } },
    });

    if (ownerCount <= 1) {
      return NextResponse.json({ error: "Нельзя отозвать доступ у последнего владельца." }, { status: 400 });
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: target.id },
    data: { status: "REVOKED" },
    select: { id: true, role: true, status: true },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "USER_REVOKED",
    targetType: "User",
    targetId: target.id,
    metadata: { previousStatus: target.status, nextStatus: updatedUser.status },
  });

  return NextResponse.json({ user: updatedUser });
}

