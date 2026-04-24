import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { ChatsRealtimeListener } from "./ChatsRealtimeListener";
import { IncomingRequestCards } from "./IncomingRequestCards";

function getChatTypeLabel(type: "DIRECT" | "GROUP") {
  return type === "DIRECT" ? "Личный" : "Группа";
}

function getMessagePreview(message: {
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  body: string | null;
  deletedAt: Date | null;
  attachments: { fileName: string }[];
}) {
  if (message.deletedAt) {
    return "Сообщение удалено";
  }

  if (message.body) {
    return message.body;
  }

  if (message.attachments[0]?.fileName) {
    return message.attachments[0].fileName;
  }

  if (message.type === "IMAGE") {
    return "Фото";
  }

  if (message.type === "VIDEO") {
    return "Видео";
  }

  return "Файл";
}

export default async function ChatsPage() {
  const user = await getCurrentUser();
  const prisma = getPrisma();
  const [chats, incomingRequests] = user
    ? await Promise.all([
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
              select: {
                type: true,
                body: true,
                deletedAt: true,
                createdAt: true,
                attachments: {
                  select: {
                    fileName: true,
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
      ])
    : [[], []];

  return (
    <div className="mx-auto max-w-2xl">
      <ChatsRealtimeListener />
      
      <div className="mb-8 flex items-end justify-between px-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Чаты</h1>
          <p className="mt-1 text-sm text-muted">Ваши приватные диалоги.</p>
        </div>
        <Link
          className="btn-primary flex h-10 items-center px-4 py-0 text-sm"
          href="/chats/new"
        >
          Новый
        </Link>
      </div>

      <IncomingRequestCards
        requests={incomingRequests.map((request) => ({
          ...request,
          createdAt: request.createdAt.toISOString(),
        }))}
      />

      {chats.length === 0 ? (
        <div className="mt-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-hover">
            <span className="text-2xl">💬</span>
          </div>
          <h2 className="text-xl font-semibold">Пока нет чатов</h2>
          <p className="mt-2 text-sm text-muted">Найдите пользователя по username, чтобы начать общение.</p>
          <Link
            className="btn-secondary mt-6 inline-flex h-11 items-center px-6"
            href="/chats/new"
          >
            Найти пользователя
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {chats.map((chat) => {
            const otherMember = chat.members.find((member) => member.user.id !== user?.id);
            const title =
              chat.type === "DIRECT"
                ? otherMember?.user.profile?.displayName ?? otherMember?.user.username ?? "Личный чат"
                : chat.title ?? "Групповой чат";
            const lastMessage = chat.messages[0];
            const preview = lastMessage ? getMessagePreview(lastMessage) : "Нет сообщений";

            return (
              <Link
                className="group flex items-center gap-4 rounded-2xl bg-surface p-4 transition-all hover:bg-surface-hover active:scale-[0.99]"
                href={`/chats/${chat.id}`}
                key={chat.id}
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-surface-hover text-lg font-bold text-primary group-hover:bg-primary/10">
                  {title.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-foreground">{title}</p>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-muted">
                      {getChatTypeLabel(chat.type)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-sm text-muted">{preview}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
