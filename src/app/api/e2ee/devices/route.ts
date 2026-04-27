import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

async function canAccessUserDevices(currentUserId: string, targetUserId: string, chatId?: string | null) {
  if (currentUserId === targetUserId) return true;

  const prisma = getPrisma();
  if (chatId) {
    const sharedChat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        members: {
          some: { userId: currentUserId, status: "ACTIVE" },
        },
        AND: {
          members: { some: { userId: targetUserId, status: "ACTIVE" } },
        },
      },
      select: { id: true },
    });

    return Boolean(sharedChat);
  }

  const sharedChat = await prisma.chat.findFirst({
    where: {
      type: "DIRECT",
      members: {
        some: { userId: currentUserId, status: "ACTIVE" },
      },
      AND: {
        members: { some: { userId: targetUserId, status: "ACTIVE" } },
      },
    },
    select: { id: true },
  });

  return Boolean(sharedChat);
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId") || user.id;
  const deviceId = searchParams.get("deviceId");
  const chatId = searchParams.get("chatId");

  const prisma = getPrisma();

  if (deviceId) {
    const device = await prisma.deviceKeyBundle.findFirst({
      where: {
        deviceId,
        revokedAt: null,
        userDevice: { revokedAt: null },
      },
      select: {
        userId: true,
        deviceId: true,
        publicKey: true,
        algorithm: true,
        userDevice: { select: { name: true, platform: true, lastSeenAt: true } },
      },
    });

    if (!device || !(await canAccessUserDevices(user.id, device.userId, chatId))) {
      return NextResponse.json({ error: "Device not found" }, { status: 404 });
    }

    return NextResponse.json({
      device: {
        userId: device.userId,
        deviceId: device.deviceId,
        publicKey: device.publicKey,
        algorithm: device.algorithm,
        name: device.userDevice.name,
        platform: device.userDevice.platform,
        lastSeenAt: device.userDevice.lastSeenAt?.toISOString() ?? null,
      },
    });
  }

  if (!(await canAccessUserDevices(user.id, userId, chatId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const devices = await prisma.deviceKeyBundle.findMany({
    where: {
      userId,
      revokedAt: null,
      userDevice: { revokedAt: null },
    },
    orderBy: { createdAt: "asc" },
    select: {
      userId: true,
      deviceId: true,
      publicKey: true,
      algorithm: true,
      userDevice: { select: { name: true, platform: true, lastSeenAt: true } },
    },
  });

  return NextResponse.json({
    devices: devices.map((device) => ({
      userId: device.userId,
      deviceId: device.deviceId,
      publicKey: device.publicKey,
      algorithm: device.algorithm,
      name: device.userDevice.name,
      platform: device.userDevice.platform,
      lastSeenAt: device.userDevice.lastSeenAt?.toISOString() ?? null,
    })),
  });
}
