"use client";

// Instant Chats-tab frame.
//
// On a repeat open we have the last list in RAM (chat-cache.ts) and paint the
// real rows immediately while the server re-renders the fresh list. With no
// cache (first open / after reload) we fall back to skeleton rows.

import Image from "next/image";
import { Bookmark, Check, CheckCheck } from "lucide-react";
import { getChatList } from "@/lib/chat-cache";
import { getMessagePreview, getSenderPrefix } from "@/lib/chat-list-format";
import { LocalTime } from "@/lib/time-format";
import { normalizeAvatarUrl } from "@/lib/media-url";

const SKELETON_ROWS = Array.from({ length: 9 });

export default function ChatsLoading() {
  const chats = getChatList();
  const hasChats = !!chats && chats.length > 0;

  return (
    <div className="app-section" aria-busy="true" aria-label="Загрузка чатов">
      <div className="nox-page-header !mb-3">
        <h1 className="nox-page-title">Чаты</h1>
        <div className="h-10 w-10 rounded-full bg-surface-muted/70" />
      </div>

      <div className="mb-3 -mx-1 flex gap-1 overflow-hidden px-1 pb-1">
        <div className="h-8 w-16 rounded-full bg-primary/10" />
        <div className="h-8 w-20 rounded-full bg-surface-muted/60" />
        <div className="h-8 w-20 rounded-full bg-surface-muted/60" />
        <div className="h-8 w-28 rounded-full bg-surface-muted/60" />
      </div>

      <div className="-mx-5">
        {hasChats
          ? chats.map((chat) => {
              const title = chat.isSelfChat
                ? "Личное"
                : chat.type === "DIRECT"
                  ? chat.otherMember?.displayName ?? chat.otherMember?.username ?? "Личное"
                  : chat.title ?? "Группа";
              // Same shape as the live row, so the cached frame and the real
              // list do not visibly differ for the instant both exist.
              const senderPrefix = chat.isSelfChat ? null : getSenderPrefix(chat);
              const preview = chat.isSelfChat ? "Сообщения самому себе" : getMessagePreview(chat);
              const showTicks = Boolean(chat.lastMessage?.isMine && !chat.lastMessage.deletedAt);
              const deliveryStatus = chat.lastMessage?.deliveryStatus
                ?? (chat.lastMessage?.readAt ? "read" : chat.lastMessage?.deliveredAt ? "delivered" : "sent");
              const avatarToDisplay = chat.type === "GROUP" ? chat.avatarUrl : chat.otherMember?.avatarUrl;
              const fullAvatarUrl = normalizeAvatarUrl(avatarToDisplay);
              return (
                <div key={chat.id} className="flex items-center gap-3 px-3 py-2">
                <div className="relative flex h-[50px] w-[50px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted">
                    {chat.isSelfChat ? (
                      <div className="flex h-full w-full items-center justify-center bg-primary/15 text-primary">
                        <Bookmark className="h-6 w-6" />
                      </div>
                    ) : fullAvatarUrl ? (
                      <Image src={fullAvatarUrl} alt={title} fill className="object-cover" />
                    ) : (
                      <span className="text-xl font-semibold uppercase text-primary">{title[0]}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 self-stretch border-b border-border-subtle/40 py-1.5">
                    <div className="mb-0.5 flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-[16px] font-semibold text-foreground">{title}</p>
                      <LocalTime
                        value={chat.lastMessage?.createdAt ?? chat.createdAt}
                        kind="chatListStamp"
                        className="shrink-0 text-[13px] tabular-nums text-muted/60"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      {showTicks ? (
                        deliveryStatus === "read" ? (
                          <CheckCheck className="h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2.5} />
                        ) : deliveryStatus === "delivered" ? (
                          <CheckCheck className="h-3.5 w-3.5 shrink-0 text-muted/55" strokeWidth={2.4} />
                        ) : (
                          <Check className="h-3.5 w-3.5 shrink-0 text-muted/50" strokeWidth={2.4} />
                        )
                      ) : null}
                      <p className={`min-w-0 flex-1 truncate text-[14px] leading-snug ${chat.unreadCount > 0 ? "text-foreground/70" : "text-muted/70"}`}>
                        {senderPrefix ? <span className="chat-preview-sender">{senderPrefix}: </span> : null}
                        {preview}
                      </p>
                      {chat.unreadCount > 0 ? (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[12px] font-semibold text-white">
                          {chat.unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          : SKELETON_ROWS.map((_, index) => (
              <div key={index} className="flex items-center gap-3 px-3 py-2">
                <div className="h-[50px] w-[50px] shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
                <div className="min-w-0 flex-1 border-b border-border-subtle/40 py-1.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/70 animate-pulse" />
                    <div className="h-2.5 w-10 rounded-full bg-surface-muted/50 animate-pulse" />
                  </div>
                  <div
                    className="h-3 rounded-full bg-surface-muted/50 animate-pulse"
                    style={{ width: `${55 + ((index * 7) % 35)}%` }}
                  />
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}
