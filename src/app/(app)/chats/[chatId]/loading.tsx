"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { avatarTint } from "@/lib/avatar-tint";
import { chatIdFromPath, getChatCache, getChatList } from "@/lib/chat-cache";
import { normalizeAvatarUrl } from "@/lib/media-url";

export default function ChatLoading() {
  const pathname = usePathname();
  const chatId = chatIdFromPath(pathname);
  const entry = chatId ? getChatCache(chatId) : null;
  const listItem = chatId ? getChatList()?.find((chat) => chat.id === chatId) : null;
  const title = entry?.header?.title ?? (
    listItem?.isSelfChat
      ? "Личное"
      : listItem?.type === "GROUP"
        ? listItem.title ?? "Группа"
        : listItem?.otherMember?.displayName ?? listItem?.otherMember?.username ?? "Чат"
  );
  const avatarUrl = normalizeAvatarUrl(
    entry?.header?.avatarUrl ?? (listItem?.type === "GROUP" ? listItem.avatarUrl : listItem?.otherMember?.avatarUrl) ?? null,
  );
  const preview = entry?.preview.slice(-8) ?? [];

  return (
    <div className="chat-screen" aria-busy="true" aria-label={`Открывается чат ${title}`}>
      <header className="nox-chat-topbar pt-[env(safe-area-inset-top,0px)]">
        <div className="nox-chat-topbar-inner min-h-[3.35rem]">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center text-primary" aria-hidden="true">
            <svg className="h-[1.35rem] w-[1.35rem]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M15 19l-7-7 7-7" />
            </svg>
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="nox-avatar-tint relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full" data-avatar-tint={avatarTint(title)}>
              {avatarUrl ? <Image src={avatarUrl} alt="" fill sizes="36px" className="object-cover" /> : <span className="text-sm font-semibold">{title[0]?.toUpperCase()}</span>}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[0.9375rem] font-semibold text-foreground">{title}</p>
              <p className="truncate text-[0.6875rem] text-muted">Открываем диалог</p>
            </div>
          </div>
          <div className="h-10 w-[6.75rem] shrink-0" />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-2">
        <div className="mx-auto flex h-full max-w-[48rem] flex-col justify-end gap-1.5 py-3">
          {preview.map((message) => (
            <div key={message.id} className={`flex ${message.mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[82%] rounded-[1.125rem] px-3 py-2 text-[0.9375rem] leading-5 ${message.mine ? "bg-primary text-primary-foreground" : "bg-surface text-foreground"}`}>
                {message.text}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-composer-shell mx-auto flex w-full max-w-[48rem] items-center gap-2" aria-hidden="true">
        <div className="h-10 w-10 shrink-0" />
        <div className="h-10 flex-1 rounded-full bg-surface/75" />
        <div className="h-10 w-10 shrink-0" />
      </div>
    </div>
  );
}
