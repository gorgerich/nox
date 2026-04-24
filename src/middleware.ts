import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE_NAME = "pm_session";

function getJwtSecret() {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("AUTH_SECRET is required.");
  }

  return new TextEncoder().encode(secret);
}

async function verifyMiddlewareSession(token: string) {
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
    };
  } catch {
    return null;
  }
}

function isAdminRole(role: string) {
  return role === "OWNER" || role === "ADMIN";
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyMiddlewareSession(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (pathname.startsWith("/admin") && !isAdminRole(session.role)) {
    return NextResponse.redirect(new URL("/chats", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/chats/:path*", "/admin/:path*"],
};
