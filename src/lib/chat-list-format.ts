import type { ChatListItem } from "./chat-list";

// Shared row formatters used by the live chat list and cached previews, so the
// two never drift apart.

export function formatChatTime(isoDate: string) {
  const date = new Date(isoDate);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const day = 1000 * 60 * 60 * 24;

  if (diff < day && now.getDate() === date.getDate()) {
    return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
  }
  if (diff < day * 7) {
    return new Intl.DateTimeFormat("ru-RU", { weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(date);
}

export function getMessagePreview(chat: ChatListItem) {
  const message = chat.lastMessage;
  if (!message) return "Нет сообщений";
  if (message.deletedAt) return "Сообщение удалено";
  if (message.type === "VOICE") return "Голосовое сообщение";
  if (message.body) return message.body;
  if (message.attachments[0]?.fileName) return message.attachments[0].fileName;
  if (message.type === "IMAGE") return "Фото";
  if (message.type === "VIDEO") return "Видео";
  return "Файл";
}
