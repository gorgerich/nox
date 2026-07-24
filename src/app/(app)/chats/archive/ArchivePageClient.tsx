"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { ChatListItem } from "@/lib/chat-list";
import { SwipeableChatRow } from "../SwipeableChatRow";
import { ArchiveIntroSheet } from "./ArchiveIntroSheet";

type ArchivePageClientProps = {
  initialChats: ChatListItem[];
};

export function ArchivePageClient({ initialChats }: ArchivePageClientProps) {
  const [chats, setChats] = useState(initialChats);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const applyChatMutation = useCallback(async (
    chat: ChatListItem,
    body: { archived?: boolean; deleted?: boolean },
    optimisticUpdater: (current: ChatListItem[]) => ChatListItem[],
    rollback: ChatListItem[],
  ) => {
    setOpenRowId(null);
    setChats(optimisticUpdater);
    setError("");

    try {
      const response = await fetch(`/api/chats/${chat.id}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось обновить настройки чата");
      }
    } catch (error) {
      setChats(rollback);
      setError(error instanceof Error ? error.message : "Не удалось обновить настройки чата");
    }
  }, []);

  const handleNavigate = useCallback((chatId: string) => {
    void chatId;
  }, []);

  const handleDelete = useCallback((chat: ChatListItem) => {
    const previous = chats;
    void applyChatMutation(
      chat,
      { deleted: true },
      (current) => current.filter((item) => item.id !== chat.id),
      previous,
    );
  }, [applyChatMutation, chats]);

  const handleUnarchive = useCallback((chat: ChatListItem) => {
    const previous = chats;
    void applyChatMutation(
      chat,
      { archived: false },
      (current) => current.filter((item) => item.id !== chat.id),
      previous,
    );
  }, [applyChatMutation, chats]);

  if (chats.length === 0) {
    return (
      <div className="nox-empty-state animate-in fade-in zoom-in-95 duration-200">
        <ArchiveIntroSheet />
        <h2 className="nox-empty-title">В архиве пусто</h2>
        <p className="nox-empty-copy">
          Сюда попадают скрытые чаты.
        </p>
        <Link
          className="mt-7 inline-flex h-11 items-center rounded-full bg-surface-elevated px-5 text-sm font-semibold text-foreground transition-smooth active:scale-[0.96]"
          href="/chats"
          prefetch
        >
          Назад к чатам
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-1 animate-in fade-in duration-200">
      <ArchiveIntroSheet />
      {error ? (
        <div className="mx-4 mb-3 rounded-2xl border border-danger/15 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger">
          {error}
        </div>
      ) : null}
      {chats.map((chat) => (
        <SwipeableChatRow
          key={chat.id}
          chat={chat}
          isOpen={openRowId === chat.id}
          onOpen={setOpenRowId}
          onNavigate={handleNavigate}
          onDelete={handleDelete}
          onArchive={handleUnarchive}
          onMute={() => {}}
          isArchiveMode
        />
      ))}
    </div>
  );
}
