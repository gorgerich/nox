import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ deviceId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { deviceId } = await context.params;
  const prisma = getPrisma();
  const device = await prisma.userDevice.findUnique({ where: { deviceId }, select: { id: true, userId: true } });

  if (!device || device.userId !== user.id) {
    return NextResponse.json({ error: "Device not found" }, { status: 404 });
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.userDevice.update({ where: { id: device.id }, data: { revokedAt: now } }),
    prisma.deviceKeyBundle.updateMany({ where: { userDeviceId: device.id }, data: { revokedAt: now } }),
  ]);

  return NextResponse.json({ ok: true });
}
