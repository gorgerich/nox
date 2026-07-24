"use client";

import { useState } from "react";
import { MessageBubble, type Message } from "../../(app)/chats/[chatId]/MessageBubble";
import { ChatComposer } from "../../(app)/chats/[chatId]/ChatComposer";
import { DEFAULT_APPEARANCE, getChatAppearanceVars } from "../../(app)/chats/[chatId]/ChatAppearance";

// Fixtures only. Nothing here calls the API or the database.
const ME = "me";
const THEM = "them";

function make(over: Partial<Message> & { id: string }): Message {
  return {
    body: null,
    type: "TEXT",
    senderUserId: THEM,
    deletedAt: null,
    editedAt: null,
    replyToMessageId: null,
    deliveredAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    sender: { id: THEM, username: "angelina", profile: { displayName: "Angelina", avatarUrl: null } },
    attachments: [],
    reactions: [],
    replyToMessage: null,
    receipts: [],
    ...over,
  } as Message;
}

const mine = (over: Partial<Message> & { id: string }) =>
  make({ senderUserId: ME, sender: { id: ME, username: "me", profile: { displayName: "Я", avatarUrl: null } }, ...over });

const MESSAGES: Message[] = [
  make({ id: "1", body: "Привет! Как дела с поездкой?" }),
  mine({ id: "2", body: "Ок", receipts: [{ userId: THEM, deliveredAt: new Date().toISOString(), readAt: new Date().toISOString() }] }),
  mine({
    id: "3",
    body: "Длинное сообщение на русском, чтобы проверить перенос строк, межстрочный интервал и максимальную ширину пузыря на узком экране.",
    receipts: [{ userId: THEM, deliveredAt: new Date().toISOString(), readAt: null }],
  }),
  make({
    id: "4",
    body: "Отвечаю на твоё сообщение",
    replyToMessageId: "3",
    replyToMessage: {
      id: "3",
      body: "Длинное сообщение на русском, чтобы проверить перенос строк…",
      deletedAt: null,
      type: "TEXT",
      sender: { username: "me", profile: { displayName: "Я" } },
    },
  }),
  make({
    id: "5",
    body: "С реакциями",
    reactions: [
      { emoji: "🔥", userId: ME, user: { id: ME, username: "me", profile: { displayName: "Я" } } },
      { emoji: "👍", userId: THEM, user: { id: THEM, username: "angelina", profile: { displayName: "Angelina" } } },
    ],
  }),
  make({
    id: "6",
    type: "FILE",
    body: null,
    attachments: [{ id: "a1", fileName: "Договор-аренды-2026.pdf", mimeType: "application/pdf", sizeBytes: 284_119 }],
  }),
  mine({ id: "7", body: "Отправляется прямо сейчас" }),
  mine({ id: "temp-failed", body: "Это сообщение не ушло" }),
];

const SCENARIOS = ["Обычный", "Ответ", "Изменение"] as const;

export function DialogPreviewClient() {
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]>("Обычный");
  const vars = getChatAppearanceVars(DEFAULT_APPEARANCE) as React.CSSProperties;

  const replyingTo =
    scenario === "Ответ"
      ? { id: "3", body: "Длинное сообщение на русском, чтобы проверить перенос строк…", sender: { profile: { displayName: "Я" }, username: "me" } }
      : null;
  const editingTo = scenario === "Изменение" ? { id: "2", body: "Ок" } : null;

  return (
    <div className="flex h-[100dvh] flex-col" style={vars}>
      <header
        className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
        style={{ background: "var(--chat-header-bg)", borderColor: "var(--separator)" }}
      >
        <div className="h-10 w-10 shrink-0 rounded-full bg-accent-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-semibold" style={{ color: "var(--chat-header-fg)" }}>
            Екатерина Александровна Комиссарова
          </p>
          <p className="truncate text-[13px]" style={{ color: "var(--bubble-incoming-muted)" }}>
            в сети
          </p>
        </div>
        <div className="flex min-w-0 shrink gap-1 overflow-x-auto">
          {SCENARIOS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScenario(s)}
              className={`nox-filter-chip ${scenario === s ? "nox-filter-chip-active" : ""}`}
            >
              {s}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-3" style={{ background: "var(--chat-bg)" }}>
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          <div className="my-3 flex justify-center">
            <span
              className="rounded-full px-3 py-1 text-[12px] font-semibold"
              style={{ background: "var(--chat-date-bg)", color: "var(--chat-date-fg)" }}
            >
              Сегодня
            </span>
          </div>

          {MESSAGES.map((m, i) => (
            <MessageBubble
              key={m.id}
              message={m}
              mine={m.senderUserId === ME}
              settings={DEFAULT_APPEARANCE}
              onLongPress={() => {}}
              onReaction={() => {}}
              onMediaClick={() => {}}
              isGroupStart={i === 0 || MESSAGES[i - 1].senderUserId !== m.senderUserId}
              isGroupEnd={i === MESSAGES.length - 1 || MESSAGES[i + 1].senderUserId !== m.senderUserId}
              showDisplayName={false}
              selectionMode={false}
              isSelected={false}
              onSelect={() => {}}
              isFocused={false}
              currentUserId={ME}
              isFailed={m.id === "temp-failed"}
              onRetry={() => {}}
            />
          ))}
        </div>
      </div>

      <ChatComposer
        chatId="preview"
        onSend={async () => {}}
        onTyping={() => {}}
        onVoiceStart={() => {}}
        onVoiceStop={() => {}}
        onVoiceCancel={() => {}}
        isRecording={false}
        recordingDuration={0}
        isLocked={false}
        pending={false}
        replyingTo={replyingTo}
        editingTo={editingTo}
        onCancelAction={() => setScenario("Обычный")}
      />
    </div>
  );
}
