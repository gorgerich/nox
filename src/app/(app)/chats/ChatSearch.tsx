"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";

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
    const parts = text.split(new RegExp(`(${q})`, "gi"));
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
      <div className="relative group transition-smooth">
        <input
          className="input-nox h-14 !pr-5 !pl-14 bg-surface-muted border-border-subtle/50 focus:bg-surface focus:border-primary/40 transition-smooth"
          placeholder="Поиск людей, чатов и сообщений"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        <div className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2">
          <svg className="h-5 w-5 text-muted transition-smooth group-focus-within:text-primary group-focus-within:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {isOpen && (query.trim() || loading) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-4 max-h-[70vh] overflow-y-auto rounded-[2rem] border border-border-subtle/50 bg-surface p-3 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-xl">
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH ? (
            <div className="p-10 text-center">
              <p className="text-sm font-black uppercase tracking-widest text-muted/40">Минимум 3 символа</p>
            </div>
          ) : loading ? (
            <div className="p-10 text-center">
              <p className="text-[10px] font-black uppercase tracking-widest text-primary animate-pulse">Ищем в Nox...</p>
            </div>
          ) : results && Object.values(results).some((arr) => arr.length > 0) ? (
            <div className="space-y-6 p-1">
              {results.people.length > 0 && (
                <section>
                  <h3 className="mb-3 px-3 text-[10px] font-black uppercase tracking-widest text-muted/50">Пользователи</h3>
                  <div className="space-y-1">
                    {results.people.map((person) => (
                      <Link
                        key={person.id}
                        href={person.isSelf ? "/profile" : `/users/${person.id}`}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-4 rounded-2xl p-3 transition-smooth hover:bg-surface-muted active:scale-[0.98]"
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted overflow-hidden shadow-sm border border-border-subtle/50 transition-smooth group-hover:scale-105 relative">
                          {person.profile?.avatarUrl ? (
                            <Image src={person.profile.avatarUrl.startsWith('http') ? person.profile.avatarUrl : `/api/avatars/${person.profile.avatarUrl}`} alt={person.displayName} fill className="object-cover" />
                          ) : (
                            <span className="text-lg font-black text-primary uppercase">{person.displayName[0]}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-bold text-foreground tracking-tight">{highlightText(person.displayName, query)}</p>
                            {person.isSelf && <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-[9px] font-black uppercase text-primary tracking-widest">Вы</span>}
                          </div>
                          <p className="truncate text-[10px] font-black uppercase tracking-widest text-muted/60">@{highlightText(person.username, query)}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {results.chats.length > 0 && (
                <section>
                  <h3 className="mb-3 px-3 text-[10px] font-black uppercase tracking-widest text-muted/50">Диалоги</h3>
                  <div className="space-y-1">
                    {results.chats.map((chat) => (
                      <Link
                        key={chat.id}
                        href={`/chats/${chat.id}`}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-4 rounded-2xl p-3 transition-smooth hover:bg-surface-muted active:scale-[0.98]"
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-muted overflow-hidden shadow-sm border border-border-subtle/50 transition-smooth group-hover:scale-105 relative">
                          {chat.isSelfChat ? (
                            <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                              </svg>
                            </div>
                          ) : chat.avatarUrl ? (
                            <Image src={chat.avatarUrl.startsWith('http') ? chat.avatarUrl : `/api/avatars/${chat.avatarUrl}`} alt={chat.title || "Чат"} fill className="object-cover" />
                          ) : (
                            <span className="text-lg font-black text-primary uppercase">{(chat.title || "C")[0]}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className={`truncate text-sm font-bold tracking-tight ${chat.isSelfChat ? "text-primary" : "text-foreground"}`}>
                            {chat.isSelfChat ? "Избранное" : highlightText(chat.title || "Личный чат", query)}
                          </p>
                          <p className="truncate text-[10px] font-black uppercase tracking-widest text-muted/60">Открыть</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}

              {results.messages.length > 0 && (
                <section>
                  <h3 className="mb-3 px-3 text-[10px] font-black uppercase tracking-widest text-muted/50">Сообщения</h3>
                  <div className="space-y-1">
                    {results.messages.map((msg) => (
                      <Link
                        key={msg.id}
                        href={`/chats/${msg.chatId}?highlightMessageId=${msg.id}`}
                        onClick={() => setIsOpen(false)}
                        className="block rounded-2xl p-4 transition-smooth hover:bg-surface-muted active:scale-[0.98] border border-transparent hover:border-border-subtle/50"
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <p className="truncate text-xs font-black uppercase tracking-widest text-primary">{msg.senderName}</p>
                          <p className="text-[9px] font-black uppercase tracking-tighter text-muted/50">{new Date(msg.createdAt).toLocaleDateString("ru-RU")}</p>
                        </div>
                        <p className="truncate text-sm font-medium text-muted leading-snug">{highlightText(msg.body, query)}</p>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (
            <div className="p-10 text-center animate-in fade-in zoom-in-95 duration-300">
              <p className="text-sm font-black uppercase tracking-widest text-muted/40">Ничего не найдено</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
