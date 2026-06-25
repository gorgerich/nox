"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, MessageCircle, Search, Send, UserPlus, Users } from "lucide-react";

import { useSocket } from "@/hooks/useSocket";
import type { ChatFolderItem, ChatListItem, IncomingRequestCardItem } from "@/lib/chat-list";
import { getChatCache, putChatHeader, putChatList, putChatPreview } from "@/lib/chat-cache";
import { getMessagePreview } from "@/lib/chat-list-format";

import { IncomingRequestCards } from "./IncomingRequestCards";
import { SwipeableChatRow } from "./SwipeableChatRow";
import { GroupPicker } from "./GroupPicker";

const DEBUG_REALTIME = process.env.NEXT_PUBLIC_DEBUG_REALTIME === "true";

type ChatsPageClientProps = {
  currentUserId: string;
  initialChats: ChatListItem[];
  initialIncomingRequests: IncomingRequestCardItem[];
  initialArchivedCount?: number;
  initialChatFolders?: ChatFolderItem[];
};

const FOLDERS = [
  { key: "all", label: "Все" },
  { key: "personal", label: "Личное" },
  { key: "important", label: "Важное" },
  { key: "unread", label: "Непрочитанные" },
] as const;
type FolderKey = (typeof FOLDERS)[number]["key"];
type SelectedFolderKey = FolderKey | `custom:${string}`;

type InviteSheetState = {
  code: string;
  link: string;
  notice: string;
  expiresAt: string | null;
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
  currentUserId,
  initialChats,
  initialIncomingRequests,
  initialArchivedCount = 0,
  initialChatFolders = [],
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
  const [inviteSheet, setInviteSheet] = useState<InviteSheetState | null>(null);
  const [invitePending, setInvitePending] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);
  const [chatFolders, setChatFolders] = useState(initialChatFolders);
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolderKey>("all");

  // Local folder filtering — no reload. Self chat ("Личное") floats to the top
  // in "all" and "personal". Important = pinned (no separate field yet).
  const filteredChats = useMemo(() => {
    let list = chats;
    if (selectedFolder.startsWith("custom:")) {
      const folderId = selectedFolder.slice("custom:".length);
      const folder = chatFolders.find((item) => item.id === folderId);
      const allowedIds = new Set(folder?.chatIds ?? []);
      list = chats.filter((c) => allowedIds.has(c.id));
    } else if (selectedFolder === "personal") list = chats.filter((c) => c.type === "DIRECT");
    else if (selectedFolder === "important") list = chats.filter((c) => Boolean(c.pinnedAt));
    else if (selectedFolder === "unread") list = chats.filter((c) => c.unreadCount > 0);
    if (selectedFolder === "all" || selectedFolder === "personal") {
      list = [...list].sort((a, b) => (a.isSelfChat === b.isSelfChat ? 0 : a.isSelfChat ? -1 : 1));
    }
    return list;
  }, [chatFolders, chats, selectedFolder]);
  const folderCounts = useMemo<Record<FolderKey, number>>(() => {
    // Single pass instead of three independent .filter().length scans.
    let personal = 0;
    let important = 0;
    let unread = 0;
    for (const chat of chats) {
      if (chat.type === "DIRECT") personal++;
      if (chat.pinnedAt) important++;
      if (chat.unreadCount > 0) unread++;
    }
    return { all: chats.length, personal, important, unread };
  }, [chats]);
  const unreadTotal = folderCounts.unread;
  const customFolderCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    for (const folder of chatFolders) {
      const allowedIds = new Set(folder.chatIds);
      counts[folder.id] = chats.reduce((count, chat) => count + (allowedIds.has(chat.id) ? 1 : 0), 0);
    }
    return counts;
  }, [chatFolders, chats]);
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
        chatFolders?: ChatFolderItem[];
      };
      setChats(data.chats);
      setIncomingRequests(data.incomingRequests);
      if (data.archivedCount !== undefined) {
        setArchivedCount(data.archivedCount);
      }
      if (data.chatFolders) {
        setChatFolders(data.chatFolders);
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
    const handleMessageNew = (data: { chatId: string; message: ChatListItem["lastMessage"] & { senderUserId: string, sender?: { username: string; profile?: { displayName: string } }, receipts?: { deliveredAt?: string | Date | null; readAt?: string | Date | null }[] } }) => {
      setChats(prev => {
        const chatIdx = prev.findIndex(c => c.id === data.chatId);
        if (chatIdx === -1) {
          refreshList();
          return prev;
        }
        
        const updatedChat = { ...prev[chatIdx] };
        const msg = data.message;
        const receipts = msg.receipts ?? [];
        const readAt = receipts.find((receipt) => receipt.readAt)?.readAt ?? null;
        const deliveredAt = receipts.find((receipt) => receipt.deliveredAt)?.deliveredAt ?? null;
        const deliveryStatus = readAt ? "read" : deliveredAt ? "delivered" : "sent";
        
        updatedChat.lastMessage = {
          id: msg.id,
          type: msg.type,
          body: msg.isEncrypted ? null : msg.body,
          isEncrypted: msg.isEncrypted,
          ciphertext: msg.ciphertext,
          isMine: msg.senderUserId === currentUserId,
          deliveredAt: deliveredAt ? new Date(deliveredAt).toISOString() : msg.deliveredAt ?? null,
          readAt: readAt ? new Date(readAt).toISOString() : msg.readAt ?? null,
          deliveryStatus,
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
    };
    socket.on("message:new", handleMessageNew);
    socket.on("message:receipts-updated", (payload: { chatId: string; messageId?: string; deliveredAt?: string | Date | null; readAt?: string | Date | null }) => {
      setChats(prev => prev.map((chat) => {
        if (
          chat.id !== payload.chatId
          || chat.lastMessage?.sender.id !== currentUserId
          || (payload.messageId && chat.lastMessage.id !== payload.messageId)
        ) {
          return chat;
        }

        const deliveredAt = payload.deliveredAt
          ? new Date(payload.deliveredAt).toISOString()
          : chat.lastMessage.deliveredAt ?? null;
        const readAt = payload.readAt
          ? new Date(payload.readAt).toISOString()
          : chat.lastMessage.readAt ?? null;

        return {
          ...chat,
          lastMessage: {
            ...chat.lastMessage,
            deliveredAt,
            readAt,
            deliveryStatus: readAt ? "read" : deliveredAt ? "delivered" : "sent",
          },
        };
      }));
    });
    socket.on("chat-request:new", refreshList);
    socket.on("chat-request:accepted", refreshList);
    socket.on("chat-request:declined", refreshList);
    socket.on("chat-request:canceled", refreshList);
    socket.on("connect", refreshList);

    return () => {
      socket.off("chat:updated", refreshList);
      socket.off("message:new", handleMessageNew);
      socket.off("message:receipts-updated");
      socket.off("chat-request:new", refreshList);
      socket.off("chat-request:accepted", refreshList);
      socket.off("chat-request:declined", refreshList);
      socket.off("chat-request:canceled", refreshList);
      socket.off("connect", refreshList);
    };
  }, [currentUserId, socket, syncChats]);

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

  const createUserInvite = useCallback(async () => {
    setPlusMenuOpen(false);
    setInvitePending(true);
    setInviteError("");
    setInviteCopied(false);
    setInviteSheet(null);

    try {
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const data = (await response.json().catch(() => null)) as {
        rawInviteCode?: string;
        notice?: string;
        invite?: { expiresAt?: string | null };
        error?: string;
      } | null;

      if (!response.ok || !data?.rawInviteCode) {
        throw new Error(data?.error || "Не удалось создать приглашение.");
      }

      const origin = window.location.origin;
      setInviteSheet({
        code: data.rawInviteCode,
        link: `${origin}/join?code=${encodeURIComponent(data.rawInviteCode)}`,
        notice: data.notice || "Отправьте ссылку человеку, которого хотите пригласить.",
        expiresAt: data.invite?.expiresAt ?? null,
      });
    } catch (error) {
      setInviteError(error instanceof Error ? error.message : "Не удалось создать приглашение.");
      setInviteSheet({
        code: "",
        link: "",
        notice: "",
        expiresAt: null,
      });
    } finally {
      setInvitePending(false);
    }
  }, []);

  const copyInviteLink = useCallback(async () => {
    if (!inviteSheet?.link) return;

    try {
      await navigator.clipboard.writeText(inviteSheet.link);
      setInviteCopied(true);
      window.setTimeout(() => setInviteCopied(false), 1800);
    } catch {
      setInviteError("Не удалось скопировать ссылку.");
    }
  }, [inviteSheet]);

  const shareInviteLink = useCallback(async () => {
    if (!inviteSheet?.link) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Приглашение в Nox",
          text: "Присоединяйся к Nox",
          url: inviteSheet.link,
        });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }

    await copyInviteLink();
  }, [copyInviteLink, inviteSheet]);

  const seedInstantChatCache = useCallback((chatId: string) => {
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) return;

    const title = chat.isSelfChat
      ? "Личное"
      : chat.type === "DIRECT"
        ? chat.otherMember?.displayName ?? chat.otherMember?.username ?? "Личное"
        : chat.title ?? "Группа";
    const avatarUrl = chat.type === "GROUP" ? chat.avatarUrl : chat.otherMember?.avatarUrl ?? null;

    putChatHeader(chat.id, {
      title,
      avatarUrl,
      isSelfChat: chat.isSelfChat,
    });

    const last = chat.lastMessage;
    if (!last) return;

    const existingPreview = getChatCache(chat.id)?.preview ?? [];
    const lastPreview = {
      id: last.id,
      mine: last.sender.id === currentUserId,
      text: getMessagePreview(chat),
    };

    const mergedPreview = existingPreview.some((message) => message.id === last.id)
      ? existingPreview
      : [...existingPreview, lastPreview];
    putChatPreview(chat.id, mergedPreview);
  }, [chats, currentUserId]);

  const handleNavigate = useCallback((chatId: string) => {
    seedInstantChatCache(chatId);
  }, [seedInstantChatCache]);

  const handlePrefetchChat = useCallback((chatId: string) => {
    seedInstantChatCache(chatId);
    router.prefetch(`/chats/${chatId}`);
  }, [router, seedInstantChatCache]);

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

  // Cache the current list (RAM) so returning to the tab can paint real rows
  // immediately instead of skeleton bars.
  useEffect(() => {
    putChatList(chats);
  }, [chats]);

  return (
    <div 
      className="app-section relative !px-4 !pt-[calc(env(safe-area-inset-top,0px)+18px)] transition-smooth"
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
          <div className={`premium-glass rounded-full p-2 transition-smooth ${isRefreshing ? "animate-spin" : ""}`}>
             <svg className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ transform: `rotate(${pullProgress * 3.6}deg)` }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.001 0 01-15.357-2m15.357 2H15" />
             </svg>
          </div>
        </div>
      )}

      <div className="mb-3 flex items-end justify-between gap-3 px-1">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h1 className="text-[30px] font-bold leading-none tracking-[-0.02em] text-foreground">Чаты</h1>
            {unreadTotal > 0 ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[12px] font-semibold text-primary">
                {unreadTotal} новых
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="touch-target fluid-hit fast-tap flex h-10 w-10 items-center justify-center rounded-full text-primary transition-colors hover:bg-surface-muted"
            onClick={() => setPlusMenuOpen(true)}
            aria-label="Новое"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            className="premium-glass w-full max-w-md rounded-[1.75rem] p-2 animate-in slide-in-from-bottom-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => { setPlusMenuOpen(false); router.push("/chats/new"); }}
              className="fluid-hit flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-surface-muted"
            >
              <Search className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
              <span className="text-[16px] font-medium text-foreground">Найти человека</span>
            </button>
            <button
              type="button"
              onClick={() => { setPlusMenuOpen(false); setIsGroupPickerOpen(true); }}
              className="fluid-hit flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-surface-muted"
            >
              <Users className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
              <span className="text-[16px] font-medium text-foreground">Создать групповой чат</span>
            </button>
            <button
              type="button"
              onClick={() => { void createUserInvite(); }}
              className="fluid-hit flex w-full items-center gap-3 rounded-2xl px-4 py-3.5 text-left transition-colors hover:bg-surface-muted"
            >
              <UserPlus className="h-5 w-5 shrink-0 text-primary" strokeWidth={2} />
              <span className="text-[16px] font-medium text-foreground">Пригласить человека</span>
            </button>
            <button
              type="button"
              onClick={() => setPlusMenuOpen(false)}
              className="fluid-hit mt-1 w-full rounded-2xl px-4 py-3.5 text-[16px] font-semibold text-muted transition-colors hover:bg-surface-muted"
            >
              Отмена
            </button>
          </div>
        </div>
      )}

      {(invitePending || inviteSheet) && (
        <div
          className="fixed inset-0 z-[470] flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm animate-in fade-in"
          onClick={() => {
            if (!invitePending) {
              setInviteSheet(null);
              setInviteError("");
            }
          }}
        >
          <div
            className="premium-glass w-full max-w-md rounded-[1.75rem] p-5 animate-in slide-in-from-bottom-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-border" />
            <div className="mb-5 flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                <UserPlus className="h-6 w-6" strokeWidth={2.1} />
              </div>
              <div className="min-w-0">
                <h2 className="text-xl font-semibold tracking-tight text-foreground">Пригласить в Nox</h2>
                <p className="mt-1 text-sm leading-5 text-muted">
                  {invitePending
                    ? "Создаём одноразовую ссылку..."
                    : inviteError || inviteSheet?.notice || "Отправьте ссылку человеку."}
                </p>
              </div>
            </div>

            {invitePending ? (
              <div className="flex h-24 items-center justify-center">
                <div className="h-7 w-7 rounded-full border-2 border-primary/25 border-t-primary animate-spin" />
              </div>
            ) : inviteSheet?.link ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border-subtle/60 bg-background/60 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-muted">Ссылка</p>
                  <p className="break-all text-[14px] font-medium leading-5 text-foreground">{inviteSheet.link}</p>
                </div>
                <div className="rounded-2xl border border-border-subtle/60 bg-background/60 p-3">
                  <p className="mb-2 text-[11px] font-semibold text-muted">Код</p>
                  <code className="block select-all truncate font-mono text-[13px] text-foreground">{inviteSheet.code}</code>
                </div>
                {inviteSheet.expiresAt && (
                  <p className="px-1 text-[12px] text-muted">
                    Действует до {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(inviteSheet.expiresAt))}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => { void copyInviteLink(); }}
                    className="fast-tap fluid-hit flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-surface-muted text-sm font-semibold text-foreground transition-smooth"
                  >
                    {inviteCopied ? <Check className="h-4 w-4 text-primary" /> : <Copy className="h-4 w-4" />}
                    {inviteCopied ? "Скопировано" : "Копировать"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { void shareInviteLink(); }}
                    className="fast-tap fluid-hit flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth"
                  >
                    <Send className="h-4 w-4" />
                    Отправить
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setInviteSheet(null);
                  setInviteError("");
                }}
                className="fast-tap fluid-hit flex h-12 w-full items-center justify-center rounded-full bg-surface-muted text-sm font-semibold text-foreground transition-smooth"
              >
                Закрыть
              </button>
            )}
          </div>
        </div>
      )}

      {isGroupPickerOpen && (
        <GroupPicker 
          onClose={() => setIsGroupPickerOpen(false)} 
          onNavigate={handleNavigate}
        />
      )}

      {/* Folder filter — segmented pills. Filters the list locally (no reload). */}
      <div className="mb-2 -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-hide">
        {FOLDERS.map((folder) => {
          const active = selectedFolder === folder.key;
          const count = folderCounts[folder.key];
          return (
            <button
              key={folder.key}
              type="button"
              onClick={() => setSelectedFolder(folder.key)}
              className={`fluid-hit fast-tap flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                active ? "bg-primary/12 text-primary" : "text-muted/72 hover:bg-surface-muted"
              }`}
            >
              <span>{folder.label}</span>
              {count > 0 ? (
                <span className={`text-[11px] font-semibold tabular-nums ${active ? "text-primary/72" : "text-muted/54"}`}>
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
          );
        })}
        {chatFolders.map((folder) => {
          const selectedKey = `custom:${folder.id}` as const;
          const active = selectedFolder === selectedKey;
          const count = customFolderCounts[folder.id] ?? 0;
          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => setSelectedFolder(selectedKey)}
              className={`fluid-hit fast-tap flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                active ? "bg-primary/12 text-primary" : "text-muted/72 hover:bg-surface-muted"
              }`}
            >
              <span>{folder.name}</span>
              {count > 0 ? (
                <span className={`text-[11px] font-semibold tabular-nums ${active ? "text-primary/72" : "text-muted/54"}`}>
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {incomingRequests.length > 0 ? (
        <div className="mb-10 animate-in slide-in-from-top-2 duration-200">
          <h2 className="mb-3 px-3 text-[13px] font-semibold text-muted/70">Запросы на переписку</h2>
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
          <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-full border border-border-subtle/60 bg-surface-muted text-primary">
            <MessageCircle className="h-9 w-9" strokeWidth={1.8} />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground/90">Начните общение</h2>
          <p className="mx-auto mt-3 max-w-[240px] text-base font-medium leading-relaxed text-muted/60">
            Здесь будут отображаться ваши диалоги с другими пользователями.
          </p>
          <Link
            className="btn-primary mt-9 inline-flex h-12 items-center rounded-full px-7 text-sm font-semibold"
            href="/chats/new"
            prefetch
          >
            Найти собеседника
          </Link>
        </div>
      ) : filteredChats.length === 0 ? (
        <div className="mt-16 px-6 text-center animate-in fade-in duration-200">
          <h2 className="text-lg font-semibold text-foreground/85">
            {selectedFolder === "important" ? "Нет важных чатов"
              : selectedFolder === "unread" ? "Нет непрочитанных"
              : selectedFolder.startsWith("custom:") ? "Папка пустая"
              : "Нет личных чатов"}
          </h2>
          <p className="mx-auto mt-2 max-w-[260px] text-sm leading-relaxed text-muted/60">
            {selectedFolder === "important" ? "Закрепите чат или отметьте его как важный, чтобы он появился здесь."
              : selectedFolder === "unread" ? "Все сообщения уже просмотрены."
              : selectedFolder.startsWith("custom:") ? "Добавьте чаты в папку через настройки профиля."
              : "Личные диалоги появятся здесь."}
          </p>
        </div>
      ) : (
        <div className="-mx-4 animate-in fade-in duration-180">
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
              onPressStart={seedInstantChatCache}
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
          <div className="premium-glass w-full max-w-md rounded-[2rem] p-5">
            <div className="mb-4 h-1.5 w-12 rounded-full bg-border mx-auto" />
            <h2 className="mb-2 text-lg font-semibold tracking-tight text-foreground">Отключить уведомления</h2>
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
                  <span className="text-xs font-semibold text-muted">Чат</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMuteSheetChat(null)}
                className="fluid-hit mt-2 w-full rounded-full px-4 py-3.5 text-sm font-semibold text-muted transition-smooth hover:bg-surface-muted"
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
