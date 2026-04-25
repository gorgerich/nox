import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const MIN_QUERY_LENGTH = 3;
const USERS_LIMIT = 5;
const CHATS_LIMIT = 10;
const MESSAGES_LIMIT = 20;

export async function GET(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ people: [], chats: [], messages: [] });
  }

  const prisma = getPrisma();

  const [people, chats, messages] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: "ACTIVE",
        id: { not: user.id },
        OR: [
          { username: { contains: q, mode: "insensitive" } },
          { profile: { displayName: { contains: q, mode: "insensitive" } } },
        ],
      },
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
      orderBy: { username: "asc" },
      take: USERS_LIMIT,
    }),
    prisma.chat.findMany({
      where: {
        members: {
          some: {
            userId: user.id,
            status: "ACTIVE",
          },
        },
        OR: [
          { title: { contains: q, mode: "insensitive" } },
          {
            members: {
              some: {
                status: "ACTIVE",
                userId: { not: user.id },
                user: {
                  OR: [
                    { username: { contains: q, mode: "insensitive" } },
                    { profile: { displayName: { contains: q, mode: "insensitive" } } },
                  ],
                },
              },
            },
          },
        ],
      },
      select: {
        id: true,
        type: true,
        title: true,
        members: {
          where: {
            status: "ACTIVE",
            userId: { not: user.id },
          },
          select: {
            user: {
              select: {
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
        },
      },
      orderBy: { updatedAt: "desc" },
      take: CHATS_LIMIT,
    }),
    prisma.message.findMany({
      where: {
        deletedAt: null,
        body: { contains: q, mode: "insensitive" },
        chat: {
          members: {
            some: {
              userId: user.id,
              status: "ACTIVE",
            },
          },
        },
      },
      select: {
        id: true,
        body: true,
        chatId: true,
        createdAt: true,
        sender: {
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
      orderBy: { createdAt: "desc" },
      take: MESSAGES_LIMIT,
    }),
  ]);

  return NextResponse.json({
    people: people.map((person) => ({
      id: person.id,
      username: person.username,
      displayName: person.profile?.displayName || person.username,
      profile: person.profile,
    })),
    chats: chats.map((chat) => ({
      id: chat.id,
      type: chat.type,
      title:
        chat.type === "DIRECT"
          ? (chat.members[0]?.user.profile?.displayName || chat.members[0]?.user.username || "Личный чат")
          : chat.title || "Группа",
      avatarUrl: chat.type === "DIRECT" ? chat.members[0]?.user.profile?.avatarUrl : null,
    })),
    messages: messages.map((message) => ({
      id: message.id,
      body: message.body,
      chatId: message.chatId,
      createdAt: message.createdAt,
      senderName: message.sender.profile?.displayName || message.sender.username,
    })),
  });
}
