"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAudioCall } from "../../calls/CallProvider";
import { useSocket } from "@/hooks/useSocket";

export function ChatHeader({
  chatId,
  chatType,
  title,
  subtitle,
  avatarUrl,
  onAppearanceClick,
  isConnected,
  currentUser,
  partnerId,
}: {
  chatId: string;
  chatType: string;
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  onAppearanceClick: () => void;
  isConnected: boolean;
  currentUser: { displayName: string; avatarUrl: string | null };
  partnerId?: string;
}) {
  const router = useRouter();
  const { startCall, status } = useAudioCall();
  const { socket } = useSocket();
  const [onlineStatus, setOnlineStatus] = useState<string | null>(null);
  const canCall = chatType === "DIRECT" && typeof navigator !== "undefined" && !!navigator.mediaDevices;

  useEffect(() => {
    if (!socket || !partnerId || chatType !== "DIRECT") return;

    const handlePresence = ({ userId, status }: { userId: string, status: string }) => {
      if (userId === partnerId) {
        setOnlineStatus(status === "online" ? "в сети" : "был(а) недавно");
      }
    };
    socket.on("presence:update", handlePresence);
    return () => { socket.off("presence:update", handlePresence); };
  }, [socket, partnerId, chatType]);

  const fullAvatarUrl = avatarUrl 
    ? (avatarUrl.startsWith('http') ? avatarUrl : `/api/avatars/${avatarUrl}`)
    : null;

  const displaySubtitle = onlineStatus || subtitle || (isConnected ? "в сети" : "подключение...");

  return (
    <header
      className="glass-header flex items-center justify-between border-b px-4 py-3 transition-smooth"
      style={{ backgroundColor: "var(--chat-header-bg)", color: "var(--chat-header-fg)", borderColor: "var(--chat-focus-ring)" }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Link 
          href="/chats" 
          className="touch-target h-10 w-10 flex shrink-0 items-center justify-center rounded-xl transition-smooth active:scale-90"
          style={{ backgroundColor: "var(--chat-focus-ring)", color: "var(--chat-header-fg)" }}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        
        <div 
          className="flex items-center gap-3 min-w-0 cursor-pointer active:opacity-70 transition-opacity"
          onClick={() => chatType === "DIRECT" && router.push(`/chats/${chatId}/profile`)}
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
            {isConnected && (
              <div className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary border-2 border-surface shadow-sm" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-black tracking-tight leading-tight text-[var(--chat-header-fg)]">{title}</h1>
            <p
              className="truncate text-[10px] font-black uppercase tracking-widest"
              style={{ color: displaySubtitle === "в сети" ? "var(--message-read)" : "var(--bubble-incoming-muted)" }}
            >
              {displaySubtitle}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {canCall && (
          <button
            onClick={() => startCall(chatId, currentUser)}
            disabled={status !== "idle"}
            className="touch-target h-10 w-10 flex items-center justify-center rounded-xl transition-smooth active:scale-90 disabled:opacity-30 disabled:grayscale"
            style={{ backgroundColor: "var(--chat-focus-ring)", color: "var(--message-read)" }}
            title="Позвонить"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </button>
        )}

        <button
          onClick={onAppearanceClick}
          className="touch-target h-10 w-10 flex items-center justify-center rounded-xl transition-smooth active:scale-90"
          style={{ backgroundColor: "var(--chat-focus-ring)", color: "var(--chat-header-fg)" }}
          title="Оформление"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        </button>
      </div>
    </header>
  );
}
