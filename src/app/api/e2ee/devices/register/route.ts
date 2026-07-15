import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { isValidEcdhPublicKey } from "@/lib/e2ee/validation";

const E2EE_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES-GCM";

const registerSchema = z.object({
  deviceId: z.string().min(8).max(120),
  publicKey: z.string().min(20).max(2_048),
  algorithm: z.literal(E2EE_ALGORITHM),
  name: z.string().max(120).optional(),
  userAgent: z.string().max(600).optional(),
  platform: z.string().max(120).optional(),
  privateKey: z.never().optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (body && typeof body === "object" && "privateKey" in body) {
    return NextResponse.json({ error: "Private key must never be uploaded" }, { status: 400 });
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid device registration" }, { status: 400 });
  }

  if (!isValidEcdhPublicKey(parsed.data.publicKey)) {
    return NextResponse.json({ error: "Invalid ECDH public key" }, { status: 400 });
  }

  const prisma = getPrisma();
  const now = new Date();
  const { deviceId, publicKey, algorithm, name, userAgent, platform } = parsed.data;

  const existingDevice = await prisma.userDevice.findUnique({
    where: { deviceId },
    include: { keyBundle: true },
  });

  if (existingDevice && existingDevice.userId !== user.id) {
    return NextResponse.json({ error: "DEVICE_BELONGS_TO_ANOTHER_USER" }, { status: 403 });
  }

  if (existingDevice?.revokedAt) {
    return NextResponse.json({ error: "DEVICE_REVOKED" }, { status: 403 });
  }

  if (existingDevice?.keyBundle && existingDevice.keyBundle.publicKey !== publicKey) {
    return NextResponse.json({ error: "DEVICE_KEY_MISMATCH" }, { status: 409 });
  }

  const userDevice = await prisma.userDevice.upsert({
    where: { deviceId },
    update: {
      name,
      userAgent,
      platform,
      lastSeenAt: now,
    },
    create: {
      userId: user.id,
      deviceId,
      name,
      userAgent,
      platform,
      lastSeenAt: now,
    },
  });

  const keyBundle = await prisma.deviceKeyBundle.upsert({
    where: { userDeviceId: userDevice.id },
    update: {
      algorithm,
    },
    create: {
      userDeviceId: userDevice.id,
      userId: user.id,
      deviceId,
      publicKey,
      algorithm,
    },
  });

  return NextResponse.json({ ok: true, device: userDevice, keyBundle });
}
