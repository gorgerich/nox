"use client";

// Instant chat-open frame.
//
// On a repeat open in the same session we have a RAM preview (header + last
// messages) from chat-cache.ts, so we paint the real conversation immediately
// while the server component streams the fresh, interactive page — the Telegram
// "instant open" feel. With no cache (first open / after reload) we fall back to
// a neutral skeleton.

import { usePathname } from "next/navigation";
import Image from "next/image";
import { chatIdFromPath, getChatCache } from "@/lib/chat-cache";
import { normalizeAvatarUrl } from "@/lib/media-url";

const SKELETON_BUBBLES: { side: "left" | "right"; w: string }[] = [
  { side: "left", w: "58%" },
  { side: "right", w: "42%" },
  { side: "left", w: "72%" },
  { side: "right", w: "35%" },
  { side: "left", w: "50%" },
  { side: "right", w: "64%" },
  { side: "left", w: "44%" },
];

export default function ChatLoading() {
  const pathname = usePathname();
  const chatId = chatIdFromPath(pathname);
  const cache = chatId ? getChatCache(chatId) : null;
  const header = cache?.header ?? null;
  const preview = cache?.preview ?? [];
  const hasPreview = preview.length > 0;

  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Открытие чата">
      {/* Header */}
      <div className="glass-header flex items-center gap-3 px-3 py-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted">
          {header && normalizeAvatarUrl(header.avatarUrl) ? (
            <Image src={normalizeAvatarUrl(header.avatarUrl) || ""} alt="" fill className="object-cover" />
          ) : header?.title ? (
            <span className="text-lg font-semibold uppercase text-primary">{header.title[0]}</span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          {header?.title ? (
            <p className="truncate text-[16px] font-semibold text-foreground">{header.title}</p>
          ) : (
            <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/70 animate-pulse" />
          )}
          <div className="mt-1 h-2.5 w-1/4 rounded-full bg-surface-muted/50 animate-pulse" />
        </div>
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70" />
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col justify-end overflow-hidden px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {hasPreview
            ? preview.map((msg) => (
                <div key={msg.id} className={`flex ${msg.mine ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[78%] truncate rounded-2xl px-3.5 py-2 text-[15px] ${
                      msg.mine
                        ? "bg-primary text-white"
                        : "bg-surface-muted text-foreground"
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))
            : SKELETON_BUBBLES.map((bubble, index) => (
                <div key={index} className={`flex ${bubble.side === "right" ? "justify-end" : "justify-start"}`}>
                  <div
                    className="h-10 rounded-2xl bg-surface-muted/60 animate-pulse"
                    style={{ width: bubble.w, animationDelay: `${index * 70}ms` }}
                  />
                </div>
              ))}
        </div>
      </div>

      {/* Composer */}
      <div className="glass-composer flex items-center gap-3 px-3 py-3">
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="h-11 flex-1 rounded-3xl bg-surface-muted/60" />
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70" />
      </div>
    </div>
  );
}
