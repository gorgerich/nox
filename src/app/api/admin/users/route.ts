import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getPrisma } from "@/lib/prisma";

export async function GET() {
  const { response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const prisma = getPrisma();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
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
        },
      },
    },
  });

  return NextResponse.json({ users });
}

