import type { ChatListItem } from "./chat-list";

/**
 * What a chat row says, decided in one place.
 *
 * Before this, the row's second line was assembled inline in JSX from three
 * separate helpers, and every end-to-end encrypted chat — which is all of
 * them — collapsed to the same six words. The reason is structural rather
 * than cosmetic: the server nulls `body` for an encrypted message (correctly:
 * it must never hold the plaintext), so the only branch left for the row to
 * take was the "cannot describe this" fallback. The plaintext does exist, on
 * this device, in the local message cache — it simply was never read here.
 *
 * So the presenter takes the decrypted body as an input rather than reaching
 * for it: the lookup is asynchronous and belongs to a hook, the wording is
 * pure and belongs here, and each can be tested without the other.
 *
 * The type answers four separate questions that used to be tangled together:
 * what happened, who did it, what state our own last message is in, and how
 * loudly to say it.
 */

export type PreviewTone =
  /** Ordinary history. */
  | "normal"
  /** Deliberately quieter: nothing has happened here yet. */
  | "muted"
  /** A missed call. Red, and only ever this. */
  | "danger"
  /** Happening right now — a call in progress, someone typing. */
  | "live";

/**
 * A glyph key, resolved to a lucide icon by the row. Deliberately not emoji:
 * the screen already carries colour in the avatars and the accent, and a
 * column of coloured emoji is exactly the visual noise this list is trying to
 * avoid. `null` is the common case — text needs no icon.
 */
export type PreviewIcon =
  | "photo"
  | "video"
  | "voice"
  | "videoNote"
  | "file"
  | "audio"
  | "callIncoming"
  | "callOutgoing"
  | "callMissed"
  | null;

export type PreviewDeliveryState = "sent" | "delivered" | "read";

export type ConversationPreview = {
  /** The event itself, already worded for the reader. */
  text: string;
  icon: PreviewIcon;
  /**
   * "Вы" for our own message, the sender's name in a group. Null everywhere a
   * prefix would be noise or a lie: incoming one-to-one messages, system
   * events, live states, and anything with no message at all.
   */
  prefix: string | null;
  /**
   * Ticks for our own last message. Null when the last event is incoming, or
   * is not a message — a call has no delivery state, and showing one for a
   * transient state would be describing something that isn't there.
   */
  deliveryState: PreviewDeliveryState | null;
  tone: PreviewTone;
  /** The whole row as one phrase, for a screen reader. */
  label: string;
};

/** Seconds → `M:SS`, the form every messenger uses for a clip length. */
export function formatMediaDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Seconds → "12 мин" / "45 сек" / "1 ч 5 мин", for a finished call. */
export function formatCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  if (safe < 60) return `${safe} сек`;
  const minutes = Math.floor(safe / 60);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder > 0 ? `${hours} ч ${remainder} мин` : `${hours} ч`;
}

/**
 * True when this attachment's name is the placeholder the upload path stores
 * for encrypted media rather than a real name.
 *
 * Encrypted attachments deliberately do not carry the original filename to the
 * server — it would leak what the file is. The stored value is a constant, and
 * it was being shown to users verbatim: an encrypted photo's row read
 * "encrypted-file".
 */
function isPlaceholderFileName(fileName: string | null | undefined): boolean {
  if (!fileName) return true;
  const normalised = fileName.trim().toLowerCase();
  return normalised === "" || normalised === "encrypted-file";
}

type LastMessage = NonNullable<ChatListItem["lastMessage"]>;
type LastAttachment = LastMessage["attachments"][number];

function attachmentDuration(attachment: LastAttachment | undefined): number | null {
  const seconds = attachment?.durationSeconds;
  return typeof seconds === "number" && seconds > 0 ? seconds : null;
}

/** What the media in this message is, when the message type alone is too coarse. */
function describeAttachments(message: LastMessage): { text: string; icon: PreviewIcon } | null {
  const attachments = message.attachments ?? [];
  const first = attachments[0];
  if (!first) return null;

  const mime = first.mimeType ?? "";
  const images = attachments.filter((item) => item.mimeType?.startsWith("image/"));
  const videos = attachments.filter((item) => item.mimeType?.startsWith("video/"));

  // Counts come from the attachment rows themselves, so "3 фото" is only ever
  // shown when three really arrived in one event.
  if (images.length > 1 && images.length === attachments.length) {
    return { text: `${images.length} фото`, icon: "photo" };
  }
  if (videos.length > 1 && videos.length === attachments.length) {
    return { text: `${videos.length} видео`, icon: "video" };
  }

  if (mime.startsWith("image/")) return { text: "Фото", icon: "photo" };

  if (mime.startsWith("video/")) {
    const duration = attachmentDuration(first);
    return { text: duration ? `Видео · ${formatMediaDuration(duration)}` : "Видео", icon: "video" };
  }

  if (mime.startsWith("audio/")) {
    // An audio *file* is not a voice message — VOICE is its own message type,
    // handled before this is reached.
    const name = isPlaceholderFileName(first.fileName) ? null : first.fileName;
    return { text: name ? `Аудио · ${name}` : "Аудио", icon: "audio" };
  }

  const name = isPlaceholderFileName(first.fileName) ? null : first.fileName;
  return { text: name ?? "Файл", icon: "file" };
}

/**
 * The sender's name, for a group row only.
 *
 * In a one-to-one conversation the name is already the row's title, so
 * repeating it on the second line spends a third of the width saying nothing.
 */
function senderPrefix(chat: ChatListItem, message: LastMessage, isOwn: boolean): string | null {
  if (isOwn) return "Вы";
  if (chat.type !== "GROUP") return null;
  if (message.type === "SYSTEM") return null;

  const displayName = message.sender?.displayName?.trim();
  if (displayName) return displayName;
  const username = message.sender?.username?.trim();
  if (username) return username;
  // Legacy rows, and members who have since left, can arrive without a usable
  // name. A neutral word beats an id, and beats "undefined" by a mile.
  return "Участник";
}

function toLabel(parts: {
  prefix: string | null;
  text: string;
  deliveryState: PreviewDeliveryState | null;
  unreadCount: number;
}): string {
  const delivery = parts.deliveryState === "read"
    ? "прочитано"
    : parts.deliveryState === "delivered"
      ? "доставлено"
      : parts.deliveryState === "sent"
        ? "отправлено"
        : null;

  // The sender and what they said are one phrase, not two facts — a reader
  // hearing "Ангелина. текст" has to reassemble them.
  const said = parts.prefix ? `${parts.prefix}: ${parts.text}` : parts.text;

  return [
    said,
    delivery,
    parts.unreadCount > 0 ? `непрочитанных: ${parts.unreadCount}` : null,
  ]
    .filter(Boolean)
    .join(". ");
}

export type PreviewInput = {
  chat: ChatListItem;
  currentUserId?: string;
  /**
   * The plaintext for this chat's last message, if this device holds it. Read
   * from the local cache by the caller — never from the server, which does not
   * have it and must not.
   */
  decryptedBody?: string | null;
  /** A call in progress with this chat, from the live call provider. */
  liveCall?: { video: boolean } | null;
  /** Who is typing right now, from the realtime channel. */
  typingName?: string | null;
  /** An unsent draft this device saved for this chat. */
  draft?: string | null;
};

/**
 * The one function that decides what a chat row says.
 *
 * Order matters and encodes a priority: what is happening now outranks what
 * was saved locally, which outranks what happened last. A live call and a
 * typing indicator are transient — they are read from live sources here and
 * are never written back into the chat's stored last message.
 */
export function buildConversationPreview({
  chat,
  currentUserId,
  decryptedBody,
  liveCall,
  typingName,
  draft,
}: PreviewInput): ConversationPreview {
  const unreadCount = chat.unreadCount ?? 0;

  if (liveCall) {
    const text = liveCall.video ? "Видеозвонок · идёт" : "Аудиозвонок · идёт";
    return {
      text,
      icon: null,
      prefix: null,
      deliveryState: null,
      tone: "live",
      label: toLabel({ prefix: null, text, deliveryState: null, unreadCount }),
    };
  }

  if (typingName) {
    const text = chat.type === "GROUP" ? `${typingName} печатает…` : "печатает…";
    return {
      text,
      icon: null,
      prefix: null,
      deliveryState: null,
      tone: "live",
      label: toLabel({ prefix: null, text, deliveryState: null, unreadCount }),
    };
  }

  if (draft) {
    return {
      text: draft,
      icon: null,
      prefix: "Черновик",
      deliveryState: null,
      tone: "danger",
      label: toLabel({ prefix: "Черновик", text: draft, deliveryState: null, unreadCount }),
    };
  }

  // A finished call, when it is the newest thing that happened here. The
  // projection only sets this when it actually outranks the last message, so
  // the row's text and its position in the list agree.
  //
  // Audio and video are not distinguished on purpose: `CallLog` records no
  // such column, and writing "Аудиозвонок" for what may have been a video call
  // would be inventing a detail. "Звонок" is the part that is true.
  const call = chat.lastCall;
  if (call) {
    const missed = call.status === "missed";
    const outgoing = call.outgoing;

    if (missed) {
      // A missed call is only missed for the person who did not place it.
      const text = outgoing ? "Звонок без ответа" : "Пропущенный звонок";
      return {
        text,
        icon: "callMissed",
        prefix: null,
        deliveryState: null,
        tone: outgoing ? "normal" : "danger",
        label: toLabel({ prefix: null, text, deliveryState: null, unreadCount }),
      };
    }

    const duration = call.durationSec && call.durationSec > 0 ? formatCallDuration(call.durationSec) : null;
    // A declined call reads differently from one that simply ran short.
    const base = call.status === "completed" ? "Звонок" : call.status === "declined" ? "Звонок отклонён" : "Звонок";
    const text = duration ? `${base} · ${duration}` : base;
    return {
      text,
      icon: outgoing ? "callOutgoing" : "callIncoming",
      prefix: null,
      deliveryState: null,
      tone: "normal",
      label: toLabel({ prefix: null, text, deliveryState: null, unreadCount }),
    };
  }

  const message = chat.lastMessage;

  if (!message) {
    const text = chat.isSelfChat ? "Сообщения самому себе" : "Нет сообщений";
    return {
      text,
      icon: null,
      prefix: null,
      deliveryState: null,
      tone: "muted",
      label: toLabel({ prefix: null, text, deliveryState: null, unreadCount }),
    };
  }

  const isOwn = Boolean(message.isMine || (currentUserId && message.sender?.id === currentUserId));
  // Ticks describe our own outgoing message and nothing else. An incoming
  // message has no delivery state to show — the unread badge is that row's
  // signal, and the two are different systems.
  const deliveryState: PreviewDeliveryState | null = isOwn && !message.deletedAt
    ? (message.deliveryStatus ?? (message.readAt ? "read" : message.deliveredAt ? "delivered" : "sent"))
    : null;

  const finish = (
    text: string,
    icon: PreviewIcon,
    options?: { prefix?: string | null; tone?: PreviewTone; deliveryState?: PreviewDeliveryState | null },
  ): ConversationPreview => {
    const prefix = options?.prefix !== undefined ? options.prefix : senderPrefix(chat, message, isOwn);
    const delivery = options?.deliveryState !== undefined ? options.deliveryState : deliveryState;
    return {
      text,
      icon,
      prefix,
      deliveryState: delivery,
      tone: options?.tone ?? "normal",
      label: toLabel({ prefix, text, deliveryState: delivery, unreadCount }),
    };
  };

  if (message.deletedAt) {
    return finish("Сообщение удалено", null, { prefix: null, tone: "muted", deliveryState: null });
  }

  if (message.type === "SYSTEM") {
    return finish(message.body?.trim() || "Событие", null, { prefix: null, tone: "muted", deliveryState: null });
  }

  // The plaintext this device decrypted for itself, preferred over anything
  // else: for an encrypted message the server's `body` is null by design, and
  // this is the only place the real text can come from.
  const body = decryptedBody?.trim() || message.body?.trim() || null;

  if (message.type === "VOICE") {
    const duration = attachmentDuration(message.attachments?.[0]);
    return finish(duration ? `Голосовое · ${formatMediaDuration(duration)}` : "Голосовое сообщение", "voice");
  }

  if (message.type === "VIDEO_NOTE") {
    const duration = attachmentDuration(message.attachments?.[0]);
    return finish(duration ? `Видеосообщение · ${formatMediaDuration(duration)}` : "Видеосообщение", "videoNote");
  }

  // A caption travels as its own message in this product, so a media message
  // with text is rare — but when both exist the words are what the reader
  // actually wants, with the icon left to say what it was attached to.
  const media = describeAttachments(message);
  if (body && media) return finish(body, media.icon);
  if (body) return finish(body, null);
  if (media) return finish(media.text, media.icon);

  // Nothing readable and nothing attached. If it is encrypted, this device
  // simply does not hold the key — a normal state with its own wording, not a
  // failure, and deliberately not the technical phrasing used inside a
  // conversation.
  if (message.isEncrypted) return finish("Зашифрованное сообщение", null, { tone: "muted" });

  if (message.type === "IMAGE") return finish("Фото", "photo");
  if (message.type === "VIDEO") return finish("Видео", "video");
  if (message.type === "FILE") return finish("Файл", "file");
  return finish("Сообщение", null, { tone: "muted" });
}
