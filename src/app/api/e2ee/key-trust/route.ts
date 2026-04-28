import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { createPublicKeyFingerprint, formatFingerprint } from "@/lib/e2ee/fingerprint";

const trustSchema = z.object({
  targetUserId: z.string().uuid(),
  targetDeviceId: z.string().min(8).max(120),
  publicKeyFingerprint: z.string().min(32).max(128),
  verified: z.boolean().default(true),
});

async function canAccessUserDevices(currentUserId: string, targetUserId: string, chatId?: string | null) {
  if (currentUserId === targetUserId) return true;
  const prisma = getPrisma();
  const where = chatId
    ? {
        id: chatId,
        members: { some: { userId: currentUserId, status: "ACTIVE" as const } },
        AND: { members: { some: { userId: targetUserId, status: "ACTIVE" as const } } },
      }
    : {
        type: "DIRECT" as const,
        members: { some: { userId: currentUserId, status: "ACTIVE" as const } },
        AND: { members: { some: { userId: targetUserId, status: "ACTIVE" as const } } },
      };
  const sharedChat = await prisma.chat.findFirst({ where, select: { id: true } });
  return Boolean(sharedChat);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const targetUserId = searchParams.get("userId");
  const chatId = searchParams.get("chatId");
  if (!targetUserId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (!(await canAccessUserDevices(user.id, targetUserId, chatId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const prisma = getPrisma();
  const devices = await prisma.deviceKeyBundle.findMany({
    where: { userId: targetUserId, userDevice: { revokedAt: null } },
    orderBy: { createdAt: "asc" },
    include: { userDevice: true },
  });

  const trustRows = await prisma.e2EEDeviceTrust.findMany({
    where: { ownerId: user.id, targetUserId },
  });

  return NextResponse.json({
    devices: devices.map((device) => {
      const fingerprint = createPublicKeyFingerprint(device.publicKey);
      const matchingTrust = trustRows.find((row) => row.targetDeviceId === device.deviceId && row.publicKeyFingerprint === fingerprint);
      const changedTrust = trustRows.some((row) => row.targetDeviceId === device.deviceId && row.publicKeyFingerprint !== fingerprint);
      return {
        userId: device.userId,
        deviceId: device.deviceId,
        name: device.userDevice.name,
        platform: device.userDevice.platform,
        createdAt: device.createdAt.toISOString(),
        lastSeenAt: device.userDevice.lastSeenAt?.toISOString() ?? null,
        revokedAt: device.revokedAt?.toISOString() ?? device.userDevice.revokedAt?.toISOString() ?? null,
        fingerprint,
        fingerprintShort: formatFingerprint(fingerprint),
        verifiedAt: matchingTrust?.verifiedAt?.toISOString() ?? null,
        isVerified: Boolean(matchingTrust?.verifiedAt),
        keyChanged: changedTrust,
      };
    }),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = trustSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid trust payload" }, { status: 400 });

  const prisma = getPrisma();
  const { targetUserId, targetDeviceId, publicKeyFingerprint, verified } = parsed.data;
  if (!(await canAccessUserDevices(user.id, targetUserId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const device = await prisma.deviceKeyBundle.findFirst({
    where: { userId: targetUserId, deviceId: targetDeviceId, userDevice: { revokedAt: null }, revokedAt: null },
    select: { publicKey: true },
  });
  if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });

  const currentFingerprint = createPublicKeyFingerprint(device.publicKey);
  if (currentFingerprint !== publicKeyFingerprint) {
    return NextResponse.json({ error: "Fingerprint mismatch" }, { status: 409 });
  }

  const trust = await prisma.e2EEDeviceTrust.upsert({
    where: {
      ownerId_targetDeviceId_publicKeyFingerprint: {
        ownerId: user.id,
        targetDeviceId,
        publicKeyFingerprint,
      },
    },
    update: { verifiedAt: verified ? new Date() : null, targetUserId },
    create: {
      ownerId: user.id,
      targetUserId,
      targetDeviceId,
      publicKeyFingerprint,
      verifiedAt: verified ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true, verifiedAt: trust.verifiedAt?.toISOString() ?? null });
}
