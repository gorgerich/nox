import { NextResponse } from "next/server";
import { requireOwnerUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/audit";
import { getPrisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const { user: admin, response } = await requireOwnerUser();

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

  if (target.id === admin.id || target.role !== "ADMIN") {
    return NextResponse.json({ error: "Роль этого пользователя нельзя изменить." }, { status: 400 });
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
