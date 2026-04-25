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
    <div className="mx-auto max-w-2xl py-6 transition-smooth">
      <ChatsRealtimeListener />
      
      <div className="mb-6 flex items-center justify-between px-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Чаты</h1>
        <Link
          className="touch-target h-11 w-11 flex items-center justify-center rounded-full bg-primary/10 text-primary transition-smooth active:scale-90 hover:bg-primary/20"
          href="/chats/new"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </Link>
      </div>

      <div className="mb-6 px-2">
        <ChatSearch />
      </div>

      {incomingRequests.length > 0 && (
        <div className="mb-8 animate-in slide-in-from-top-2 duration-500">
          <h2 className="px-2 text-[10px] font-bold uppercase tracking-widest text-muted mb-4 opacity-80">Запросы на переписку</h2>
          <IncomingRequestCards
            requests={incomingRequests.map((request) => ({
              ...request,
              createdAt: request.createdAt.toISOString(),
            }))}
          />
        </div>
      )}

      {sortedChats.length === 0 ? (
        <div className="mt-24 text-center animate-in fade-in zoom-in-95 duration-700">
          <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-full bg-surface-hover/30 border border-border-subtle/50 shadow-inner">
            <span className="text-4xl">💬</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground/90">Начните общение</h2>
          <p className="mt-3 text-base text-muted max-w-[240px] mx-auto leading-relaxed">Здесь будут отображаться ваши диалоги с другими пользователями.</p>
          <Link
            className="btn-nox mt-10 inline-flex h-14 items-center rounded-3xl bg-primary px-10 text-sm font-bold text-neutral-950 transition-smooth active:scale-95 shadow-lg shadow-primary/20"
            href="/chats/new"
          >
            Найти собеседника
          </Link>
        </div>
      ) : (
        <div className="space-y-0.5 animate-in fade-in duration-500">
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
                className="group relative flex items-center gap-4 rounded-[2rem] p-4 transition-smooth hover:bg-surface-hover active:scale-[0.98] active:bg-surface-hover/70"
              >
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-surface-hover text-xl font-black text-primary transition-smooth group-hover:scale-105 group-hover:bg-primary/10 shadow-sm">
                  {title[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1 border-b border-border-subtle/20 pb-4 group-last:border-none">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className={`truncate text-base font-bold tracking-tight ${chat.unreadCount > 0 ? "text-foreground" : "text-foreground/80"}`}>{title}</p>
                    <span className="shrink-0 text-[10px] font-bold uppercase tracking-tighter text-muted/60">
                      {formatChatTime(lastActivityTime)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm leading-snug ${chat.unreadCount > 0 ? "text-foreground/70 font-semibold" : "text-muted"}`}>
                      {preview}
                    </p>
                    {chat.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-black text-neutral-950 shadow-sm shadow-primary/30">
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
