"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect } from "react";
import { useAudioCall } from "../../calls/CallProvider";
import { normalizeAvatarUrl } from "@/lib/media-url";

export function ChatHeader({
  chatId,
  chatType,
  title,
  subtitle,
  avatarUrl,
  isConnected,
  partnerId,
}: {
  chatId: string;
  chatType: string;
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  onAppearanceClick?: () => void;
  isConnected: boolean;
  currentUser: { displayName: string; avatarUrl: string | null };
  partnerId?: string;
  onSearchClick?: () => void;
}) {
  const router = useRouter();
  const { startCall, status } = useAudioCall();
  const canCall = chatType === "DIRECT" && typeof navigator !== "undefined" && !!navigator.mediaDevices;
  const handleBackToChats = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (window.history.length > 1) {
      router.back();
      return;
    }

    router.push("/chats");
  };

  const isGroup = chatType === "GROUP";

  const handleHeaderClick = () => {
    if (isGroup) {
      router.push(`/chats/${chatId}/group-profile`);
    } else if (chatType === "DIRECT" && partnerId) {
      router.push(`/chats/${chatId}/profile`);
    }
  };

  useEffect(() => {
    router.prefetch("/chats");
    if (chatType === "DIRECT" && partnerId) {
      router.prefetch(`/chats/${chatId}/profile`);
    }
    if (isGroup) {
      router.prefetch(`/chats/${chatId}/group-profile`);
    }
  }, [chatId, chatType, isGroup, partnerId, router]);

  const fullAvatarUrl = normalizeAvatarUrl(avatarUrl);

  const displaySubtitle = isGroup ? subtitle : (subtitle || "Был(а) давно");

  return (
    <header
      className="glass-header flex items-center justify-between border-b px-4 py-3 transition-smooth"
      style={{ backgroundColor: "var(--chat-header-bg)", color: "var(--chat-header-fg)", borderColor: "var(--chat-focus-ring)" }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <button
          type="button"
          onClick={handleBackToChats}
          className="touch-target h-10 w-10 flex shrink-0 items-center justify-center rounded-xl transition-smooth active:scale-90"
          style={{ backgroundColor: "var(--chat-focus-ring)", color: "var(--chat-header-fg)" }}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <div 
          className="flex items-center gap-3 min-w-0 cursor-pointer active:opacity-70 transition-opacity"
          onClick={handleHeaderClick}
        >
          <div className="relative shrink-0">
            {fullAvatarUrl ? (
              <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-white/10 ring-1 ring-black/5 transition-smooth group-active:scale-95 shadow-sm">
                <Image src={fullAvatarUrl} alt={title} fill className="object-cover" />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-xl transition-smooth shadow-sm" style={{ backgroundColor: "var(--bubble-outgoing-bg)", color: "var(--bubble-outgoing-fg)" }}>
                <span className="text-sm font-black uppercase tracking-tighter">{title.substring(0, 1)}</span>
              </div>
            )}
            {!isGroup && isConnected && (
              <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary border-2 border-surface shadow-sm" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-black tracking-tight leading-tight text-[var(--chat-header-fg)]">{title}</h1>
            <p
              className="truncate text-[10px] font-black uppercase tracking-widest"
              style={{ color: !isGroup && displaySubtitle === "в сети" ? "var(--message-read)" : "var(--bubble-incoming-muted)" }}
            >
              {displaySubtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {canCall && (
          <>
            <button
              onClick={() => startCall(chatId, { displayName: title, avatarUrl: avatarUrl ?? null })}
              disabled={status !== "idle"}
              className="touch-target h-10 w-10 flex items-center justify-center rounded-xl transition-smooth active:scale-90 disabled:opacity-30 disabled:grayscale"
              style={{ backgroundColor: "var(--chat-focus-ring)", color: "var(--message-read)" }}
              title="Аудиозвонок"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
            </button>
            <button
              onClick={() => startCall(chatId, { displayName: title, avatarUrl: avatarUrl ?? null }, { video: true })}
              disabled={status !== "idle"}
              className="touch-target h-10 w-10 flex items-center justify-center rounded-xl transition-smooth active:scale-90 disabled:opacity-30 disabled:grayscale"
              style={{ backgroundColor: "var(--chat-focus-ring)", color: "var(--message-read)" }}
              title="Видеозвонок"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 6h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2z" />
              </svg>
            </button>
          </>
        )}
      </div>
    </header>
  );
}
