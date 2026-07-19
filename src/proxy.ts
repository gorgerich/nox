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

// Behind a reverse proxy (Railway terminates TLS at the edge and forwards
// internally), the request `NextRequest.nextUrl` sees can have a different
// protocol/host than the public origin the browser actually sent — e.g. an
// internal HTTP hop while the public site is HTTPS. Relying on
// `request.nextUrl.origin` there mismatches the browser's real `Origin`
// header for every unsafe-method API call, including login, hard-locking
// everyone out. Read the edge-set X-Forwarded-* headers first.
function getExpectedOrigin(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
  const proto = forwardedProto || request.nextUrl.protocol.replace(":", "");
  return { origin: `${proto}://${host}`, hostname: host };
}

function hasTrustedBrowserOrigin(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") return false;

  const origin = request.headers.get("origin");
  if (!origin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  // A same-site request always carries a truthful (browser-set, un-spoofable)
  // Origin header. Compare against the forwarded host primarily; also accept
  // a hostname-only match so a proxy-layer scheme mismatch alone can't lock
  // real users out — the security boundary this guards (which SITE issued
  // the request) is unaffected by http vs https on the internal hop.
  const expected = getExpectedOrigin(request);
  return originUrl.origin === expected.origin || originUrl.hostname === expected.hostname;
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
