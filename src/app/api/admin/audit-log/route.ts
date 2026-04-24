import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getPrisma } from "@/lib/prisma";

export async function GET() {
  const { response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const prisma = getPrisma();
  const actions = await prisma.adminActionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      action: true,
      targetType: true,
      targetId: true,
      metadata: true,
      createdAt: true,
      admin: {
        select: {
          username: true,
          profile: { select: { displayName: true } },
        },
      },
    },
  });

  return NextResponse.json({ actions });
}
