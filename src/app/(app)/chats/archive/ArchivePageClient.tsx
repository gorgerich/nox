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
      <div className="nox-empty-state">
        <ArchiveIntroSheet />
        <h2 className="nox-empty-title">В архиве пусто</h2>
        <p className="nox-empty-copy">
          Сюда попадают скрытые чаты.
        </p>
        <Link
          className="fast-tap mt-7 inline-flex h-11 items-center rounded-[0.875rem] bg-surface-elevated px-5 text-sm font-semibold text-foreground transition-colors hover:bg-surface-hover"
          href="/chats"
          prefetch
        >
          Назад к чатам
        </Link>
      </div>
    );
  }

  return (
    <div className="-mx-5 md:mx-0">
      <ArchiveIntroSheet />
      {error ? (
        <div role="alert" className="mx-4 mb-3 rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger">
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
