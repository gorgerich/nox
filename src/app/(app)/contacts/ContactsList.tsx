"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
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
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [error, setError] = useState("");

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
      <header className="app-section-header items-center">
        <div>
          <h1 className="app-section-title">Контакты</h1>
        </div>
      </header>

      {error ? (
        <div className="mb-3 rounded-2xl border border-danger/15 bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
          {error}
        </div>
      ) : null}

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-muted">
            <UsersRound className="h-9 w-9" strokeWidth={1.7} />
          </div>
          <h2 className="mb-2 text-xl font-semibold tracking-tight text-foreground/80">Контактов пока нет</h2>
          <p className="max-w-xs text-sm font-medium text-muted-foreground leading-relaxed">
            Начните новый чат, чтобы контакт появился здесь.
          </p>
          <Link href="/chats/new" className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-smooth active:scale-95">
            <Search className="h-4 w-4" strokeWidth={2.2} />
            Найти людей
          </Link>
        </div>
      ) : (
        <div className="-mx-5 divide-y divide-border-subtle border-y border-border-subtle bg-surface md:mx-0 md:rounded-2xl md:border">
          {contacts.map((contact) => {
            const isMe = contact.isMe;
            const displayName = isMe ? "Личное" : (contact.profile?.displayName || contact.username);
            const fullAvatarUrl = normalizeAvatarUrl(contact.profile?.avatarUrl);
            return (
              <button
                key={contact.id}
                type="button"
                disabled={actionPending === contact.id}
                onClick={() => { if (isMe) { router.push("/profile"); } else { void openContact(contact.id); } }}
                className="group flex min-h-[72px] w-full items-center gap-3 px-5 py-2.5 text-left transition-smooth hover:bg-foreground/5 active:bg-foreground/10 fast-tap disabled:opacity-60"
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary/10 text-primary">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg font-semibold">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-semibold leading-tight text-foreground">
                    {displayName}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-normal text-muted">
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
