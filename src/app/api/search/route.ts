import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

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
  const mode: Prisma.QueryMode = "insensitive";

  const [people, chats, messages] = await Promise.all([
    prisma.user.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { username: { contains: q, mode } },
          { profile: { displayName: { contains: q, mode } } },
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
          { title: { contains: q, mode } },
          {
            type: "DIRECT",
            members: {
              some: {
                status: "ACTIVE",
                user: {
                  OR: [
                    { username: { contains: q, mode } },
                    { profile: { displayName: { contains: q, mode } } },
                  ],
                },
              },
            },
          },
          // Favorites search: direct chats with self
          {
            type: "DIRECT",
            members: {
              every: { userId: user.id }
            },
            OR: [
              "избранное".includes(q.toLowerCase()) ? { type: "DIRECT" } : { id: "none" },
              "saved".includes(q.toLowerCase()) ? { type: "DIRECT" } : { id: "none" },
            ]
          }
        ],
      },
      select: {
        id: true,
        type: true,
        title: true,
        members: {
          where: {
            status: "ACTIVE",
          },
          select: {
            userId: true,
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
        body: { contains: q, mode },
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
      isSelf: person.id === user.id,
    })),
    chats: chats.map((chat) => {
      const otherMember = chat.members.find(m => m.userId !== user.id);
      const isSelfChat = chat.type === "DIRECT" && chat.members.length === 1 && chat.members[0].userId === user.id;
      
      return {
        id: chat.id,
        type: chat.type,
        title: chat.type === "DIRECT"
          ? (isSelfChat ? "Личное" : (otherMember?.user.profile?.displayName || otherMember?.user.username || "Личный чат"))
          : chat.title || "Группа",
        avatarUrl: chat.type === "DIRECT" ? (isSelfChat ? null : otherMember?.user.profile?.avatarUrl) : null,
        isSelfChat,
      };
    }),
    messages: messages.map((message) => ({
      id: message.id,
      body: message.body,
      chatId: message.chatId,
      createdAt: message.createdAt,
      senderName: message.sender.profile?.displayName || message.sender.username,
    })),
  });
}
