"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UsersRound } from "lucide-react";
import { normalizeAvatarUrl } from "@/lib/media-url";

export type Contact = {
  id: string;
  username: string;
  isMe?: boolean;
  profile: {
    displayName: string;
    avatarUrl: string | null;
  } | null;
};

export function ContactsList({ contacts }: { contacts: Contact[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [error, setError] = useState("");
  const filteredContacts = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    if (!needle) return contacts;
    return contacts.filter((contact) => {
      const displayName = contact.isMe ? "Личное" : (contact.profile?.displayName || contact.username);
      return `${displayName} ${contact.username}`.toLocaleLowerCase("ru-RU").includes(needle);
    });
  }, [contacts, query]);

  // Tapping a contact row opens the chat directly (Telegram/iOS pattern) — no
  // separate "write" button needed.
  const openContact = async (userId: string) => {
    if (actionPending) return;
    setError("");
    setActionPending(userId);

    try {
      const response = await fetch("/api/chats/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        const data = await response.json();
        router.push(`/chats/${data.chat.id}`);
      } else {
        setError("Не удалось открыть чат.");
        setActionPending(null);
      }
    } catch {
      setError("Проверьте соединение и повторите.");
      setActionPending(null);
    }
  };

  return (
    <div className="app-section animate-in fade-in duration-200">
      <header className="nox-page-header">
        <div>
          <h1 className="nox-page-title">Контакты</h1>
          <p className="nox-page-subtitle">
            {contacts.length > 0 ? `${contacts.length} человек` : "Люди появятся после первого диалога"}
          </p>
        </div>
        <Link
          href="/chats/new"
          className="fast-tap fluid-hit flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary hover:bg-primary/10"
          aria-label="Найти людей"
        >
          <Search className="h-5 w-5" strokeWidth={2.25} />
        </Link>
      </header>

      <label className="nox-search-pill mb-4 px-4">
        <Search className="h-5 w-5 shrink-0 text-muted/70" strokeWidth={2.1} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-w-0 flex-1 bg-transparent py-2 text-[16px] font-medium outline-none placeholder:text-muted/55"
          placeholder="Поиск людей"
          type="search"
        />
      </label>

      {error ? (
        <div className="mb-3 rounded-2xl border border-danger/15 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          {error}
        </div>
      ) : null}

      {contacts.length === 0 ? (
        <div className="nox-empty-state animate-in fade-in zoom-in-95 duration-200">
          <div className="nox-empty-icon">
            <UsersRound className="h-9 w-9" strokeWidth={1.7} />
          </div>
          <h2 className="nox-empty-title">Контактов пока нет</h2>
          <p className="nox-empty-copy">
            Начните новый чат, чтобы контакт появился здесь.
          </p>
          <Link href="/chats/new" className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-smooth active:scale-95">
            <Search className="h-4 w-4" strokeWidth={2.2} />
            Найти людей
          </Link>
        </div>
      ) : (
        <div className="nox-list -mx-5 md:mx-0">
          {filteredContacts.length === 0 ? (
            <div className="nox-empty-state min-h-64">
              <div className="nox-empty-icon">
                <Search className="h-8 w-8" strokeWidth={1.8} />
              </div>
              <h2 className="nox-empty-title">Ничего не найдено</h2>
              <p className="nox-empty-copy">Попробуйте имя или username без лишних символов.</p>
            </div>
          ) : filteredContacts.map((contact) => {
            const isMe = contact.isMe;
            const displayName = isMe ? "Личное" : (contact.profile?.displayName || contact.username);
            const fullAvatarUrl = normalizeAvatarUrl(contact.profile?.avatarUrl);
            return (
              <button
                key={contact.id}
                type="button"
                disabled={actionPending === contact.id}
                onClick={() => { if (isMe) { router.push("/profile"); } else { void openContact(contact.id); } }}
                className="nox-list-row fast-tap disabled:opacity-60"
              >
                <div className="nox-avatar">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="nox-row-title">
                    {displayName}
                  </p>
                  <p className="nox-row-subtitle">
                    {isMe ? `@${contact.username} (вы)` : `@${contact.username}`}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
