import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const prisma = getPrisma();
  const [chats, incomingRequests] = await Promise.all([
    prisma.chat.findMany({
      where: {
        members: {
          some: {
            userId: user.id,
            status: "ACTIVE",
          },
        },
      },
      orderBy: { updatedAt: "desc" },
      include: {
        members: {
          where: { status: "ACTIVE" },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profile: {
                  select: {
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            attachments: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                sizeBytes: true,
              },
            },
            sender: {
              select: {
                id: true,
                username: true,
                profile: { select: { displayName: true } },
              },
            },
          },
        },
      },
    }),
    prisma.chatRequest.findMany({
      where: {
        toUserId: user.id,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        message: true,
        createdAt: true,
        fromUser: {
          select: {
            username: true,
            profile: {
              select: {
                displayName: true,
              },
            },
          },
        },
      },
    }),
  ]);

  return NextResponse.json({ chats, incomingRequests });
}
