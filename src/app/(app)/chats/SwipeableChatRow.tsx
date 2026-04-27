"use client";

import Image from "next/image";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import type { ChatListItem } from "@/lib/chat-list";

const ACTIONS_WIDTH = 222;
const SWIPE_OPEN_THRESHOLD = 72;

function formatChatTime(isoDate: string) {
  const date = new Date(isoDate);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 1000 * 60 * 60 * 24;

  if (diff < day && now.getDate() === date.getDate()) {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (diff < day * 7) {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

function getMessagePreview(chat: ChatListItem) {
  const message = chat.lastMessage;
  if (!message) return "Нет сообщений";
  if (message.deletedAt) return "Сообщение удалено";
  if (message.type === "VOICE") return "Голосовое сообщение";
  if (message.body) return message.body;
  if (message.attachments[0]?.fileName) return message.attachments[0].fileName;
  if (message.type === "IMAGE") return "Фото";
  if (message.type === "VIDEO") return "Видео";
  return "Файл";
}

type SwipeableChatRowProps = {
  chat: ChatListItem;
  isOpen: boolean;
  onOpen: (chatId: string | null) => void;
  onNavigate: (chatId: string) => void;
  onPrefetch?: (chatId: string) => void;
  onDelete: (chat: ChatListItem) => void;
  onArchive: (chat: ChatListItem) => void;
  onMute: (chat: ChatListItem) => void;
  isArchiveMode?: boolean;
};

export const SwipeableChatRow = memo(function SwipeableChatRow({
  chat,
  isOpen,
  onOpen,
  onNavigate,
  onPrefetch,
  onDelete,
  onArchive,
  onMute,
  isArchiveMode = false,
}: SwipeableChatRowProps) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startOffsetRef = useRef(0);
  const directionLockedRef = useRef<"horizontal" | "vertical" | null>(null);
  const movedRef = useRef(false);
  const [translateX, setTranslateX] = useState(isOpen ? -ACTIONS_WIDTH : 0);
  const muted = Boolean(chat.mutedUntil && new Date(chat.mutedUntil).getTime() > Date.now());

  useEffect(() => {
    setTranslateX(isOpen ? -ACTIONS_WIDTH : 0);
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
    pointerIdRef.current = event.pointerId;
    startXRef.current = event.clientX;
    startYRef.current = event.clientY;
    startOffsetRef.current = isOpen ? -ACTIONS_WIDTH : 0;
    directionLockedRef.current = null;
    movedRef.current = false;
  }, [chat.id, isOpen, onPrefetch]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - startXRef.current;
    const deltaY = event.clientY - startYRef.current;

    if (!directionLockedRef.current) {
      if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
        directionLockedRef.current = "vertical";
        resetGesture();
        return;
      }
      if (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY)) {
        directionLockedRef.current = "horizontal";
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
    const nextX = Math.max(-ACTIONS_WIDTH, Math.min(0, startOffsetRef.current + deltaX));
    setTranslateX(nextX);
  }, [resetGesture]);

  const finalizeSwipe = useCallback(() => {
    const shouldOpen = Math.abs(translateX) > SWIPE_OPEN_THRESHOLD;
    onOpen(shouldOpen ? chat.id : null);
    setTranslateX(shouldOpen ? -ACTIONS_WIDTH : 0);
    resetGesture();
  }, [chat.id, onOpen, resetGesture, translateX]);

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

    setTranslateX(isOpen ? -ACTIONS_WIDTH : 0);
    resetGesture();
  }, [isOpen, resetGesture]);

  const handleOpenChat = useCallback(() => {
    if (movedRef.current || translateX !== 0) {
      return;
    }
    onNavigate(chat.id);
  }, [chat.id, onNavigate, translateX]);

  const title = chat.type === "DIRECT"
    ? chat.otherMember?.displayName ?? chat.otherMember?.username ?? "Избранное"
    : chat.title ?? "Группа";
  const preview = getMessagePreview(chat);
  
  const avatarToDisplay = chat.type === "GROUP" ? chat.avatarUrl : chat.otherMember?.avatarUrl;
  const fullAvatarUrl = avatarToDisplay
    ? (avatarToDisplay.startsWith("http") ? avatarToDisplay : `/api/avatars/${avatarToDisplay}`)
    : null;

  const actionsVisible = isOpen || translateX < -8;

  return (
    <div ref={rowRef} className="relative isolate overflow-hidden rounded-[2rem]">
      <div
        className="absolute inset-y-0 right-0 z-0 flex items-stretch transition-opacity duration-150"
        style={{ opacity: actionsVisible ? 1 : 0, pointerEvents: actionsVisible ? "auto" : "none" }}
      >
        <button
          type="button"
          onClick={() => onArchive(chat)}
          className="w-[74px] bg-primary/12 text-primary text-[10px] font-black uppercase tracking-widest active:scale-[0.98] fast-tap"
        >
          {isArchiveMode ? "Вернуть" : "Архив"}
        </button>
        <button
          type="button"
          onClick={() => onMute(chat)}
          className="w-[74px] bg-amber-500/14 text-amber-600 dark:text-amber-300 text-[10px] font-black uppercase tracking-widest active:scale-[0.98] fast-tap"
        >
          {muted ? "Тише" : "Без звука"}
        </button>
        <button
          type="button"
          onClick={() => onDelete(chat)}
          className="w-[74px] bg-danger/14 text-danger text-[10px] font-black uppercase tracking-widest active:scale-[0.98] fast-tap"
        >
          Удалить
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
        <button
          type="button"
          onClick={handleOpenChat}
          className="group relative flex w-full items-center gap-4 rounded-[2rem] border border-border-subtle/30 p-4 text-left transition-[transform,background-color,border-color] duration-150 hover:bg-surface-hover active:scale-[0.99] active:bg-surface-muted/50"
          style={{ backgroundColor: "var(--glass-bg-strong)" }}
        >
          <div className="relative flex h-15 w-15 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border-subtle/30 bg-surface-muted shadow-sm transition-smooth group-hover:scale-105">
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt={title} fill className="object-cover" />
            ) : (
              <span className="text-2xl font-black uppercase text-primary">{title[0]}</span>
            )}
          </div>
          <div className="min-w-0 flex-1 border-b border-border-subtle/20 pb-4 group-last:border-none">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <p className={`truncate text-base font-black tracking-tight ${chat.unreadCount > 0 ? "text-foreground" : "text-foreground/80"}`}>{title}</p>
                {muted ? (
                  <span className="shrink-0 text-[11px] text-muted/70">🔕</span>
                ) : null}
              </div>
              <span className="shrink-0 text-[10px] font-black uppercase tracking-tighter text-muted/50">
                {formatChatTime(chat.lastMessage?.createdAt ?? chat.createdAt)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className={`truncate text-sm leading-snug font-medium ${chat.unreadCount > 0 ? "font-black text-foreground/70" : "text-muted/60"}`}>
                {preview}
              </p>
              {chat.unreadCount > 0 ? (
                <span className="flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-primary px-2 text-[10px] font-black text-white shadow-lg shadow-primary/30">
                  {chat.unreadCount}
                </span>
              ) : null}
            </div>
          </div>
        </button>
      </div>
    </div>
  );
});
