import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getPrisma } from "@/lib/prisma";

export async function GET() {
  const { response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const prisma = getPrisma();
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "emergency_lock" },
    select: { value: true, updatedAt: true },
  });

  return NextResponse.json({
    emergencyLocked: setting?.value === "true",
    updatedAt: setting?.updatedAt ?? null,
  });
}

