"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import type { ChatListItem } from "@/lib/chat-list";
import { SwipeableChatRow } from "../SwipeableChatRow";

type ArchivePageClientProps = {
  initialChats: ChatListItem[];
};

export function ArchivePageClient({ initialChats }: ArchivePageClientProps) {
  const [chats, setChats] = useState(initialChats);
  const [openRowId, setOpenRowId] = useState<string | null>(null);

  const applyChatMutation = useCallback(async (
    chat: ChatListItem,
    body: { archived?: boolean; deleted?: boolean },
    optimisticUpdater: (current: ChatListItem[]) => ChatListItem[],
    rollback: ChatListItem[],
  ) => {
    setOpenRowId(null);
    setChats(optimisticUpdater);

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
      alert(error instanceof Error ? error.message : "Не удалось обновить настройки чата");
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
      <div className="mt-20 text-center animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-2xl font-black tracking-tight text-foreground/90">В архиве пусто</h2>
        <p className="mx-auto mt-3 max-w-[240px] text-base font-medium leading-relaxed text-muted/60">
          Сюда попадают скрытые чаты.
        </p>
        <Link
          className="btn-nox mt-10 inline-flex h-14 items-center rounded-3xl bg-surface-elevated border border-border-subtle px-10 text-sm font-black text-foreground shadow-sm transition-smooth active:scale-[0.96]"
          href="/chats"
          prefetch
        >
          НАЗАД К ЧАТАМ
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-1 animate-in fade-in duration-180">
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
