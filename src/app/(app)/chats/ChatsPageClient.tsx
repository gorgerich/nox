"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, Users } from "lucide-react";

import { useSocket } from "@/hooks/useSocket";
import type { ChatListItem, IncomingRequestCardItem } from "@/lib/chat-list";
import { putChatList } from "@/lib/chat-cache";

import { ChatSearch } from "./ChatSearch";
import { IncomingRequestCards } from "./IncomingRequestCards";
import { SwipeableChatRow } from "./SwipeableChatRow";
import { GroupPicker } from "./GroupPicker";

const DEBUG_REALTIME = process.env.NEXT_PUBLIC_DEBUG_REALTIME === "true";

type ChatsPageClientProps = {
  currentUserId: string;
  initialChats: ChatListItem[];
  initialIncomingRequests: IncomingRequestCardItem[];
  initialArchivedCount?: number;
};

const FOLDERS = [
  { key: "all", label: "Все" },
  { key: "personal", label: "Личное" },
  { key: "important", label: "Важное" },
  { key: "unread", label: "Непрочитанные" },
] as const;
type FolderKey = (typeof FOLDERS)[number]["key"];

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
  currentUserId,
  initialChats,
  initialIncomingRequests,
  initialArchivedCount = 0,
}: ChatsPageClientProps) {
  const router = useRouter();
  const { socket } = useSocket();
  const [chats, setChats] = useState(initialChats);
  // chatId -> name of who is typing (live, from typing:update). Auto-cleared.
  const [typingByChat, setTypingByChat] = useState<Record<string, string>>({});
  const [incomingRequests, setIncomingRequests] = useState(initialIncomingRequests);
  const [archivedCount, setArchivedCount] = useState(initialArchivedCount);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [muteSheetChat, setMuteSheetChat] = useState<ChatListItem | null>(null);
  const [isGroupPickerOpen, setIsGroupPickerOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<FolderKey>("all");

  // Local folder filtering — no reload. Self chat ("Личное") floats to the top
  // in "all" and "personal". Important = pinned (no separate field yet).
  const filteredChats = useMemo(() => {
    let list = chats;
    if (selectedFolder === "personal") list = chats.filter((c) => c.type === "DIRECT");
    else if (selectedFolder === "important") list = chats.filter((c) => Boolean(c.pinnedAt));
    else if (selectedFolder === "unread") list = chats.filter((c) => c.unreadCount > 0);
    if (selectedFolder === "all" || selectedFolder === "personal") {
      list = [...list].sort((a, b) => (a.isSelfChat === b.isSelfChat ? 0 : a.isSelfChat ? -1 : 1));
    }
    return list;
  }, [chats, selectedFolder]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullProgress, setPullProgress] = useState(0);
  const syncAbortRef = useRef<AbortController | null>(null);
  const pullStartRef = useRef<number | null>(null);

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

  const handlePullTouchStart = useCallback((e: React.TouchEvent) => {
    if (window.scrollY > 5) return;
    pullStartRef.current = e.touches[0].clientY;
  }, []);

  const handlePullTouchMove = useCallback((e: React.TouchEvent) => {
    if (pullStartRef.current === null || isRefreshing) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - pullStartRef.current;
    
    if (diff > 0) {
      const progress = Math.min(100, (diff / 150) * 100);
      setPullProgress(progress);
    }
  }, [isRefreshing]);

  const handlePullTouchEnd = useCallback(async () => {
    if (pullStartRef.current === null || isRefreshing) return;
    if (pullProgress >= 90) {
      setIsRefreshing(true);
      setPullProgress(100);
      await syncChats();
      setTimeout(() => {
        setIsRefreshing(false);
        setPullProgress(0);
      }, 500);
    } else {
      setPullProgress(0);
    }
    pullStartRef.current = null;
  }, [isRefreshing, pullProgress, syncChats]);

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
    socket.on("message:new", (data: { chatId: string; message: ChatListItem["lastMessage"] & { senderUserId: string, sender?: { username: string; profile?: { displayName: string } } } }) => {
      setChats(prev => {
        const chatIdx = prev.findIndex(c => c.id === data.chatId);
        if (chatIdx === -1) {
          refreshList();
          return prev;
        }
        
        const updatedChat = { ...prev[chatIdx] };
        const msg = data.message;
        
        updatedChat.lastMessage = {
          id: msg.id,
          type: msg.type,
          body: msg.isEncrypted ? "Зашифрованное сообщение" : msg.body,
          isEncrypted: msg.isEncrypted,
          deletedAt: msg.deletedAt,
          createdAt: msg.createdAt,
          attachments: msg.attachments || [],
          sender: {
            id: msg.senderUserId,
            username: msg.sender?.username || "",
            displayName: msg.sender?.profile?.displayName || msg.sender?.username || "",
          }
        };
        updatedChat.updatedAt = msg.createdAt;
        
        const newChats = [...prev];
        newChats[chatIdx] = updatedChat;
        // Sort by updatedAt
        return newChats.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      });
    });
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

  // Live "typing…" in the chat list. The socket joins every chat room on
  // connect, so typing:update arrives here for all chats. Clear after a short
  // idle in case a stop event is missed.
  useEffect(() => {
    if (!socket) return;
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const onTyping = (data: { chatId: string; displayName?: string; isTyping: boolean }) => {
      if (timers[data.chatId]) clearTimeout(timers[data.chatId]);
      if (data.isTyping) {
        setTypingByChat((prev) => ({ ...prev, [data.chatId]: data.displayName || "" }));
        timers[data.chatId] = setTimeout(() => {
          setTypingByChat((prev) => {
            const next = { ...prev };
            delete next[data.chatId];
            return next;
          });
        }, 5000);
      } else {
        setTypingByChat((prev) => {
          if (!(data.chatId in prev)) return prev;
          const next = { ...prev };
          delete next[data.chatId];
          return next;
        });
      }
    };
    socket.on("typing:update", onTyping);
    return () => {
      socket.off("typing:update", onTyping);
      Object.values(timers).forEach(clearTimeout);
    };
  }, [socket]);

  const applyChatMutation = useCallback(async (
    chat: ChatListItem,
    body: { mutedUntil?: string | null; pinned?: boolean; archived?: boolean; deleted?: boolean },
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

  const handlePin = useCallback((chat: ChatListItem) => {
    const previous = chats;
    const shouldPin = !chat.pinnedAt;
    const pinnedAt = shouldPin ? new Date().toISOString() : null;

    void applyChatMutation(
      chat,
      { pinned: shouldPin },
      (current) =>
        current
          .map((item) => (item.id === chat.id ? { ...item, pinnedAt } : item))
          .sort((left, right) => {
            const leftPinned = left.pinnedAt ? new Date(left.pinnedAt).getTime() : 0;
            const rightPinned = right.pinnedAt ? new Date(right.pinnedAt).getTime() : 0;
            if (leftPinned !== rightPinned) {
              return rightPinned - leftPinned;
            }
            if (left.isSelfChat !== right.isSelfChat) {
              return left.isSelfChat ? -1 : 1;
            }
            const leftTime = left.lastMessage?.createdAt ?? left.updatedAt;
            const rightTime = right.lastMessage?.createdAt ?? right.updatedAt;
            return new Date(rightTime).getTime() - new Date(leftTime).getTime();
          }),
      previous,
    );
  }, [applyChatMutation, chats]);

  const handleNavigate = useCallback((chatId: string) => {
    router.push(`/chats/${chatId}`);
  }, [router]);

  const handlePrefetchChat = useCallback((chatId: string) => {
    router.prefetch(`/chats/${chatId}`);
  }, [router]);

  useEffect(() => {
    router.prefetch("/chats/new");
    router.prefetch("/contacts");
    router.prefetch("/calls");
    router.prefetch("/profile");
  }, [router]);

  useEffect(() => {
    chats.slice(0, 8).forEach((chat) => {
      router.prefetch(`/chats/${chat.id}`);
    });
  }, [chats, router]);

  // Cache the current list (RAM) so the tab's loading.tsx can paint real rows
  // instantly on the next open instead of skeleton bars.
  useEffect(() => {
    putChatList(chats);
  }, [chats]);

  return (
    <div 
      className="app-section transition-smooth relative"
      onTouchStart={handlePullTouchStart}
      onTouchMove={handlePullTouchMove}
      onTouchEnd={handlePullTouchEnd}
    >
      {/* Pull indicator */}
      {(pullProgress > 0 || isRefreshing) && (
        <div 
          className="absolute top-0 left-0 right-0 flex justify-center pt-2 pointer-events-none z-[100]"
          style={{ transform: `translateY(${Math.min(40, (pullProgress / 100) * 60)}px)`, opacity: pullProgress / 100 }}
        >
          <div className={`bg-surface-elevated border border-border-subtle rounded-full p-2 shadow-xl transition-smooth ${isRefreshing ? "animate-spin" : ""}`}>
             <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ transform: `rotate(${pullProgress * 3.6}deg)` }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.001 0 01-15.357-2m15.357 2H15" />
             </svg>
          </div>
        </div>
      )}

      <div className="app-section-header px-2">
        <h1 className="app-section-title">Чаты</h1>
        <div className="flex items-center gap-1">
          <button
            className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-colors active:opacity-60 hover:bg-surface-muted fast-tap"
            onClick={() => setPlusMenuOpen(true)}
            aria-label="Новое"
          >
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {plusMenuOpen && (
        <div
          className="fixed inset-0 z-[460] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => setPlusMenuOpen(false)}
        >
          <div
            className="glass-panel w-full max-w-md rounded-[1.75rem] p-2 animate-in slide-in-from-bottom-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => { setPlusMenuOpen(false); router.push("/chats/new"); }}
              className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors active:bg-surface-muted hover:bg-surface-muted"
            >
              <Search className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
              <span className="text-[16px] font-medium text-foreground">Найти человека</span>
            </button>
            <button
              type="button"
              onClick={() => { setPlusMenuOpen(false); setIsGroupPickerOpen(true); }}
              className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors active:bg-surface-muted hover:bg-surface-muted"
            >
              <Users className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
              <span className="text-[16px] font-medium text-foreground">Создать групповой чат</span>
            </button>
            <button
              type="button"
              // TODO: wire to real invite flow when available.
              onClick={() => { setPlusMenuOpen(false); router.push("/chats/new"); }}
              className="flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors active:bg-surface-muted hover:bg-surface-muted"
            >
              <UserPlus className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
              <span className="text-[16px] font-medium text-foreground">Пригласить человека</span>
            </button>
            <button
              type="button"
              onClick={() => setPlusMenuOpen(false)}
              className="mt-1 w-full rounded-2xl px-4 py-3.5 text-[16px] font-semibold text-muted transition-colors active:bg-surface-muted"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {isGroupPickerOpen && (
        <GroupPicker 
          onClose={() => setIsGroupPickerOpen(false)} 
          onNavigate={handleNavigate}
        />
      )}

      <div className="mb-3 px-2">
        <ChatSearch />
      </div>

      {/* Folder filter — segmented pills. Filters the list locally (no reload). */}
      <div className="mb-4 -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-hide">
        {FOLDERS.map((folder) => {
          const active = selectedFolder === folder.key;
          return (
            <button
              key={folder.key}
              type="button"
              onClick={() => setSelectedFolder(folder.key)}
              className={`shrink-0 rounded-full px-4 py-1.5 text-[14px] font-medium transition-colors fast-tap ${
                active ? "bg-primary/12 text-primary" : "text-muted/70 hover:bg-surface-muted"
              }`}
            >
              {folder.label}
            </button>
          );
        })}
      </div>

      {incomingRequests.length > 0 ? (
        <div className="mb-10 animate-in slide-in-from-top-2 duration-200">
          <h2 className="mb-3 px-3 text-[13px] font-semibold text-muted/60">Запросы на переписку</h2>
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
                <p className="text-[16px] font-semibold text-foreground">Архив</p>
                <p className="text-[13px] text-muted">{archivedCount} {archivedCount === 1 ? 'чат' : (archivedCount > 1 && archivedCount < 5) ? 'чата' : 'чатов'}</p>
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
            className="btn-primary mt-10 inline-flex h-14 items-center rounded-3xl px-10 text-sm font-black"
            href="/chats/new"
            prefetch
          >
            НАЙТИ СОБЕСЕДНИКА
          </Link>
        </div>
      ) : filteredChats.length === 0 ? (
        <div className="mt-16 px-6 text-center animate-in fade-in duration-200">
          <h2 className="text-lg font-semibold text-foreground/85">
            {selectedFolder === "important" ? "Нет важных чатов"
              : selectedFolder === "unread" ? "Нет непрочитанных"
              : "Нет личных чатов"}
          </h2>
          <p className="mx-auto mt-2 max-w-[260px] text-sm leading-relaxed text-muted/60">
            {selectedFolder === "important" ? "Закрепите чат или отметьте его как важный, чтобы он появился здесь."
              : selectedFolder === "unread" ? "Все сообщения уже просмотрены."
              : "Личные диалоги появятся здесь."}
          </p>
        </div>
      ) : (
        <div className="-mx-5 animate-in fade-in duration-180">
          {filteredChats.map((chat) => (
            <SwipeableChatRow
              key={chat.id}
              chat={chat}
              currentUserId={currentUserId}
              typingName={typingByChat[chat.id]}
              isOpen={openRowId === chat.id}
              onOpen={setOpenRowId}
              onNavigate={handleNavigate}
              onPrefetch={handlePrefetchChat}
              onDelete={handleDelete}
              onArchive={handleArchive}
              onMute={handleOpenMute}
              onPin={handlePin}
            />
          ))}
        </div>
      )}

      {muteSheetChat ? (
        <div className="fixed inset-0 z-[450] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="glass-panel w-full max-w-md rounded-[2rem] p-5">
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
