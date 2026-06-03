"use client";

// Instant chat-open frame.
//
// Never paint cached message previews here: stale cached bubbles look like a
// frozen screenshot before the real chat swaps in. This fallback only opens the
// destination chat shell immediately, then the real message list mounts.

import { useParams, usePathname } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, MoreVertical, Phone, Video } from "lucide-react";
import { chatIdFromPath, getChatCache } from "@/lib/chat-cache";
import { normalizeAvatarUrl } from "@/lib/media-url";

export default function ChatLoading() {
  const params = useParams<{ chatId?: string | string[] }>();
  const pathname = usePathname();
  const paramChatId = Array.isArray(params?.chatId) ? params.chatId[0] : params?.chatId;
  const chatId = paramChatId ?? chatIdFromPath(pathname);
  const cache = chatId ? getChatCache(chatId) : null;
  const header = cache?.header ?? null;
  const avatarUrl = header ? normalizeAvatarUrl(header.avatarUrl) : null;

  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Открытие чата">
      {/* Header only. No cached messages, no fake screenshot. */}
      <div className="glass-header flex items-center gap-3 px-3 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-primary">
          <ArrowLeft className="h-5 w-5" strokeWidth={2.4} />
        </div>
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted">
          {avatarUrl ? (
            <Image src={avatarUrl} alt="" fill className="object-cover" />
          ) : header?.title ? (
            <span className="text-base font-semibold uppercase text-primary">{header.title[0]}</span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          {header?.title ? (
            <p className="truncate text-[16px] font-semibold text-foreground">{header.title}</p>
          ) : (
            <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/40" />
          )}
          <div className="mt-1 h-2.5 w-1/4 rounded-full bg-surface-muted/35" />
        </div>
        <div className="-mr-1 flex shrink-0 items-center gap-0 text-primary">
          <div className="flex h-10 w-9 items-center justify-center">
            <Phone className="h-5 w-5" strokeWidth={2.1} />
          </div>
          <div className="flex h-10 w-9 items-center justify-center">
            <Video className="h-5 w-5" strokeWidth={2.1} />
          </div>
          <div className="flex h-10 w-9 items-center justify-center">
            <MoreVertical className="h-5 w-5" strokeWidth={2.2} />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden" />

      {/* Composer placeholder */}
      <div className="glass-composer flex items-center gap-3 px-3 py-3">
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/60" />
        <div className="h-11 flex-1 rounded-3xl bg-surface-muted/50" />
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/60" />
      </div>
    </div>
  );
}
