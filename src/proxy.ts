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

function isUnsafeMethod(method: string) {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function hasTrustedBrowserOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  // Behind a reverse proxy (Railway, etc.) the app only sees the internal
  // bind address, so request.nextUrl.origin does not reflect the public
  // host the browser actually connected to. Compare against the Host (or
  // X-Forwarded-Host) header instead, mirroring how Next.js itself checks
  // Server Action origins.
  const requestHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!requestHost) return false;

  try {
    return new URL(origin).host === requestHost;
  } catch {
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/") && isUnsafeMethod(request.method) && !hasTrustedBrowserOrigin(request)) {
    return NextResponse.json({ error: "Недоверенный источник запроса." }, { status: 403 });
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifyMiddlewareSession(token) : null;

  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/chats/:path*", "/admin/:path*"],
};
