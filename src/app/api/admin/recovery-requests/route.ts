import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { getPrisma } from "@/lib/prisma";

export async function GET() {
  const { response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const prisma = getPrisma();
  const requests = await prisma.accountRecoveryRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      user: {
        select: {
          id: true,
          login: true,
          username: true,
          email: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      },
    },
  });

  return NextResponse.json({
    requests: requests.map((request) => ({
      id: request.id,
      publicCode: request.publicCode,
      status: request.status,
      requesterUserAgent: request.requesterUserAgent,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
      approvedAt: request.approvedAt,
      deniedAt: request.deniedAt,
      usedAt: request.usedAt,
      user: request.user,
    })),
  });
}
