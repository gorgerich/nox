"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { normalizeAvatarUrl } from "@/lib/media-url";
import { escapeRegExp } from "@/lib/text";

type SearchResult = {
  people: { id: string; username: string; displayName: string; isSelf?: boolean; profile?: { avatarUrl: string | null } }[];
  chats: { id: string; title: string | null; type: string; avatarUrl?: string | null; isSelfChat?: boolean }[];
  messages: { id: string; body: string; chatId: string; createdAt: string; senderName: string }[];
};

const MIN_QUERY_LENGTH = 3;

export function ChatSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const timer = setTimeout(async () => {
      if (query.trim().length < MIN_QUERY_LENGTH) {
        setResults(null);
        abortRef.current?.abort();
        return;
      }

      setLoading(true);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const data = await res.json();
        setResults(data);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          console.error("Search failed", e);
        }
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [query]);

  const highlightText = (text: string, q: string) => {
    if (!q.trim()) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, "gi"));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="bg-primary/30 text-inherit rounded-sm px-0.5 font-bold">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative group">
        <input
          className="h-9 w-full rounded-[14px] border border-transparent bg-surface-muted pl-10 pr-4 text-[14px] font-medium text-foreground outline-none transition-colors duration-150 placeholder:text-muted/58 focus:border-border-subtle/60 focus:bg-surface"
          placeholder="Поиск: люди, чаты, сообщения"
          aria-label="Поиск: люди, чаты, сообщения"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        <div className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">
          <svg className="h-4 w-4 text-muted/60 transition-colors group-focus-within:text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {isOpen && (query.trim() || loading) && (
        <div className="glass-panel absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl p-2 animate-in fade-in slide-in-from-top-4 duration-200">
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH ? (
            <div className="p-10 text-center">
              <p className="text-[14px] text-muted/50">Минимум 3 символа</p>
            </div>
          ) : loading ? (
            <div className="p-10 text-center">
              <p className="text-[14px] text-primary animate-pulse">Поиск…</p>
            </div>
          ) : results && Object.values(results).some((arr) => arr.length > 0) ? (
            <div className="space-y-6 p-1">
              {results.people.length > 0 && (
                <section>
                  <h3 className="mb-2 px-3 text-[13px] font-semibold text-muted/60">Пользователи</h3>
                  <div className="space-y-1">
                    {results.people.map((person) => (
                      <Link
                        key={person.id}
                        href={person.isSelf ? "/profile" : `/users/${person.id}`}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-surface-muted"
                      >
                        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted">
                          {normalizeAvatarUrl(person.profile?.avatarUrl) ? (
                            <Image src={normalizeAvatarUrl(person.profile?.avatarUrl) || ""} alt={person.displayName} fill className="object-cover" />
                          ) : (
                            <span className="text-lg font-black text-primary uppercase">{person.displayName[0]}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-bold text-foreground tracking-tight">{highlightText(person.displayName, query)}</p>
                            {person.isSelf && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">Вы</span>}
                          </div>
                          <p className="truncate text-[13px] text-muted/60">@{highlightText(person.username, query)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {results.chats.length > 0 && (
                <section>
                  <h3 className="mb-2 px-3 text-[13px] font-semibold text-muted/60">Диалоги</h3>
                  <div className="space-y-1">
                    {results.chats.map((chat) => (
                      <Link
                        key={chat.id}
                        href={`/chats/${chat.id}`}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-surface-muted"
                      >
                        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted">
                          {chat.isSelfChat ? (
                            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                              </svg>
                            </div>
                          ) : normalizeAvatarUrl(chat.avatarUrl) ? (
                            <Image src={normalizeAvatarUrl(chat.avatarUrl) || ""} alt={chat.title || "Чат"} fill className="object-cover" />
                          ) : (
                            <span className="text-lg font-black text-primary uppercase">{(chat.title || "C")[0]}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-bold tracking-tight ${chat.isSelfChat ? "text-primary" : "text-foreground"}`}>
                            {chat.isSelfChat ? "Личное" : highlightText(chat.title || "Личный чат", query)}
                          </p>
                          <p className="truncate text-[13px] text-muted/60">Открыть</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {results.messages.length > 0 && (
                <section>
                  <h3 className="mb-2 px-3 text-[13px] font-semibold text-muted/60">Сообщения</h3>
                  <div className="space-y-1">
                    {results.messages.map((msg) => (
                      <Link
                        key={msg.id}
                        href={`/chats/${msg.chatId}?highlightMessageId=${msg.id}`}
                        onClick={() => setIsOpen(false)}
                        className="block rounded-xl p-3 transition-colors hover:bg-surface-muted"
                      >
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="truncate text-[14px] font-semibold text-foreground">{msg.senderName}</p>
                          <p className="shrink-0 text-[12px] tabular-nums text-muted/50">{new Date(msg.createdAt).toLocaleDateString("ru-RU")}</p>
                        </div>
                        <p className="truncate text-[14px] text-muted leading-snug">{highlightText(msg.body, query)}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="p-10 text-center animate-in fade-in zoom-in-95 duration-300">
              <p className="text-[14px] text-muted/50">Ничего не найдено</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
