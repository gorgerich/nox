"use client";

import Link from "next/link";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useSocket } from "@/hooks/useSocket";
import type { ChatListItem, IncomingRequestCardItem } from "@/lib/chat-list";

import { ChatSearch } from "./ChatSearch";
import { IncomingRequestCards } from "./IncomingRequestCards";
import { SwipeableChatRow } from "./SwipeableChatRow";

const DEBUG_REALTIME = process.env.NEXT_PUBLIC_DEBUG_REALTIME === "true";

type ChatsPageClientProps = {
  initialChats: ChatListItem[];
  initialIncomingRequests: IncomingRequestCardItem[];
  initialArchivedCount?: number;
};

const MUTE_OPTIONS = [
  { label: "15 минут", minutes: 15 },
  { label: "1 час", minutes: 60 },
  { label: "1 день", minutes: 60 * 24 },
  { label: "3 дня", minutes: 60 * 24 * 3 },
  { label: "7 дней", minutes: 60 * 24 * 7 },
  { label: "Навсегда", minutes: -1 },
] as const;

function debugRealtime(label: string, data: Record<string, unknown> = {}) {
  if (!DEBUG_REALTIME) {
    return;
  }

  console.log(`[realtime-client] ${label}`, data);
}

export function ChatsPageClient({
  initialChats,
  initialIncomingRequests,
  initialArchivedCount = 0,
}: ChatsPageClientProps) {
  const router = useRouter();
  const { socket } = useSocket();
  const [chats, setChats] = useState(initialChats);
  const [incomingRequests, setIncomingRequests] = useState(initialIncomingRequests);
  const [archivedCount, setArchivedCount] = useState(initialArchivedCount);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [muteSheetChat, setMuteSheetChat] = useState<ChatListItem | null>(null);
  const syncAbortRef = useRef<AbortController | null>(null);

  const syncChats = useCallback(async () => {
    syncAbortRef.current?.abort();
    const controller = new AbortController();
    syncAbortRef.current = controller;

    try {
      const response = await fetch("/api/chats", {
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("Не удалось обновить список чатов");
      }
      const data = await response.json() as {
        chats: ChatListItem[];
        incomingRequests: IncomingRequestCardItem[];
        archivedCount?: number;
      };
      setChats(data.chats);
      setIncomingRequests(data.incomingRequests);
      if (data.archivedCount !== undefined) {
        setArchivedCount(data.archivedCount);
      }
      debugRealtime("chat list synced", { chats: data.chats.length, requests: data.incomingRequests.length });
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        return;
      }
      console.error(error);
    }
  }, []);

  useEffect(() => {
    return () => {
      syncAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!socket) {
      return;
    }

    const refreshList = () => {
      void syncChats();
    };

    socket.on("chat:updated", refreshList);
    socket.on("chat-request:new", refreshList);
    socket.on("chat-request:accepted", refreshList);
    socket.on("chat-request:declined", refreshList);
    socket.on("chat-request:canceled", refreshList);
    socket.on("connect", refreshList);

    return () => {
      socket.off("chat:updated", refreshList);
      socket.off("chat-request:new", refreshList);
      socket.off("chat-request:accepted", refreshList);
      socket.off("chat-request:declined", refreshList);
      socket.off("chat-request:canceled", refreshList);
      socket.off("connect", refreshList);
    };
  }, [socket, syncChats]);

  const applyChatMutation = useCallback(async (
    chat: ChatListItem,
    body: { mutedUntil?: string | null; archived?: boolean; deleted?: boolean },
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

  const handleDelete = useCallback((chat: ChatListItem) => {
    const previous = chats;
    void applyChatMutation(
      chat,
      { deleted: true },
      (current) => current.filter((item) => item.id !== chat.id),
      previous,
    );
  }, [applyChatMutation, chats]);

  const handleArchive = useCallback((chat: ChatListItem) => {
    const previous = chats;
    void applyChatMutation(
      chat,
      { archived: true },
      (current) => current.filter((item) => item.id !== chat.id),
      previous,
    );
  }, [applyChatMutation, chats]);

  const handleMuteChoice = useCallback((minutes: number) => {
    if (!muteSheetChat) {
      return;
    }

    const mutedUntil = minutes < 0
      ? new Date("2999-12-31T23:59:59.000Z").toISOString()
      : new Date(Date.now() + minutes * 60_000).toISOString();
    const previous = chats;
    const chat = muteSheetChat;
    setMuteSheetChat(null);

    void applyChatMutation(
      chat,
      { mutedUntil },
      (current) => current.map((item) => (item.id === chat.id ? { ...item, mutedUntil } : item)),
      previous,
    );
  }, [applyChatMutation, chats, muteSheetChat]);

  const handleOpenMute = useCallback((chat: ChatListItem) => {
    setOpenRowId(null);
    setMuteSheetChat(chat);
  }, []);

  const handleNavigate = useCallback((chatId: string) => {
    startTransition(() => {
      router.push(`/chats/${chatId}`);
    });
  }, [router]);

  useEffect(() => {
    router.prefetch("/chats/new");
  }, [router]);

  return (
    <div className="app-section transition-smooth">
      <div className="app-section-header px-2">
        <h1 className="app-section-title">Чаты</h1>
        <Link
          className="touch-target flex h-14 w-14 items-center justify-center rounded-[1.5rem] border border-primary/20 bg-primary/10 text-primary shadow-sm transition-smooth active:scale-90 hover:bg-primary/20"
          href="/chats/new"
          prefetch
        >
          <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </Link>
      </div>

      <div className="mb-8 px-2">
        <ChatSearch />
      </div>

      {incomingRequests.length > 0 ? (
        <div className="mb-10 animate-in slide-in-from-top-2 duration-200">
          <h2 className="mb-5 px-3 text-[10px] font-black uppercase tracking-[0.2em] text-muted/60">Запросы на переписку</h2>
          <IncomingRequestCards requests={incomingRequests} onChange={() => { void syncChats(); }} />
        </div>
      ) : null}

      {archivedCount > 0 && (
        <div className="mb-4">
          <Link href="/chats/archive" className="flex items-center justify-between px-4 py-3 rounded-2xl bg-surface border border-border-subtle/50 transition-smooth hover:bg-surface-elevated active:scale-[0.98] fast-tap">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">Архив</p>
                <p className="text-[10px] font-black uppercase tracking-widest text-muted">{archivedCount} {archivedCount === 1 ? 'чат' : (archivedCount > 1 && archivedCount < 5) ? 'чата' : 'чатов'}</p>
              </div>
            </div>
            <svg className="h-4 w-4 text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </Link>
        </div>
      )}

      {chats.length === 0 ? (
        <div className="mt-20 text-center animate-in fade-in zoom-in-95 duration-200">
          <div className="mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-[2.5rem] border border-border-subtle/50 bg-surface-muted shadow-inner">
            <span className="text-4xl">💬</span>
          </div>
          <h2 className="text-2xl font-black tracking-tight text-foreground/90">Начните общение</h2>
          <p className="mx-auto mt-3 max-w-[240px] text-base font-medium leading-relaxed text-muted/60">
            Здесь будут отображаться ваши диалоги с другими пользователями.
          </p>
          <Link
            className="btn-nox mt-10 inline-flex h-14 items-center rounded-3xl bg-primary px-10 text-sm font-black text-white shadow-xl shadow-primary/20 transition-smooth active:scale-95"
            href="/chats/new"
            prefetch
          >
            НАЙТИ СОБЕСЕДНИКА
          </Link>
        </div>
      ) : (
        <div className="space-y-1 animate-in fade-in duration-180">
          {chats.map((chat) => (
            <SwipeableChatRow
              key={chat.id}
              chat={chat}
              isOpen={openRowId === chat.id}
              onOpen={setOpenRowId}
              onNavigate={handleNavigate}
              onDelete={handleDelete}
              onArchive={handleArchive}
              onMute={handleOpenMute}
            />
          ))}
        </div>
      )}

      {muteSheetChat ? (
        <div className="fixed inset-0 z-[450] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md rounded-[2rem] border border-border-subtle/50 bg-surface-elevated p-5 shadow-2xl">
            <div className="mb-4 h-1.5 w-12 rounded-full bg-border mx-auto" />
            <h2 className="mb-2 text-lg font-black tracking-tight text-foreground">Отключить уведомления</h2>
            <p className="mb-5 text-sm text-muted">Выберите срок для этого чата.</p>
            <div className="space-y-2">
              {MUTE_OPTIONS.map((option) => (
                <button
                  key={option.label}
                  type="button"
                  onClick={() => handleMuteChoice(option.minutes)}
                  className="flex w-full items-center justify-between rounded-2xl border border-border-subtle/40 bg-surface/70 px-4 py-4 text-left transition-smooth active:scale-[0.98] hover:bg-surface-hover"
                >
                  <span className="font-bold text-foreground">{option.label}</span>
                  <span className="text-xs font-black uppercase tracking-widest text-muted">Чат</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMuteSheetChat(null)}
                className="mt-2 w-full rounded-2xl px-4 py-4 text-sm font-black uppercase tracking-widest text-muted transition-smooth active:scale-[0.98]"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
