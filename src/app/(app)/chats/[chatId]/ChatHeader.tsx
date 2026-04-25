"use client";

import Link from "next/link";
import Image from "next/image";

import { useAudioCall } from "../../calls/CallProvider";

export function ChatHeader({
  chatId,
  chatType,
  title,
  subtitle,
  avatarUrl,
  onAppearanceClick,
  isConnected,
}: {
  chatId: string;
  chatType: string;
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  onAppearanceClick: () => void;
  isConnected: boolean;
}) {
  const { startCall, status } = useAudioCall();
  const canCall = chatType === "DIRECT" && typeof navigator !== "undefined" && !!navigator.mediaDevices;

  return (
    <header className="glass-header safe-top flex items-center justify-between px-4 py-3 transition-smooth border-b border-white/5">
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <Link 
          href="/chats" 
          className="touch-target h-10 w-10 flex shrink-0 items-center justify-center rounded-full bg-neutral-900/50 text-white transition-smooth active:scale-90 hover:bg-neutral-800"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <div className="relative h-10 w-10 overflow-hidden rounded-full ring-1 ring-white/10 transition-smooth group-active:scale-95">
                <Image src={avatarUrl} alt={title} fill className="object-cover" />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary ring-1 ring-primary/30 transition-smooth">
                <span className="text-sm font-bold uppercase">{title.substring(0, 1)}</span>
              </div>
            )}
            {isConnected && (
              <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-primary border-2 border-background shadow-sm" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight text-white leading-tight">{title}</h1>
            <p className="truncate text-[10px] font-bold uppercase tracking-widest text-primary/80">
              {subtitle || (isConnected ? "в сети" : "подключение...")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        {canCall && (
          <button
            onClick={() => startCall(chatId)}
            disabled={status !== "idle"}
            className="touch-target h-10 w-10 flex items-center justify-center rounded-full bg-primary/10 text-primary transition-smooth active:scale-90 hover:bg-primary/20 disabled:opacity-30 disabled:grayscale"
            title="Позвонить"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
          </button>
        )}

        <button
          onClick={onAppearanceClick}
          className="touch-target h-10 w-10 flex items-center justify-center rounded-full bg-neutral-900/50 text-white transition-smooth active:scale-90 hover:bg-neutral-800"
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
