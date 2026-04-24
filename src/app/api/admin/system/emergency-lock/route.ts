import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/audit";
import { getPrisma } from "@/lib/prisma";

export async function POST() {
  const { user: admin, response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const prisma = getPrisma();
  const setting = await prisma.systemSetting.upsert({
    where: { key: "emergency_lock" },
    update: { value: "true" },
    create: { key: "emergency_lock", value: "true" },
    select: { value: true, updatedAt: true },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "EMERGENCY_LOCK_ENABLED",
    targetType: "SystemSetting",
    targetId: "emergency_lock",
    metadata: { value: true },
  });

  return NextResponse.json({
    emergencyLocked: setting.value === "true",
    updatedAt: setting.updatedAt,
  });
}

