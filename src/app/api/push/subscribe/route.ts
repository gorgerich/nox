import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const webPushSchema = z.object({
  endpoint: z.string().url().max(2_048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }),
  keys: z.object({
    p256dh: z.string().min(40).max(256),
    auth: z.string().min(8).max(128),
  }),
});

// Native Android (Capacitor) registers an FCM device token instead of a
// web-push subscription. Stored in the same table with kind="fcm" and the
// token in the endpoint column.
const fcmSchema = z.object({
  fcmToken: z.string().min(32).max(4_096).regex(/^[A-Za-z0-9_:\-.]+$/),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rateLimit = checkRateLimit(request, `push:subscribe:${user.id}`, { limit: 20, windowMs: 60 * 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many subscriptions" }, { status: 429 });
  }

  const body = await request.json().catch(() => null);
  const prisma = getPrisma();
  const userAgent = request.headers.get("user-agent");

  const fcmParsed = fcmSchema.safeParse(body);
  if (fcmParsed.success) {
    await prisma.pushSubscription.upsert({
      where: { endpoint: fcmParsed.data.fcmToken },
      update: { userId: user.id, kind: "fcm", disabledAt: null, userAgent },
      create: {
        userId: user.id,
        kind: "fcm",
        endpoint: fcmParsed.data.fcmToken,
        p256dh: "",
        auth: "",
        userAgent,
      },
    });
    return NextResponse.json({ success: true });
  }

  const parsed = webPushSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const subscription = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: {
      userId: user.id,
      kind: "webpush",
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      disabledAt: null,
      userAgent,
    },
    create: {
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
    },
  });

  return NextResponse.json({ success: true });
}
