"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

type SearchResult = {
  people: { id: string; username: string; displayName: string }[];
  chats: { id: string; title: string; type: string }[];
  messages: { id: string; body: string; chatId: string; createdAt: string; senderName: string }[];
};

const MIN_QUERY_LENGTH = 3;

export function ChatSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(async () => {
      const trimmedQuery = query.trim();

      if (!trimmedQuery) {
        setResults(null);
        return;
      }

      if (trimmedQuery.length < MIN_QUERY_LENGTH) {
        setLoading(false);
        setResults(null);
        return;
      }

      setLoading(true);

      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmedQuery)}`);
        const data = (await res.json()) as SearchResult;
        setResults(data);
      } catch {
        setResults({ people: [], chats: [], messages: [] });
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative group transition-smooth">
        <input
          className="input-nox h-14 pl-12 bg-surface-hover/30 border-border-subtle/30 focus:bg-surface-hover/50 focus:border-primary/40 transition-smooth"
          placeholder="Поиск людей, чатов и сообщений"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted transition-smooth group-focus-within:text-primary group-focus-within:scale-110" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {isOpen && (query.trim() || loading) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-4 max-h-[70vh] overflow-y-auto rounded-[2rem] border border-border-subtle/50 bg-neutral-900 p-3 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-300 backdrop-blur-xl">
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH ? (
            <div className="p-10 text-center">
              <p className="text-sm font-black uppercase tracking-widest text-muted/40">Минимум 3 символа</p>
            </div>
          ) : loading ? (
            <div className="p-10 text-center">
              <p className="text-xs font-black uppercase tracking-widest text-primary animate-pulse">Ищем в Nox...</p>
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
                        href={`/chats/new?u=${person.username}`}
                        onClick={() => setIsOpen(false)}
                        className="flex items-center gap-4 rounded-2xl p-3 transition-smooth hover:bg-white/5 active:scale-[0.98]"
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-lg font-black text-primary">
                          {person.displayName[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white tracking-tight">{person.displayName}</p>
                          <p className="truncate text-[10px] font-black uppercase tracking-widest text-muted/60">@{person.username}</p>
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
                        className="flex items-center gap-4 rounded-2xl p-3 transition-smooth hover:bg-white/5 active:scale-[0.98]"
                      >
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-hover text-lg font-black text-muted">
                          {(chat.title || "C")[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold text-white tracking-tight">{chat.title || "Личный чат"}</p>
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
                        href={`/chats/${msg.chatId}`}
                        onClick={() => setIsOpen(false)}
                        className="block rounded-2xl p-4 transition-smooth hover:bg-white/5 active:scale-[0.98] border border-transparent hover:border-white/5"
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <p className="truncate text-xs font-black uppercase tracking-widest text-primary">{msg.senderName}</p>
                          <p className="text-[9px] font-black uppercase tracking-tighter text-muted/50">{new Date(msg.createdAt).toLocaleDateString("ru-RU")}</p>
                        </div>
                        <p className="truncate text-sm font-medium text-muted leading-snug">{msg.body}</p>
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
