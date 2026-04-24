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
    select: { id: true, role: true },
  });

  if (!target) {
    return NextResponse.json({ error: "Пользователь не найден." }, { status: 404 });
  }

  if (target.role === "OWNER") {
    if (admin.role !== "OWNER") {
      return NextResponse.json({ error: "Нет доступа." }, { status: 403 });
    }

    const ownerCount = await prisma.user.count({
      where: { role: "OWNER", status: { not: "REVOKED" } },
    });

    if (ownerCount <= 1) {
      return NextResponse.json({ error: "Нельзя снять роль у последнего владельца." }, { status: 400 });
    }
  }

  const updatedUser = await prisma.user.update({
    where: { id: target.id },
    data: { role: "MEMBER" },
    select: { id: true, role: true, status: true },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "USER_ADMIN_REMOVED",
    targetType: "User",
    targetId: target.id,
    metadata: { previousRole: target.role, nextRole: updatedUser.role },
  });

  return NextResponse.json({ user: updatedUser });
}
