import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { createPublicKeyFingerprint, formatFingerprint } from "@/lib/e2ee/fingerprint";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const currentDeviceId = searchParams.get("currentDeviceId") || request.headers.get("x-nox-device-id") || null;
  const prisma = getPrisma();

  const devices = await prisma.userDevice.findMany({
    where: { userId: user.id },
    orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }, { createdAt: "desc" }],
    include: { keyBundle: true },
  });

  return NextResponse.json({
    devices: devices.map((device) => {
      const fingerprint = device.keyBundle?.publicKey ? createPublicKeyFingerprint(device.keyBundle.publicKey) : null;
      return {
        deviceId: device.deviceId,
        name: device.name,
        platform: device.platform,
        userAgent: device.userAgent,
        createdAt: device.createdAt.toISOString(),
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
        revokedAt: device.revokedAt?.toISOString() ?? null,
        isCurrentDevice: currentDeviceId === device.deviceId,
        fingerprint,
        fingerprintShort: fingerprint ? formatFingerprint(fingerprint) : null,
      };
    }),
  });
}
