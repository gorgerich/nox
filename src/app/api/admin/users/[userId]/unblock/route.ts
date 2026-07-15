import { NextResponse } from "next/server";
import { canManageUser, requireAdminUser } from "@/lib/admin";
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

  if (!canManageUser(admin, target)) {
    return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
  }

  if (target.status === "REVOKED") {
    return NextResponse.json({ error: "Отозванный доступ нельзя разблокировать." }, { status: 400 });
  }

  const updatedUser = await prisma.user.update({
    where: { id: target.id },
    data: { status: "ACTIVE" },
    select: { id: true, role: true, status: true },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "USER_UNBLOCKED",
    targetType: "User",
    targetId: target.id,
    metadata: { previousStatus: target.status, nextStatus: updatedUser.status },
  });

  return NextResponse.json({ user: updatedUser });
}
