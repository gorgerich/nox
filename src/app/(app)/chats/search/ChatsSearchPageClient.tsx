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
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string").slice(0, 12)
        : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const focusInput = () => {
      inputRef.current?.focus({ preventScroll: true });
    };
    focusInput();
    const frameId = requestAnimationFrame(focusInput);
    const timeoutIds = [60, 180, 360].map((delay) => window.setTimeout(focusInput, delay));

    return () => {
      cancelAnimationFrame(frameId);
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        inputRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
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
          <form className="nox-search-pill min-w-0 flex-1" onSubmit={submitSearch}>
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" strokeWidth={2.1} />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск"
              className="h-11 w-full rounded-full bg-transparent px-11 text-[17px] font-medium outline-none transition-smooth placeholder:text-muted/60 focus:ring-2 focus:ring-primary/15"
              type="search"
              autoFocus
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

        <section
          className="mt-5 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-nox-horizontal-scroll="true"
        >
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
            <h2 className="nox-section-label px-1">Результаты</h2>
            <div className="nox-list mx-0 md:mx-4">
              {results.length > 0 ? results.map((chat) => (
                <ChatResultRow key={chat.id} chat={chat} />
              )) : (
                <div className="nox-empty-state min-h-64">
                  <div className="nox-empty-icon">
                    <Search className="h-8 w-8" strokeWidth={1.8} />
                  </div>
                  <h2 className="nox-empty-title">Ничего не найдено</h2>
                  <p className="nox-empty-copy">Попробуйте имя, username или текст сообщения.</p>
                </div>
              )}
            </div>
          </section>
        ) : (
          <>
            <section className="mt-6">
              <div className="flex items-center justify-between px-5">
                <h2 className="nox-section-label !m-0">Недавние запросы</h2>
                {history.length > 0 ? (
                  <button type="button" onClick={clearHistory} className="fast-tap text-sm font-medium text-muted transition-smooth hover:text-primary">
                    Очистить
                  </button>
                ) : null}
              </div>
              <div className="nox-list mx-0 mt-2 md:mx-4">
                {history.length > 0 ? history.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setQuery(item)}
                    className="nox-list-row fast-tap"
                  >
                    <Search className="h-5 w-5 shrink-0 text-muted" strokeWidth={2.1} />
                    <span className="nox-row-title min-w-0 flex-1">{item}</span>
                  </button>
                )) : (
                  <p className="px-5 py-4 text-sm font-medium text-muted">История поиска появится здесь.</p>
                )}
              </div>
            </section>

            {incomingRequests.length > 0 ? (
              <section className="mt-6">
                <h2 className="nox-section-label px-1">Запросы</h2>
                <div className="nox-list mx-0 mt-2 md:mx-4">
                  {incomingRequests.slice(0, 6).map((request) => {
                    const displayName = request.fromUser.profile?.displayName ?? request.fromUser.username;
                    const avatarUrl = request.fromUser.profile?.avatarUrl;
                    return (
                      <Link key={request.id} href="/chats/new" className="nox-list-row fast-tap">
                        <div className="nox-avatar">
                          {avatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={avatarUrl.startsWith("http") ? avatarUrl : `/api/avatars/${avatarUrl}`} alt="" className="h-full w-full object-cover" />
                          ) : (
                            avatarInitial(displayName)
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="nox-row-title">{displayName}</p>
                          <p className="nox-row-subtitle">@{request.fromUser.username}</p>
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
    <Link href={`/chats/${chat.id}`} className="nox-list-row fast-tap">
      <div className="nox-avatar">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl.startsWith("http") ? avatarUrl : `/api/avatars/${avatarUrl}`} alt="" className="h-full w-full object-cover" />
        ) : (
          avatarInitial(title)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="nox-row-title">{title}</p>
        <p className="nox-row-subtitle">{chatSubtitle(chat)}</p>
      </div>
      {chat.unreadCount > 0 ? (
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">
          {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
        </span>
      ) : null}
    </Link>
  );
}
