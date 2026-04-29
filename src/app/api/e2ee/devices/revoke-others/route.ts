import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null) as { currentDeviceId?: string } | null;
  const currentDeviceId = body?.currentDeviceId || request.headers.get("x-nox-device-id") || null;

  if (!currentDeviceId) {
    return NextResponse.json({ error: "CURRENT_DEVICE_REQUIRED" }, { status: 400 });
  }

  const prisma = getPrisma();
  const currentDevice = await prisma.userDevice.findUnique({
    where: { deviceId: currentDeviceId },
    select: { userId: true, revokedAt: true },
  });

  if (!currentDevice || currentDevice.userId !== user.id) {
    return NextResponse.json({ error: "CURRENT_DEVICE_NOT_FOUND" }, { status: 404 });
  }

  if (currentDevice.revokedAt) {
    return NextResponse.json({ error: "CURRENT_DEVICE_REVOKED" }, { status: 403 });
  }

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const userDevices = await tx.userDevice.updateMany({
      where: {
        userId: user.id,
        deviceId: { not: currentDeviceId },
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    await tx.deviceKeyBundle.updateMany({
      where: {
        userId: user.id,
        deviceId: { not: currentDeviceId },
        revokedAt: null,
      },
      data: { revokedAt: now },
    });

    return userDevices;
  });

  return NextResponse.json({ ok: true, revokedCount: result.count, revokedAt: now.toISOString() });
}
