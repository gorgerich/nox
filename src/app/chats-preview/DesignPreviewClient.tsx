"use client";

import { useState } from "react";
import type { ChatListItem } from "@/lib/chat-list";
import { SwipeableChatRow } from "../(app)/chats/SwipeableChatRow";
import { AppBottomDock } from "../(app)/AppBottomDock";

// Fixture data only — nothing here touches the database.
function makeChat(over: Partial<ChatListItem> & { id: string; title: string }): ChatListItem {
  const now = new Date().toISOString();
  return {
    type: "DIRECT",
    avatarUrl: null,
    createdAt: now,
    updatedAt: now,
    unreadCount: 0,
    mutedUntil: null,
    pinnedAt: null,
    archivedAt: null,
    deletedAt: null,
    isSelfChat: false,
    otherMember: {
      id: `u-${over.id}`,
      username: over.title.toLowerCase(),
      displayName: over.title,
      avatarUrl: null,
    },
    lastMessage: null,
    ...over,
  } as ChatListItem;
}

function msg(body: string, opts: Partial<NonNullable<ChatListItem["lastMessage"]>> = {}) {
  return {
    id: `m-${body.slice(0, 6)}`,
    type: "TEXT" as const,
    body,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    attachments: [],
    sender: { id: "s1", username: "sender", displayName: "Отправитель" },
    ...opts,
  };
}

const CHATS: ChatListItem[] = [
  makeChat({
    id: "1",
    title: "Избранное",
    isSelfChat: true,
    pinnedAt: new Date().toISOString(),
    lastMessage: msg("Напомнить: забрать билеты на концерт в субботу", { isMine: true, deliveryStatus: "read" }),
  }),
  makeChat({
    id: "2",
    title: "Sergey Shavikov",
    lastMessage: msg("Не знаю. Опять звучит как наезд на тебя, но каждый говорит о том, что болит", { isMine: true, deliveryStatus: "read" }),
  }),
  makeChat({
    id: "3",
    title: "Alexandr Schefer",
    unreadCount: 1,
    lastMessage: msg("Аа, понятненько))"),
  }),
  makeChat({
    id: "4",
    title: "богатое королевство",
    type: "GROUP",
    unreadCount: 3,
    lastMessage: msg("А то что думала насчёт поездки?", {
      sender: { id: "s2", username: "angelina", displayName: "Angelina Khamalian" },
    }),
  }),
  makeChat({ id: "5", title: "Sergey Sherbakov", lastMessage: msg("Ок") }),
  makeChat({ id: "6", title: "Angelina Khamalian", lastMessage: msg("Хех") }),
  makeChat({
    id: "7",
    title: "Save As Bot",
    mutedUntil: new Date(Date.now() + 8.64e7).toISOString(),
    unreadCount: 1,
    lastMessage: msg("Заберите бонус до 23:59"),
  }),
  makeChat({
    id: "8",
    title: "Max Kucherov",
    lastMessage: msg("Так печатать да можно, но редактировать и на один лист добавить несколько фоток нет", { isMine: true, deliveryStatus: "delivered" }),
  }),
];

const FOLDERS = [
  { id: "all", label: "Все", count: 8 },
  { id: "family", label: "Семейное", count: 3 },
  { id: "work", label: "Работа", count: 4 },
  { id: "friends", label: "Друзья", count: 2 },
  { id: "archive", label: "Архив", count: 0 },
];

export function DesignPreviewClient() {
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [folder, setFolder] = useState("all");

  return (
    <div className="app-section">
      <header className="app-section-header">
        <h1 className="app-section-title">Чаты</h1>
      </header>

      <div className="nox-filter-strip" data-nox-horizontal-scroll="true">
        {FOLDERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFolder(item.id)}
            className={`nox-filter-chip ${folder === item.id ? "nox-filter-chip-active" : ""}`}
            aria-pressed={folder === item.id}
          >
            {item.label}
            {item.count > 0 ? <span className="nox-filter-chip-count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div>
        {CHATS.map((chat) => (
          <SwipeableChatRow
            key={chat.id}
            chat={chat}
            isOpen={openRowId === chat.id}
            onOpen={setOpenRowId}
            onNavigate={() => {}}
            onDelete={() => {}}
            onArchive={() => {}}
            onMute={() => {}}
            onPin={() => {}}
          />
        ))}
      </div>

      <AppBottomDock incomingRequestCount={2} avatarUrl={null} />
    </div>
  );
}
