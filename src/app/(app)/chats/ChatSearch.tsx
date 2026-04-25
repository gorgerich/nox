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
    <div className="relative mb-6" ref={containerRef}>
      <div className="relative">
        <input
          className="input-nox border-none bg-surface/50 pl-12 ring-1 ring-border-subtle focus:ring-primary/40"
          placeholder="Поиск людей, чатов и сообщений"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
        />
        <svg className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>

      {isOpen && (query.trim() || loading) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-3xl border border-border-subtle bg-surface p-2 shadow-2xl animate-in fade-in slide-in-from-top-2">
          {query.trim().length > 0 && query.trim().length < MIN_QUERY_LENGTH ? (
            <div className="p-8 text-center text-sm text-muted">Введите минимум 3 символа.</div>
          ) : loading ? (
            <div className="p-8 text-center text-xs font-bold uppercase tracking-widest text-muted animate-pulse">Поиск...</div>
          ) : results && Object.values(results).some((arr) => arr.length > 0) ? (
            <div className="space-y-4 p-2">
              {results.people.length > 0 && (
                <section>
                  <h3 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-muted">Люди</h3>
                  {results.people.map((person) => (
                    <Link
                      key={person.id}
                      href={`/chats/new?u=${person.username}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-surface-hover"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                        {person.displayName[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{person.displayName}</p>
                        <p className="truncate text-xs text-muted">@{person.username}</p>
                      </div>
                    </Link>
                  ))}
                </section>
              )}

              {results.chats.length > 0 && (
                <section>
                  <h3 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-muted">Чаты</h3>
                  {results.chats.map((chat) => (
                    <Link
                      key={chat.id}
                      href={`/chats/${chat.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-surface-hover"
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-hover font-bold text-muted">
                        {chat.title[0]}
                      </div>
                      <p className="truncate text-sm font-bold">{chat.title}</p>
                    </Link>
                  ))}
                </section>
              )}

              {results.messages.length > 0 && (
                <section>
                  <h3 className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-muted">Сообщения</h3>
                  {results.messages.map((msg) => (
                    <Link
                      key={msg.id}
                      href={`/chats/${msg.chatId}`}
                      onClick={() => setIsOpen(false)}
                      className="block rounded-2xl p-3 transition-colors hover:bg-surface-hover"
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <p className="truncate text-xs font-bold text-primary">{msg.senderName}</p>
                        <p className="text-[10px] text-muted">{new Date(msg.createdAt).toLocaleDateString()}</p>
                      </div>
                      <p className="truncate text-sm text-muted">{msg.body}</p>
                    </Link>
                  ))}
                </section>
              )}
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-muted">Ничего не найдено</div>
          )}
        </div>
      )}
    </div>
  );
}
