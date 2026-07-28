import type { ChatListItem } from "./chat-list";

// Shared row formatters used by the live chat list and cached previews, so the
// two never drift apart.
//
// `formatChatTime` used to live here too. Timestamps now go through
// lib/time-format, which renders them identically on the server and in the
// first client frame — formatting a time here meant the row's text differed
// between the two and React discarded the row on hydration.

/**
 * Who sent the last message, for a group row.
 *
 * A group row that shows only the text answers "what was said" and leaves "by
 * whom" to be guessed. The name comes from the projection the list already
 * loads — `lastMessage.sender` is selected alongside the chat — so this costs
 * no extra query and cannot turn into an N+1.
 *
 * Returns null where no prefix belongs: one-to-one conversations, system events
 * that concern the whole chat, and rows with no message.
 */
export function getSenderPrefix(chat: ChatListItem): string | null {
  const message = chat.lastMessage;
  if (!message) return null;
  if (chat.type !== "GROUP") return null;
  // A system event is about the conversation, not about a person speaking.
  if (message.type === "SYSTEM") return null;

  if (message.isMine) return "Вы";

  const displayName = message.sender?.displayName?.trim();
  if (displayName) return displayName;
  const username = message.sender?.username?.trim();
  if (username) return username;
  // Legacy rows, and members who have since left, can arrive without a usable
  // name. A neutral word beats an id, and beats "undefined" by a mile.
  return "Участник";
}

/** What the last message was, without the sender. */
export function getMessagePreview(chat: ChatListItem) {
  const message = chat.lastMessage;
  if (!message) return "Нет сообщений";
  if (message.deletedAt) return "Сообщение удалено";
  if (message.type === "VIDEO_NOTE") return "Видеосообщение";
  if (message.type === "VOICE") return "Голосовое сообщение";
  if (message.body) return message.body;
  if (message.attachments[0]?.fileName) return message.attachments[0].fileName;
  // History this device cannot read is a real state with its own wording, not a
  // failure to describe the message.
  if (message.isEncrypted) return "Зашифрованное сообщение";
  if (message.type === "IMAGE") return "Фото";
  if (message.type === "VIDEO") return "Видео";
  if (message.type === "FILE") return "Файл";
  return "Сообщение";
}

/**
 * The row's preview as one phrase. Screen readers get the sender and the text
 * together rather than as two disconnected fragments.
 */
export function getPreviewLabel(chat: ChatListItem): string {
  const prefix = getSenderPrefix(chat);
  const preview = getMessagePreview(chat);
  return prefix ? `${prefix}: ${preview}` : preview;
}
