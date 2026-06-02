"use client";

import Image from "next/image";
import { ArrowLeft, Check, Clock3, MoreVertical, Phone, Video } from "lucide-react";
import { useRouter } from "next/navigation";
import { type MouseEvent, useEffect, useState } from "react";
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
  disappearingSeconds = null,
  onSetDisappearing,
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
  disappearingSeconds?: number | null;
  onSetDisappearing?: (seconds: number | null) => void;
}) {
  const router = useRouter();
  const { startCall, status } = useAudioCall();
  const [timerMenuOpen, setTimerMenuOpen] = useState(false);
  const DISAPPEARING_OPTIONS: { label: string; seconds: number | null }[] = [
    { label: "Выключить", seconds: null },
    { label: "1 час", seconds: 3600 },
    { label: "1 день", seconds: 86400 },
    { label: "1 неделя", seconds: 604800 },
  ];
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
      className="sticky top-0 z-50 flex items-center justify-between border-b px-2 transition-smooth"
      style={{
        backgroundColor: "var(--chat-header-bg)",
        color: "var(--chat-header-fg)",
        borderColor: "var(--border-subtle)",
        minHeight: "calc(3.5rem + env(safe-area-inset-top, 0px))",
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <button
          type="button"
          aria-label="Назад к чатам"
          onClick={handleBackToChats}
          className="touch-target flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2.4} />
        </button>
        
        <button
          type="button"
          aria-label="Открыть профиль чата"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pr-2 text-left transition-opacity active:opacity-70"
          onClick={handleHeaderClick}
        >
          <div className="relative shrink-0">
            {fullAvatarUrl ? (
              <div className="relative h-10 w-10 overflow-hidden rounded-full bg-surface-muted transition-smooth">
                <Image src={fullAvatarUrl} alt={title} fill className="object-cover" />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full transition-smooth" style={{ backgroundColor: "var(--bubble-outgoing-bg)", color: "var(--bubble-outgoing-fg)" }}>
                <span className="text-sm font-semibold">{title.substring(0, 1).toUpperCase()}</span>
              </div>
            )}
            {!isGroup && isConnected && (
              <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[16px] font-semibold leading-tight text-[var(--chat-header-fg)]">{title}</h1>
            <p
              className="truncate text-xs font-normal leading-tight"
              style={{ color: !isGroup && displaySubtitle === "в сети" ? "var(--message-read)" : "var(--bubble-incoming-muted)" }}
            >
              {displaySubtitle}
            </p>
          </div>
        </button>
      </div>

      <div className="-mr-1 flex items-center gap-0">
        {canCall && (
          <>
            <button
              type="button"
              aria-label="Аудиозвонок"
              onClick={() => startCall(chatId, { displayName: title, avatarUrl: avatarUrl ?? null })}
              disabled={status !== "idle"}
              className="touch-target flex h-11 w-10 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-95 disabled:opacity-30 disabled:grayscale"
              title="Аудиозвонок"
            >
              <Phone className="h-5 w-5" strokeWidth={2.1} />
            </button>
            <button
              type="button"
              aria-label="Видеозвонок"
              onClick={() => startCall(chatId, { displayName: title, avatarUrl: avatarUrl ?? null }, { video: true })}
              disabled={status !== "idle"}
              className="touch-target flex h-11 w-10 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-95 disabled:opacity-30 disabled:grayscale"
              title="Видеозвонок"
            >
              <Video className="h-5 w-5" strokeWidth={2.1} />
            </button>
          </>
        )}
        {onSetDisappearing && (
          <div className="relative">
            <button
              type="button"
              aria-label="Ещё"
              onClick={() => setTimerMenuOpen((v) => !v)}
              className="touch-target flex h-11 w-10 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-95"
              title="Ещё"
            >
              <MoreVertical className="h-5 w-5" strokeWidth={2.2} />
            </button>
            {timerMenuOpen && (
              <>
                <div className="fixed inset-0 z-[200]" onClick={() => setTimerMenuOpen(false)} />
                <div className="absolute right-0 top-12 z-[201] w-56 overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated shadow-lg animate-in fade-in zoom-in-95 duration-150">
                  <p className="flex items-center gap-2 px-4 pt-3 pb-1 text-xs font-medium text-muted">
                    <Clock3 className="h-3.5 w-3.5" />
                    Исчезающие сообщения
                  </p>
                  {DISAPPEARING_OPTIONS.map((opt) => {
                    const active = (disappearingSeconds ?? null) === opt.seconds;
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => { onSetDisappearing(opt.seconds); setTimerMenuOpen(false); }}
                        className={`flex w-full items-center justify-between px-4 py-3 text-sm font-medium transition-smooth hover:bg-foreground/5 ${active ? "text-primary" : "text-foreground"}`}
                      >
                        {opt.label}
                        {active ? <Check className="h-4 w-4 text-primary" strokeWidth={2.4} /> : null}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
