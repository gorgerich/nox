"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

import type { ChatListItem, IncomingRequestCardItem } from "@/lib/chat-list";

type Props = {
  chats: ChatListItem[];
  incomingRequests: IncomingRequestCardItem[];
};

const HISTORY_KEY = "nox:chat-search-history";

function chatTitle(chat: ChatListItem) {
  if (chat.isSelfChat) return "Личное";
  if (chat.type === "GROUP") return chat.title || "Группа";
  return chat.otherMember?.displayName || chat.otherMember?.username || chat.title || "Чат";
}

function chatSubtitle(chat: ChatListItem) {
  if (chat.lastMessage?.body) return chat.lastMessage.body;
  if (chat.otherMember?.username) return `@${chat.otherMember.username}`;
  return chat.type === "GROUP" ? "Группа" : "Личный чат";
}

function chatAvatar(chat: ChatListItem) {
  if (chat.type === "GROUP") return chat.avatarUrl;
  return chat.otherMember?.avatarUrl ?? chat.avatarUrl;
}

function avatarInitial(title: string) {
  return title.trim().slice(0, 1).toLocaleUpperCase("ru-RU") || "?";
}

export function ChatsSearchPageClient({ chats, incomingRequests }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      inputRef.current?.focus();
      try {
        const raw = localStorage.getItem(HISTORY_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) {
            setHistory(parsed.filter((item): item is string => typeof item === "string").slice(0, 12));
          }
        }
      } catch {
        // ignore unavailable localStorage
      }
    }, 120);
    return () => clearTimeout(timeoutId);
  }, []);

  const recentChats = useMemo(() => chats.filter((chat) => !chat.deletedAt).slice(0, 12), [chats]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return chats.filter((chat) => {
      const title = chatTitle(chat).toLowerCase();
      const username = chat.otherMember?.username.toLowerCase() ?? "";
      const last = chat.lastMessage?.body?.toLowerCase() ?? "";
      return title.includes(needle) || username.includes(needle) || last.includes(needle);
    }).slice(0, 20);
  }, [chats, query]);

  function rememberSearch(value: string) {
    const clean = value.trim();
    if (!clean) return;
    setHistory((current) => {
      const next = [clean, ...current.filter((item) => item.toLowerCase() !== clean.toLowerCase())].slice(0, 12);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore unavailable localStorage
      }
      return next;
    });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    rememberSearch(query);
  }

  function clearHistory() {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore unavailable localStorage
    }
  }

  return (
    <div className="min-h-dvh bg-background pb-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
      <div className="mx-auto flex w-full max-w-2xl flex-col">
        <div className="flex items-center gap-2 px-4">
          <button
            type="button"
            aria-label="Назад"
            onClick={() => router.back()}
            className="fast-tap fluid-hit flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10"
          >
            <ArrowLeft className="h-6 w-6" strokeWidth={2.4} />
          </button>
          <form className="relative min-w-0 flex-1" onSubmit={submitSearch}>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" strokeWidth={2.1} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск"
              className="premium-glass h-11 w-full rounded-full px-11 text-[17px] outline-none transition-smooth placeholder:text-muted/60 focus:border-primary/30 focus:ring-2 focus:ring-primary/15"
              type="search"
              enterKeyHint="search"
            />
            {query ? (
              <button
                type="button"
                aria-label="Очистить"
                onClick={() => setQuery("")}
                className="fast-tap fluid-hit absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-foreground/8 text-muted"
              >
                <X className="h-4 w-4" strokeWidth={2.4} />
              </button>
            ) : null}
          </form>
        </div>

        <section className="mt-5 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex gap-4">
            {recentChats.map((chat) => {
              const title = chatTitle(chat);
              const avatarUrl = chatAvatar(chat);
              return (
                <Link key={chat.id} href={`/chats/${chat.id}`} className="fast-tap fluid-hit flex w-20 shrink-0 flex-col items-center gap-2 text-center">
                  <div className="premium-glass relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full text-xl font-semibold text-primary">
                    {avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatarUrl.startsWith("http") ? avatarUrl : `/api/avatars/${avatarUrl}`} alt="" className="h-full w-full object-cover" />
                    ) : (
                      avatarInitial(title)
                    )}
                  </div>
                  <span className="line-clamp-1 w-full text-[13px] font-medium leading-4 text-foreground">{title}</span>
                </Link>
              );
            })}
          </div>
        </section>

        {query.trim() ? (
          <section className="mt-6">
            <h2 className="px-5 text-[13px] font-medium uppercase tracking-normal text-muted">Результаты</h2>
            <div className="premium-glass mx-4 mt-2 overflow-hidden rounded-[1.35rem]">
              {results.length > 0 ? results.map((chat) => (
                <ChatResultRow key={chat.id} chat={chat} />
              )) : (
                <p className="px-5 py-4 text-sm text-muted">Ничего не найдено</p>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="mt-6">
              <div className="flex items-center justify-between px-5">
                <h2 className="text-[13px] font-medium uppercase tracking-normal text-muted">Недавние запросы</h2>
                {history.length > 0 ? (
                  <button type="button" onClick={clearHistory} className="fast-tap text-sm font-medium text-muted transition-smooth hover:text-primary">
                    Очистить
                  </button>
                ) : null}
              </div>
              <div className="premium-glass mx-4 mt-2 overflow-hidden rounded-[1.35rem]">
                {history.length > 0 ? history.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setQuery(item)}
                    className="fast-tap fluid-hit flex w-full items-center gap-3 border-b border-border-subtle/55 px-5 py-3 text-left last:border-b-0 hover:bg-foreground/5"
                  >
                    <Search className="h-5 w-5 shrink-0 text-muted" strokeWidth={2.1} />
                    <span className="min-w-0 flex-1 truncate text-[16px] font-medium">{item}</span>
                  </button>
                )) : (
                  <p className="px-5 py-4 text-sm text-muted">История поиска появится здесь.</p>
                )}
              </div>
            </section>

            {incomingRequests.length > 0 ? (
              <section className="mt-6">
                <h2 className="px-5 text-[13px] font-medium uppercase tracking-normal text-muted">Запросы</h2>
                <div className="premium-glass mx-4 mt-2 overflow-hidden rounded-[1.35rem]">
                  {incomingRequests.slice(0, 6).map((request) => {
                    const displayName = request.fromUser.profile?.displayName ?? request.fromUser.username;
                    const avatarUrl = request.fromUser.profile?.avatarUrl;
                    return (
                      <Link key={request.id} href="/chats/new" className="fast-tap fluid-hit flex items-center gap-3 border-b border-border-subtle/55 px-5 py-3 last:border-b-0 hover:bg-foreground/5">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary">
                          {avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarUrl.startsWith("http") ? avatarUrl : `/api/avatars/${avatarUrl}`} alt="" className="h-full w-full object-cover" />
                          ) : (
                            avatarInitial(displayName)
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[16px] font-semibold">{displayName}</p>
                          <p className="truncate text-[13px] text-muted">@{request.fromUser.username}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function ChatResultRow({ chat }: { chat: ChatListItem }) {
  const title = chatTitle(chat);
  const avatarUrl = chatAvatar(chat);
  return (
    <Link href={`/chats/${chat.id}`} className="fast-tap fluid-hit flex items-center gap-3 border-b border-border-subtle/55 px-5 py-3 last:border-b-0 hover:bg-foreground/5">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl.startsWith("http") ? avatarUrl : `/api/avatars/${avatarUrl}`} alt="" className="h-full w-full object-cover" />
        ) : (
          avatarInitial(title)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[16px] font-semibold">{title}</p>
        <p className="truncate text-[13px] text-muted">{chatSubtitle(chat)}</p>
      </div>
      {chat.unreadCount > 0 ? (
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
          {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
