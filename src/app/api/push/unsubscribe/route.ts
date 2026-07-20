import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // endpoint is a web-push URL or (for kind="fcm" rows) a raw FCM token.
  const parsed = z.object({ endpoint: z.string().min(16).max(4_096) }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }
  const { endpoint } = parsed.data;

  const prisma = getPrisma();
  
  await prisma.pushSubscription.deleteMany({
    where: {
      userId: user.id,
      endpoint: endpoint,
    },
  });

  return NextResponse.json({ success: true });
}
