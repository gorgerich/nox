"use client";

import Link from "next/link";
import Image from "next/image";

export function ChatHeader({
  title,
  subtitle,
  avatarUrl,
  onAppearanceClick,
  isConnected,
}: {
  title: string;
  subtitle?: string | null;
  avatarUrl?: string | null;
  onAppearanceClick: () => void;
  isConnected: boolean;
}) {
  return (
    <header className="glass-header flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3">
        <Link 
          href="/chats" 
          className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900/50 text-white transition-all active:scale-90 hover:bg-neutral-800"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <div className="relative h-10 w-10 overflow-hidden rounded-full ring-1 ring-white/10">
                <Image src={avatarUrl} alt={title} fill className="object-cover" />
              </div>
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary ring-1 ring-primary/30">
                <span className="text-sm font-bold uppercase">{title.substring(0, 1)}</span>
              </div>
            )}
            {isConnected && (
              <div className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-primary border-2 border-background" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight text-white">{title}</h1>
            <p className="truncate text-[10px] font-bold uppercase tracking-widest text-primary">
              {subtitle || (isConnected ? "в сети" : "подключение...")}
            </p>
          </div>
        </div>
      </div>

      <button
        onClick={onAppearanceClick}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-900/50 text-white transition-all active:scale-90 hover:bg-neutral-800"
        title="Оформление"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
        </svg>
      </button>
    </header>
  );
}
