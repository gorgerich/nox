"use client";

import Image from "next/image";
import Link from "next/link";
import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Archive, BellOff, Bookmark, Check, CheckCheck, Pin, Trash2 } from "lucide-react";

import type { ChatListItem } from "@/lib/chat-list";
import { normalizeAvatarUrl } from "@/lib/media-url";
import { formatChatTime, getMessagePreview } from "@/lib/chat-list-format";

const SWIPE_OPEN_THRESHOLD = 72;

type SwipeableChatRowProps = {
  chat: ChatListItem;
  currentUserId?: string;
  typingName?: string;
  isOpen: boolean;
  onOpen: (chatId: string | null) => void;
  onNavigate: (chatId: string) => void;
  onPrefetch?: (chatId: string) => void;
  onPressStart?: (chatId: string) => void;
  onPressCancel?: (chatId: string) => void;
  onDelete: (chat: ChatListItem) => void;
  onArchive: (chat: ChatListItem) => void;
  onMute: (chat: ChatListItem) => void;
  onPin?: (chat: ChatListItem) => void;
  isArchiveMode?: boolean;
};

export const SwipeableChatRow = memo(function SwipeableChatRow({
  chat,
  currentUserId,
  typingName,
  isOpen,
  onOpen,
  onNavigate,
  onPrefetch,
  onPressStart,
  onPressCancel,
  onDelete,
  onArchive,
  onMute,
  onPin,
  isArchiveMode = false,
}: SwipeableChatRowProps) {
  const LEFT_ACTIONS_WIDTH = isArchiveMode ? 74 : 148;
  const RIGHT_ACTIONS_WIDTH = 148;
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startOffsetRef = useRef(0);
  const directionLockedRef = useRef<"horizontal" | "vertical" | null>(null);
  const movedRef = useRef(false);
  const [translateX, setTranslateX] = useState(0);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const muted = Boolean(chat.mutedUntil && new Date(chat.mutedUntil).getTime() > Date.now());
  const pinned = Boolean(chat.pinnedAt);

  // Unsent draft saved by the composer (localStorage). Shown as "Черновик: …".
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    try {
      const d = localStorage.getItem(`nox:draft:${chat.id}`);
      setDraft(d && d.trim() ? d.trim() : null);
    } catch {
      setDraft(null);
    }
  }, [chat.id, chat.updatedAt]);

  useEffect(() => {
    if (!isOpen) setTranslateX(0);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rowRef.current?.contains(event.target as Node)) {
        onOpen(null);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onOpen]);

  const resetGesture = useCallback(() => {
    pointerIdRef.current = null;
    directionLockedRef.current = null;
    movedRef.current = false;
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary) {
      return;
    }

    onPrefetch?.(chat.id);
    if (translateX === 0) {
      onPressStart?.(chat.id);
    }
    pointerIdRef.current = event.pointerId;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    startOffsetRef.current = translateX;
    directionLockedRef.current = null;
    movedRef.current = false;
  }, [chat.id, onPrefetch, onPressStart, translateX]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;

    if (!directionLockedRef.current) {
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
        directionLockedRef.current = "vertical";
        onPressCancel?.(chat.id);
        resetGesture();
        return;
      }
      if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        directionLockedRef.current = "horizontal";
        onPressCancel?.(chat.id);
      } else {
        return;
      }
    }

    if (directionLockedRef.current !== "horizontal") {
      return;
    }

    // prevent horizontal page shift
    event.preventDefault();

    movedRef.current = true;
    const nextX = Math.max(-RIGHT_ACTIONS_WIDTH, Math.min(LEFT_ACTIONS_WIDTH, startOffsetRef.current + deltaX));
    setTranslateX(nextX);
  }, [LEFT_ACTIONS_WIDTH, RIGHT_ACTIONS_WIDTH, chat.id, onPressCancel, resetGesture, startOffsetRef]);

  const finalizeSwipe = useCallback(() => {
    if (translateX < -SWIPE_OPEN_THRESHOLD) {
      setTranslateX(-RIGHT_ACTIONS_WIDTH);
      onOpen(chat.id);
    } else if (translateX > SWIPE_OPEN_THRESHOLD) {
      setTranslateX(LEFT_ACTIONS_WIDTH);
      onOpen(chat.id);
    } else {
      setTranslateX(0);
      onOpen(null);
    }
    resetGesture();
  }, [LEFT_ACTIONS_WIDTH, RIGHT_ACTIONS_WIDTH, chat.id, onOpen, resetGesture, translateX]);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    finalizeSwipe();
  }, [finalizeSwipe]);

  const handlePointerCancel = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    onPressCancel?.(chat.id);
    setTranslateX(isOpen ? translateX : 0);
    resetGesture();
  }, [chat.id, isOpen, onPressCancel, resetGesture, translateX]);

  const handleOpenChat = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (movedRef.current || translateX !== 0) {
      event.preventDefault();
      onPressCancel?.(chat.id);
      return;
    }
    onNavigate(chat.id);
  }, [chat.id, onNavigate, onPressCancel, translateX]);

  const title = chat.isSelfChat
    ? "Личное"
    : chat.type === "DIRECT"
      ? chat.otherMember?.displayName ?? chat.otherMember?.username ?? "Личное"
    : chat.title ?? "Группа";
  const lastIsMine = Boolean(
    chat.lastMessage && !chat.lastMessage.deletedAt
      && (chat.lastMessage.isMine || (currentUserId && chat.lastMessage.sender.id === currentUserId)),
  );
  const lastDelivered = Boolean(chat.lastMessage?.deliveredAt);
  const deliveryStatus = chat.lastMessage?.deliveryStatus
    ?? (chat.lastMessage?.readAt ? "read" : lastDelivered ? "delivered" : "sent");

  let previewNode: ReactNode;
  if (typingName) {
    previewNode = (
      <span className="text-primary">
        {chat.type === "GROUP" ? `${typingName} печатает…` : "печатает…"}
      </span>
    );
  } else if (draft) {
    previewNode = (<><span className="text-danger/80">Черновик: </span>{draft}</>);
  } else {
    previewNode = chat.isSelfChat ? "Сообщения самому себе" : getMessagePreview(chat);
  }
  const showTicks = lastIsMine && !typingName && !draft;

  const avatarToDisplay = chat.type === "GROUP" ? chat.avatarUrl : chat.otherMember?.avatarUrl;
  const fullAvatarUrl = normalizeAvatarUrl(avatarToDisplay);

  useEffect(() => {
    setAvatarFailed(false);
  }, [fullAvatarUrl]);

  const leftActionsVisible = translateX > 8;
  const rightActionsVisible = translateX < -8;
  const hasUnread = chat.unreadCount > 0;

  return (
    <div ref={rowRef} className="relative isolate overflow-hidden" data-nox-swipe-ignore="true">
      {/* Left Actions (visible when swiping right) — round icon buttons with a
          label underneath, the way Telegram renders swipe actions. */}
      <div
        className="absolute inset-y-0 left-0 z-0 flex items-center gap-1 pl-2 transition-opacity duration-150"
        style={{ opacity: leftActionsVisible ? 1 : 0, pointerEvents: leftActionsVisible ? "auto" : "none" }}
      >
        {!isArchiveMode ? (
          <button
            type="button"
            onClick={() => { onPin?.(chat); onOpen(null); }}
            className="swipe-action fast-tap"
          >
            <span className="swipe-action-circle bg-sky-500">
              <Pin className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.2} />
            </span>
            <span className="swipe-action-label">{pinned ? "Открепить" : "Закрепить"}</span>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => { onArchive(chat); onOpen(null); }}
          className="swipe-action fast-tap"
        >
          <span className="swipe-action-circle bg-slate-400">
            <Archive className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.2} />
          </span>
          <span className="swipe-action-label">{isArchiveMode ? "Вернуть" : "Архив"}</span>
        </button>
      </div>

      {/* Right Actions (visible when swiping left) */}
      <div
        className="absolute inset-y-0 right-0 z-0 flex items-center gap-1 pr-2 transition-opacity duration-150"
        style={{ opacity: rightActionsVisible ? 1 : 0, pointerEvents: rightActionsVisible ? "auto" : "none" }}
      >
        <button
          type="button"
          onClick={() => { onMute(chat); onOpen(null); }}
          className="swipe-action fast-tap disabled:opacity-40"
          disabled={isArchiveMode}
        >
          <span className="swipe-action-circle bg-amber-500">
            <BellOff className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.2} />
          </span>
          <span className="swipe-action-label">{muted ? "Звук" : "Без звука"}</span>
        </button>
        <button
          type="button"
          onClick={() => { onDelete(chat); onOpen(null); }}
          className="swipe-action fast-tap"
        >
          <span className="swipe-action-circle bg-danger">
            <Trash2 className="h-[1.15rem] w-[1.15rem]" strokeWidth={2.2} />
          </span>
          <span className="swipe-action-label">Удалить</span>
        </button>
      </div>

      <div
        className="relative z-10 will-change-transform"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{ transform: `translate3d(${translateX}px, 0, 0)`, touchAction: "pan-y" }}
      >
        <Link
          href={`/chats/${chat.id}`}
          prefetch={true}
          onClick={handleOpenChat}
          className={`group surface-rise fluid-hit relative flex w-full items-center gap-3 px-4 py-1.5 text-left transition-colors duration-100 hover:bg-surface-muted/55 active:bg-surface-hover ${
            hasUnread ? "bg-primary/[0.035]" : ""
          }`}
          style={{
            backgroundColor: pinned || chat.isSelfChat ? "var(--surface-muted)" : undefined,
          }}
        >
          <div className="relative flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted">
            {chat.isSelfChat ? (
              <div className="flex h-full w-full items-center justify-center bg-primary/15 text-primary">
                <Bookmark className="h-5.5 w-5.5" />
              </div>
            ) : fullAvatarUrl && !avatarFailed ? (
              <Image src={fullAvatarUrl} alt={title} fill className="object-cover" onError={() => setAvatarFailed(true)} />
            ) : (
              <span className="text-lg font-semibold uppercase text-primary">{title[0]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1 self-stretch border-b border-border-subtle/35 py-1.5 group-last:border-none">
            <div className="mb-0.5 flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                {hasUnread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
                <p className={`truncate text-[15px] text-foreground ${hasUnread ? "font-bold" : "font-semibold"}`}>{title}</p>
                {muted ? (
                  <BellOff className="h-3.5 w-3.5 shrink-0 text-muted/50" />
                ) : null}
              </div>
              <span className={`shrink-0 text-[12px] font-medium tabular-nums ${hasUnread ? "text-primary" : "text-muted/58"}`}>
                {formatChatTime(chat.lastMessage?.createdAt ?? chat.createdAt)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                {showTicks ? (
                  deliveryStatus === "read" ? (
                    <CheckCheck className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} aria-label="Прочитано" />
                  ) : deliveryStatus === "delivered" ? (
                    <CheckCheck className="h-3.5 w-3.5 shrink-0 text-muted/55" strokeWidth={2.4} aria-label="Доставлено" />
                  ) : (
                    <Check className="h-3.5 w-3.5 shrink-0 text-muted/50" strokeWidth={2.4} aria-label="Отправлено" />
                  )
                ) : null}
                <p className={`min-w-0 flex-1 truncate text-[13.5px] leading-snug ${hasUnread ? "font-medium text-foreground/78" : "text-muted/70"}`}>
                  {previewNode}
                </p>
              </div>
              {pinned && !hasUnread ? (
                <Pin className="h-4 w-4 shrink-0 rotate-45 text-muted/40" />
              ) : null}
              {hasUnread ? (
                <span className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-none tabular-nums text-white ${muted ? "bg-muted/50" : "bg-primary"}`}>
                  {chat.unreadCount}
                </span>
              ) : null}
            </div>
          </div>
        </Link>
      </div>
    </div>
  );
});
