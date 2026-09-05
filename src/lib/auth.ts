import { cache } from "react";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { getPrisma } from "@/lib/prisma";
import { canUseApp, isEmergencyLocked, type UserRole } from "@/lib/permissions";

export const SESSION_COOKIE_NAME = "pm_session";

export type SessionPayload = {
  userId: string;
  role: UserRole;
  credentialStamp: string;
};

function getJwtSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("AUTH_SECRET is required.");
  }

  return new TextEncoder().encode(secret);
}

export function createCredentialStamp(passwordHash: string | null) {
  return createHmac("sha256", getJwtSecret())
    .update(passwordHash ?? "no-password")
    .digest("base64url");
}

function credentialStampsMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export async function createSessionToken(payload: SessionPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
}

export async function verifySessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());

    if (typeof payload.userId !== "string") {
      return null;
    }

    if (payload.role !== "OWNER" && payload.role !== "ADMIN" && payload.role !== "MEMBER") {
      return null;
    }

    if (typeof payload.credentialStamp !== "string" || payload.credentialStamp.length < 32) {
      return null;
    }

    return {
      userId: payload.userId,
      role: payload.role,
      credentialStamp: payload.credentialStamp,
    } satisfies SessionPayload;
  } catch {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  return verifySessionToken(token);
}

// Wrapped in React cache() so multiple calls within the same server request
// (layout + page + nested server components + route handler) share one result
// instead of re-querying the database each time.
export const getCurrentUser = cache(async () => {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const prisma = getPrisma();
  // Both queries are independent — run them concurrently so we don't add an
  // extra sequential DB round-trip to every authenticated request/page render.
  const [user, emergencyLocked] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        passwordHash: true,
        createdAt: true,
        profile: {
          select: {
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    }),
    isEmergencyLocked(),
  ]);

  if (!user || !credentialStampsMatch(session.credentialStamp, createCredentialStamp(user.passwordHash))) {
    return null;
  }

  if (!canUseApp(user, emergencyLocked)) {
    return null;
  }

  const { passwordHash, ...safeUser } = user;
  void passwordHash;
  return safeUser;
});

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}
