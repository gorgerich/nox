"use client";

import { useEffect, useState } from "react";
import { MessageBubble, type Message } from "../../(app)/chats/[chatId]/MessageBubble";
import { ChatComposer } from "../../(app)/chats/[chatId]/ChatComposer";
import { InlineConnectionNotice, type ConnectionStatus } from "../../(app)/chats/[chatId]/InlineConnectionNotice";
import { DateSeparator, UnreadSeparator, TypingIndicator } from "../../(app)/chats/[chatId]/ConversationMarkers";
import { DEFAULT_APPEARANCE, getChatAppearanceVars } from "../../(app)/chats/[chatId]/ChatAppearance";
import { useTheme } from "@/components/ThemeProvider";
import { startsGroup, endsGroup, needsDateSeparator } from "@/lib/message-grouping";

// Fixtures only — this harness never calls the API or the database.
const ME = "me";
const THEM = "them";
const OTHER = "other";

function make(over: Partial<Message> & { id: string; createdAt: string }): Message {
  return {
    body: null,
    type: "TEXT",
    senderUserId: THEM,
    deletedAt: null,
    editedAt: null,
    replyToMessageId: null,
    deliveredAt: over.createdAt,
    sender: { id: THEM, username: "angelina", profile: { displayName: "Angelina", avatarUrl: null } },
    attachments: [],
    reactions: [],
    replyToMessage: null,
    receipts: [],
    ...over,
  } as Message;
}

const day = (h: number, m: number, dayOffset = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const mine = (over: Partial<Message> & { id: string; createdAt: string }) =>
  make({ senderUserId: ME, sender: { id: ME, username: "me", profile: { displayName: "Я", avatarUrl: null } }, ...over });

const BASE: Message[] = [
  make({ id: "y1", body: "Вчерашнее сообщение", createdAt: day(18, 5, -1) }),
  // Same author, consecutive — should group tightly.
  make({ id: "g1", body: "Привет! Как дела с поездкой?", createdAt: day(10, 0) }),
  make({ id: "g2", body: "Билеты я уже посмотрела", createdAt: day(10, 1) }),
  make({ id: "g3", body: "Осталось выбрать даты", createdAt: day(10, 2) }),
  mine({ id: "m1", body: "Ок", createdAt: day(10, 3), receipts: [{ userId: THEM, deliveredAt: day(10, 3), readAt: day(10, 4) }] }),
  mine({ id: "m2", body: "Давай на следующей неделе", createdAt: day(10, 4), receipts: [{ userId: THEM, deliveredAt: day(10, 4), readAt: null }] }),
  // Large gap — new group even though the author is the same.
  mine({ id: "m3", body: "Ещё раз: не забудь паспорт", createdAt: day(12, 40) }),
  make({
    id: "r1",
    body: "Хорошо, положила",
    createdAt: day(12, 45),
    replyToMessageId: "m3",
    replyToMessage: {
      id: "m3",
      body: "Ещё раз: не забудь паспорт",
      deletedAt: null,
      type: "TEXT",
      sender: { username: "me", profile: { displayName: "Я" } },
    },
  }),
  make({
    id: "react1",
    body: "И билеты распечатала",
    createdAt: day(12, 46),
    reactions: [
      { emoji: "🔥", userId: ME, user: { id: ME, username: "me", profile: { displayName: "Я" } } },
      { emoji: "👍", userId: OTHER, user: { id: OTHER, username: "kate", profile: { displayName: "Катя" } } },
    ],
  }),
  make({
    id: "f1",
    type: "FILE",
    createdAt: day(12, 47),
    attachments: [{ id: "a1", fileName: "Договор-аренды-2026-длинное-имя.pdf", mimeType: "application/pdf", sizeBytes: 284_119 }],
  }),
  make({ id: "del1", body: null, deletedAt: day(12, 48), createdAt: day(12, 48) }),
  mine({ id: "s1", body: "Отправляется прямо сейчас", createdAt: day(12, 50) }),
  mine({ id: "temp-failed", body: "Это сообщение не ушло", createdAt: day(12, 51) }),
];

type Scenario =
  | "grouped"
  | "unread"
  | "typing"
  | "offline"
  | "reconnecting"
  | "pagination"
  | "recording"
  | "empty";

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "grouped", label: "Группировка" },
  { id: "unread", label: "Непрочитанные" },
  { id: "typing", label: "Печатает" },
  { id: "offline", label: "Оффлайн" },
  { id: "reconnecting", label: "Переподключение" },
  { id: "pagination", label: "Пагинация" },
  { id: "recording", label: "Запись" },
  { id: "empty", label: "Пустой чат" },
];




export function DialogPreviewClient() {
  const [scenario, setScenario] = useState<Scenario>("grouped");
  // Mirror production: the appearance resolver receives the app's resolved
  // scheme. ?wallpaper= exercises the dark-artwork-under-light-app case.
  const { effectiveTheme } = useTheme();
  // Read the query after mount: doing it during render would be a hydration
  // hazard and the server markup would win.
  const [wallpaper, setWallpaper] = useState<string | null>(null);
  useEffect(() => {
    setWallpaper(new URLSearchParams(window.location.search).get("wallpaper"));
  }, []);
  const settings = wallpaper ? { ...DEFAULT_APPEARANCE, wallpaper: wallpaper as typeof DEFAULT_APPEARANCE.wallpaper } : DEFAULT_APPEARANCE;
  const vars = getChatAppearanceVars(settings, effectiveTheme) as React.CSSProperties;

  const messages = scenario === "empty" ? [] : BASE;
  const unreadFromId = scenario === "unread" ? "r1" : null;

  const connection: ConnectionStatus =
    scenario === "offline" ? "offline" : scenario === "reconnecting" ? "reconnecting" : "online";

  return (
    <div className="flex h-[100dvh] flex-col" style={vars}>
      <header
        className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5"
        style={{ background: "var(--chat-header-bg)", borderColor: "var(--separator)" }}
      >
        <div className="h-10 w-10 shrink-0 rounded-full bg-accent-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1rem] font-semibold" style={{ color: "var(--chat-header-fg)" }}>
            Екатерина Александровна Комиссарова
          </p>
          <p className="truncate text-[0.8125rem]" style={{ color: "var(--bubble-incoming-muted)" }}>
            {scenario === "typing" ? "печатает…" : "в сети"}
          </p>
        </div>
      </header>

      <div className="flex w-full min-w-0 shrink-0 gap-1.5 overflow-x-auto px-3 py-2" style={{ borderBottom: "1px solid var(--separator)" }}>
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setScenario(s.id)}
            className={`nox-filter-chip ${scenario === s.id ? "nox-filter-chip-active" : ""}`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <InlineConnectionNotice status={connection} />

      <div className="flex-1 overflow-y-auto px-3 py-2" style={{ background: "var(--chat-bg)" }}>
        <div className="mx-auto flex w-full max-w-3xl flex-col">
          {scenario === "pagination" && (
            <div className="flex items-center justify-center gap-2 py-3 text-[0.8125rem] font-medium" style={{ color: "var(--text-secondary)" }}>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" aria-hidden="true" />
              Загружаем предыдущие сообщения…
            </div>
          )}

          {messages.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center py-16 text-center">
              <p className="text-[1.0625rem] font-semibold text-foreground">Пока нет сообщений</p>
              <p className="mt-1 text-[0.875rem] text-muted">Напишите первым — сообщения шифруютсяend-to-end.</p>
            </div>
          )}

          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            return (
              <div key={m.id}>
                {needsDateSeparator(m, prev) && <DateSeparator date={new Date(m.createdAt)} />}
                {unreadFromId === m.id && <UnreadSeparator count={4} />}
                <MessageBubble
                  message={m}
                  mine={m.senderUserId === ME}
                  settings={DEFAULT_APPEARANCE}
                  onLongPress={() => {}}
                  onReaction={() => {}}
                  onMediaClick={() => {}}
                  isGroupStart={startsGroup(m, prev)}
                  isGroupEnd={endsGroup(m, next)}
                  showDisplayName={false}
                  selectionMode={false}
                  isSelected={false}
                  onSelect={() => {}}
                  isFocused={false}
                  currentUserId={ME}
                  isFailed={m.id === "temp-failed"}
                  onRetry={() => {}}
                />
              </div>
            );
          })}

          {scenario === "typing" && <TypingIndicator names={["Angelina"]} />}
        </div>
      </div>

      <ChatComposer
        chatId="preview"
        onSend={async () => {}}
        onTyping={() => {}}
        onVoiceStart={() => {}}
        onVoiceStop={() => {}}
        onVoiceCancel={() => {}}
        isRecording={scenario === "recording"}
        recordingDuration={scenario === "recording" ? 27 : 0}
        isLocked={false}
        pending={false}
        replyingTo={null}
        editingTo={null}
        onCancelAction={() => {}}
      />

    </div>
  );
}
