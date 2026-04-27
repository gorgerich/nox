import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

/**
 * GET /api/e2ee/key-bundle?userId=...
 * Fetches a user's public key bundle.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  const prisma = getPrisma();
  const keyBundle = await prisma.userKeyBundle.findUnique({
    where: { userId },
    select: {
      userId: true,
      ecdhPublicKey: true,
    },
  });

  return NextResponse.json({ keyBundle });
}

/**
 * POST /api/e2ee/key-bundle
 * Uploads current user's public key bundle.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { ecdhPublicKey } = body || {};

  if (!ecdhPublicKey) {
    return NextResponse.json({ error: "ecdhPublicKey is required" }, { status: 400 });
  }

  const prisma = getPrisma();
  const existingBundle = await prisma.userKeyBundle.findUnique({
    where: { userId: user.id },
    select: { id: true, ecdhPublicKey: true },
  });

  if (existingBundle && existingBundle.ecdhPublicKey !== ecdhPublicKey) {
    return NextResponse.json(
      {
        error: "KEY_BUNDLE_EXISTS",
        message: "На этом аккаунте уже зарегистрирован другой ключ шифрования.",
      },
      { status: 409 },
    );
  }

  const keyBundle = existingBundle
    ? existingBundle
    : await prisma.userKeyBundle.create({
        data: {
          userId: user.id,
          ecdhPublicKey,
        },
      });

  return NextResponse.json({ ok: true, keyBundle });
}
