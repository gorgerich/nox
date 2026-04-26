import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { ChatsRealtimeListener } from "./ChatsRealtimeListener";
import { IncomingRequestCards } from "./IncomingRequestCards";
import { ChatSearch } from "./ChatSearch";
import Image from "next/image";

function formatChatTime(date: Date) {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 1000 * 60 * 60 * 24;

  if (diff < day && now.getDate() === date.getDate()) {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (diff < day * 7) {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

function getMessagePreview(message: {
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  body: string | null;
  deletedAt: Date | null;
  attachments: { fileName: string }[];
}) {
  if (message.deletedAt) return "Сообщение удалено";
  if (message.type === "VOICE") return "Голосовое сообщение";
  if (message.body) return message.body;
  if (message.attachments[0]?.fileName) return message.attachments[0].fileName;
  if (message.type === "IMAGE") return "Фото";
  if (message.type === "VIDEO") return "Видео";
  return "Файл";
}

export default async function ChatsPage() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
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
        },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: {
            attachments: { select: { fileName: true } },
          },
        },
      },
    }),
    prisma.chatRequest.findMany({
      where: {
        toUserId: user.id,
        status: "PENDING",
      },
      include: {
        fromUser: {
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
    }),
  ]);

  const chatsWithUnread = await Promise.all(
    chats.map(async (chat) => {
      const membership = chat.members.find((m) => m.userId === user.id);
      const unreadCount = await prisma.message.count({
        where: {
          chatId: chat.id,
          createdAt: { gt: membership?.lastReadAt ?? new Date(0) },
          senderUserId: { not: user.id },
          deletedAt: null,
        },
      });
      return { ...chat, unreadCount };
    }),
  );

  const sortedChats = chatsWithUnread.sort((a, b) => {
    const timeA = a.messages[0]?.createdAt ?? a.createdAt;
    const timeB = b.messages[0]?.createdAt ?? b.createdAt;
    return timeB.getTime() - timeA.getTime();
  });

  return (
    <div className="app-section transition-smooth">
      <ChatsRealtimeListener />
      
      <div className="app-section-header px-2">
        <h1 className="app-section-title">Чаты</h1>
        <Link
          className="touch-target h-14 w-14 flex items-center justify-center rounded-[1.5rem] bg-primary/10 text-primary transition-smooth active:scale-90 hover:bg-primary/20 shadow-sm border border-primary/20"
          href="/chats/new"
        >
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </Link>
      </div>

      <div className="mb-8 px-2">
        <ChatSearch />
      </div>

      {incomingRequests.length > 0 && (
        <div className="mb-10 animate-in slide-in-from-top-2 duration-500">
          <h2 className="px-3 text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 mb-5">Запросы на переписку</h2>
          <IncomingRequestCards
            requests={incomingRequests.map((request) => ({
              ...request,
              createdAt: request.createdAt.toISOString(),
            }))}
          />
        </div>
      )}

      {sortedChats.length === 0 ? (
        <div className="mt-20 text-center animate-in fade-in zoom-in-95 duration-700">
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-[2.5rem] bg-surface-muted border border-border-subtle/50 shadow-inner">
            <span className="text-4xl">💬</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-foreground/90">Начните общение</h2>
          <p className="mt-3 text-base text-muted/60 max-w-[240px] mx-auto leading-relaxed font-medium">Здесь будут отображаться ваши диалоги с другими пользователями.</p>
          <Link
            className="btn-nox mt-10 inline-flex h-14 items-center rounded-3xl bg-primary px-10 text-sm font-black text-white transition-smooth active:scale-95 shadow-xl shadow-primary/20"
            href="/chats/new"
          >
            НАЙТИ СОБЕСЕДНИКА
          </Link>
        </div>
      ) : (
        <div className="space-y-1 animate-in fade-in duration-500">
          {sortedChats.map((chat) => {
            const otherMember = chat.members.find((member) => member.user.id !== user.id);
            const title = chat.type === "DIRECT"
              ? otherMember?.user.profile?.displayName ?? otherMember?.user.username ?? "Личный чат"
              : chat.title ?? "Группа";
            const lastMessage = chat.messages[0];
            const preview = lastMessage ? getMessagePreview(lastMessage) : "Нет сообщений";
            const lastActivityTime = lastMessage?.createdAt ?? chat.createdAt;
            const avatarUrl = otherMember?.user.profile?.avatarUrl;
            const fullAvatarUrl = avatarUrl 
              ? (avatarUrl.startsWith('http') ? avatarUrl : `/api/avatars/${avatarUrl}`)
              : null;

            return (
              <Link
                key={chat.id}
                href={`/chats/${chat.id}`}
                className="group relative flex items-center gap-4 rounded-[2rem] p-4 transition-smooth hover:bg-surface-hover active:scale-[0.98] active:bg-surface-muted/50 border border-transparent hover:border-border-subtle/50"
              >
                <div className="relative flex h-15 w-15 shrink-0 items-center justify-center rounded-2xl bg-surface-muted overflow-hidden shadow-sm border border-border-subtle/30 transition-smooth group-hover:scale-105">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt={title} fill className="object-cover" />
                  ) : (
                    <span className="text-2xl font-black text-primary uppercase">{title[0]}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1 border-b border-border-subtle/20 pb-4 group-last:border-none">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className={`truncate text-base font-black tracking-tight ${chat.unreadCount > 0 ? "text-foreground" : "text-foreground/80"}`}>{title}</p>
                    <span className="shrink-0 text-[10px] font-black uppercase tracking-tighter text-muted/50">
                      {formatChatTime(lastActivityTime)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm leading-snug font-medium ${chat.unreadCount > 0 ? "text-foreground/70 font-black" : "text-muted/60"}`}>
                      {preview}
                    </p>
                    {chat.unreadCount > 0 && (
                      <span className="flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-primary px-2 text-[10px] font-black text-white shadow-lg shadow-primary/30 animate-in zoom-in-50 duration-300">
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
