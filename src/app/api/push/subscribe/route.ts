import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";

const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2_048).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }),
  keys: z.object({
    p256dh: z.string().min(40).max(256),
    auth: z.string().min(8).max(128),
  }),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rateLimit = checkRateLimit(request, `push:subscribe:${user.id}`, { limit: 20, windowMs: 60 * 60_000 });
  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "Too many subscriptions" }, { status: 429 });
  }

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid subscription" }, { status: 400 });
  }
  const subscription = parsed.data;

  const prisma = getPrisma();
  
  await prisma.pushSubscription.upsert({
    where: { endpoint: subscription.endpoint },
    update: {
      userId: user.id,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      disabledAt: null,
      userAgent: request.headers.get("user-agent"),
    },
    create: {
      userId: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent: request.headers.get("user-agent"),
    },
  });

  return NextResponse.json({ success: true });
}
