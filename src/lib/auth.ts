import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { getPrisma } from "@/lib/prisma";
import { canUseApp, isEmergencyLocked, type UserRole } from "@/lib/permissions";

export const SESSION_COOKIE_NAME = "pm_session";

export type SessionPayload = {
  userId: string;
  role: UserRole;
};

function getJwtSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("AUTH_SECRET is required.");
  }

  return new TextEncoder().encode(secret);
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

    return {
      userId: payload.userId,
      role: payload.role,
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

export async function getCurrentUser() {
  const session = await getSession();

  if (!session) {
    return null;
  }

  const prisma = getPrisma();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      status: true,
      createdAt: true,
      profile: {
        select: {
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  if (!user) {
    return null;
  }

  const emergencyLocked = await isEmergencyLocked();

  if (!canUseApp(user, emergencyLocked)) {
    return null;
  }

  return user;
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  };
}
