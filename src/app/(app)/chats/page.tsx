import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { ChatsRealtimeListener } from "./ChatsRealtimeListener";
import { IncomingRequestCards } from "./IncomingRequestCards";
import { ChatSearch } from "./ChatSearch";

function formatChatTime(value: Date) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const date = new Date(value.getFullYear(), value.getMonth(), value.getDate());

  if (date.getTime() === today.getTime()) {
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
  }).format(value);
}

function getMessagePreview(message: {
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  body: string | null;
  deletedAt: Date | null;
  attachments: { fileName: string }[];
}) {
  if (message.deletedAt) return "Сообщение удалено";
  if (message.body) return message.body;
  if (message.attachments[0]?.fileName) return message.attachments[0].fileName;
  if (message.type === "IMAGE") return "Фото";
  if (message.type === "VIDEO") return "Видео";
  if (message.type === "VOICE") return "Голосовое сообщение";
  return "Файл";
}

export default async function ChatsPage() {
  const user = await getCurrentUser();
  const prisma = getPrisma();
  
  if (!user) return null;

  const [rawChats, incomingRequests] = await Promise.all([
    prisma.chat.findMany({
      where: {
        members: { some: { userId: user.id, status: "ACTIVE" } },
      },
      include: {
        members: {
          where: { status: "ACTIVE" },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                profile: { select: { displayName: true } },
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
            attachments: { select: { fileName: true } },
          },
        },
      },
    }),
    prisma.chatRequest.findMany({
      where: { toUserId: user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        message: true,
        createdAt: true,
        fromUser: {
          select: {
            username: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    }),
  ]);

  const chats = await Promise.all(rawChats.map(async (chat) => {
    const member = chat.members.find(m => m.userId === user.id);
    const unreadCount = await prisma.message.count({
      where: {
        chatId: chat.id,
        senderUserId: { not: user.id },
        deletedAt: null,
        createdAt: { gt: member?.lastReadAt ?? new Date(0) },
      },
    });
    return { ...chat, unreadCount };
  }));

  const sortedChats = chats.sort((a, b) => {
    const aTime = a.messages[0]?.createdAt ?? a.createdAt;
    const bTime = b.messages[0]?.createdAt ?? b.createdAt;
    return bTime.getTime() - aTime.getTime();
  });

  return (
    <div className="mx-auto max-w-2xl py-4 pb-24">
      <ChatsRealtimeListener />
      
      <div className="mb-6 flex items-center justify-between px-2">
        <h1 className="text-2xl font-bold tracking-tight">Чаты</h1>
        <Link
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary transition active:scale-90"
          href="/chats/new"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
        </Link>
      </div>

      <ChatSearch />

      {incomingRequests.length > 0 && (
        <div className="mb-8">
          <h2 className="px-2 text-[10px] font-bold uppercase tracking-widest text-muted mb-3">Запросы</h2>
          <IncomingRequestCards
            requests={incomingRequests.map((request) => ({
              ...request,
              createdAt: request.createdAt.toISOString(),
            }))}
          />
        </div>
      )}

      {sortedChats.length === 0 ? (
        <div className="mt-20 text-center animate-in fade-in duration-700">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-hover/50">
            <span className="text-3xl opacity-50">💬</span>
          </div>
          <h2 className="text-xl font-semibold">Начните общение</h2>
          <p className="mt-2 text-sm text-muted">Ваш список чатов пока пуст.</p>
          <Link
            className="mt-8 inline-flex h-12 items-center rounded-2xl bg-primary px-8 text-sm font-bold text-neutral-950 transition active:scale-95"
            href="/chats/new"
          >
            Найти первого собеседника
          </Link>
        </div>
      ) : (
        <div className="space-y-1">
          {sortedChats.map((chat) => {
            const otherMember = chat.members.find((member) => member.user.id !== user.id);
            const title = chat.type === "DIRECT"
              ? otherMember?.user.profile?.displayName ?? otherMember?.user.username ?? "Личный чат"
              : chat.title ?? "Группа";
            const lastMessage = chat.messages[0];
            const preview = lastMessage ? getMessagePreview(lastMessage) : "Нет сообщений";
            const lastActivityTime = lastMessage?.createdAt ?? chat.createdAt;

            return (
              <Link
                key={chat.id}
                href={`/chats/${chat.id}`}
                className="group relative flex items-center gap-4 rounded-3xl p-3 transition-all hover:bg-surface active:scale-[0.98]"
              >
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface-hover text-xl font-bold text-primary transition-colors group-hover:bg-primary/5">
                  {title[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 border-b border-border-subtle/30 pb-3 group-last:border-none">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className={`truncate font-bold ${chat.unreadCount > 0 ? "text-foreground" : "text-foreground/90"}`}>{title}</p>
                    <span className="shrink-0 text-[10px] font-medium text-muted">
                      {formatChatTime(lastActivityTime)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${chat.unreadCount > 0 ? "text-foreground/70 font-medium" : "text-muted"}`}>
                      {preview}
                    </p>
                    {chat.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-neutral-950">
                        {chat.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
