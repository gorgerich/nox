import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { IncomingRequestCards } from "./IncomingRequestCards";

function formatChatTime(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

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
    <section className="lg:grid lg:gap-6 lg:grid-cols-[340px_1fr]">
      <aside className="min-h-[calc(100svh-88px)] rounded-lg border border-neutral-800 bg-neutral-900 p-4 sm:min-h-[calc(100svh-112px)]">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Чаты</h1>
            {incomingRequests.length > 0 ? (
              <p className="mt-1 text-sm text-emerald-300">
                {incomingRequests.length === 1
                  ? "У вас новый запрос на общение"
                  : `Новые запросы на общение: ${incomingRequests.length}`}
              </p>
            ) : null}
          </div>
          <Link
            className="inline-flex min-h-11 items-center rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400"
            href="/chats/new"
          >
            Создать
          </Link>
        </div>

        <IncomingRequestCards
          requests={incomingRequests.map((request) => ({
            ...request,
            createdAt: request.createdAt.toISOString(),
          }))}
        />

        {chats.length === 0 ? (
          <div className="mt-6 rounded-md border border-dashed border-neutral-700 p-5 text-sm text-neutral-400">
            <h2 className="text-lg font-semibold text-neutral-100">У вас пока нет чатов</h2>
            <p className="mt-2">Найдите пользователя по username и отправьте запрос на общение.</p>
            <Link
              className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-neutral-700 px-4 text-sm text-neutral-200 transition hover:border-neutral-500 hover:text-white sm:w-auto"
              href="/chats/new"
            >
              Создать чат
            </Link>
          </div>
        ) : (
          <div className="mt-6 grid gap-2">
            {chats.map((chat) => {
              const otherMember = chat.members.find((member) => member.user.id !== user?.id);
              const title =
                chat.type === "DIRECT"
                  ? otherMember?.user.profile?.displayName ?? otherMember?.user.username ?? "Личный чат"
                  : chat.title ?? "Групповой чат";
              const lastMessage = chat.messages[0];
              const preview = lastMessage ? getMessagePreview(lastMessage) : "Сообщений пока нет";

              return (
                <Link
                  className="block rounded-md border border-neutral-800 bg-neutral-950 p-4 transition hover:border-neutral-600"
                  href={`/chats/${chat.id}`}
                  key={chat.id}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-base font-medium text-neutral-100">{title}</p>
                    <span className="shrink-0 rounded-full bg-neutral-800 px-2 py-1 text-xs text-neutral-400">
                      {getChatTypeLabel(chat.type)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm text-neutral-500">{preview}</p>
                </Link>
              );
            })}
          </div>
        )}
      </aside>

      <section className="mt-6 hidden min-h-[480px] rounded-lg border border-neutral-800 bg-neutral-900 p-6 lg:mt-0 lg:block">
        <p className="text-sm text-neutral-400">Вы вошли как {user?.profile?.displayName ?? user?.username}</p>
        {chats.length === 0 ? (
          <div className="mt-24 text-center">
            <h2 className="text-2xl font-semibold">У вас пока нет чатов</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-neutral-400">
              Найдите пользователя по username и отправьте запрос на общение.
            </p>
            <Link
              className="mt-6 inline-flex h-11 items-center rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400"
              href="/chats/new"
            >
              Создать чат
            </Link>
          </div>
        ) : (
          <div className="mt-8">
            <h2 className="text-2xl font-semibold">Последние чаты</h2>
            <div className="mt-5 grid gap-3">
              {chats.slice(0, 5).map((chat) => {
                const otherMember = chat.members.find((member) => member.user.id !== user?.id);
                const title =
                  chat.type === "DIRECT"
                    ? otherMember?.user.profile?.displayName ?? otherMember?.user.username ?? "Личный чат"
                    : chat.title ?? "Групповой чат";

                return (
                  <Link
                    className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-950 p-4 transition hover:border-neutral-600"
                    href={`/chats/${chat.id}`}
                    key={chat.id}
                  >
                    <div>
                      <p className="font-medium">{title}</p>
                      <p className="mt-1 text-sm text-neutral-500">
                        Участников: {chat.members.length}
                      </p>
                    </div>
                    <span className="text-sm text-neutral-500">{formatChatTime(chat.updatedAt)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
