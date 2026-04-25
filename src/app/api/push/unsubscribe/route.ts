import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endpoint } = await request.json();

  if (!endpoint) {
    return NextResponse.json({ error: "Invalid endpoint" }, { status: 400 });
  }

  const prisma = getPrisma();
  
  await prisma.pushSubscription.deleteMany({
    where: {
      userId: user.id,
      endpoint: endpoint,
    },
  });

  return NextResponse.json({ success: true });
}
