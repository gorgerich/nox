"use client";

import { useEffect } from "react";
import { registerCurrentDevice } from "@/lib/e2ee/keys";
import { getAllPersistedChatMessages, getLocalEncryptedMessage } from "@/lib/e2ee/indexed-db";
import {
  putChatHeader,
  putChatPreview,
  putChatDecrypted,
  getChatDecrypted,
  putChatMessages,
  type ChatPreviewMessage,
} from "@/lib/chat-cache";

// Warms the RAM chat cache from IndexedDB on app start, so after a reload the
// route loading.tsx can paint real chat content instantly (header + last
// messages) instead of a skeleton. Runs once, in the background, off the main
// render path. Plaintext is only ever held in RAM; disk stays ciphertext.

const PREVIEW_TAIL = 15;

type StoredMsg = {
  id: string;
  senderUserId: string;
  type: string;
  body: string | null;
  isEncrypted?: boolean;
  deletedAt?: string | null;
};

function labelFor(type: string): string {
  if (type === "IMAGE") return "Фото";
  if (type === "VIDEO") return "Видео";
  if (type === "VIDEO_NOTE") return "Видеосообщение";
  if (type === "VOICE") return "Голосовое сообщение";
  if (type === "FILE") return "Файл";
  return "Сообщение";
}

export function ChatCacheHydrator({ userId }: { userId: string }) {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const device = await registerCurrentDevice(userId).catch(() => null);
      const deviceId = device?.deviceId ?? null;
      const all = await getAllPersistedChatMessages().catch(() => []);
      if (cancelled) return;

      // Newest chats first so the most likely targets warm earliest.
      all.sort((a, b) => (b.record.ts ?? 0) - (a.record.ts ?? 0));

      for (const { chatId, record } of all) {
        if (cancelled) return;
        if (record.header) putChatHeader(chatId, record.header);
        // Warm the sync full-message cache so the chat opens instantly after reload.
        if (Array.isArray(record.messages) && record.messages.length > 0) {
          putChatMessages(chatId, record.messages);
        }

        const msgs = (record.messages as StoredMsg[]).filter((m) => m && !m.deletedAt);
        const tail = msgs.slice(-PREVIEW_TAIL);
        const decrypted: Record<string, string> = {};
        const preview: ChatPreviewMessage[] = [];

        for (const m of tail) {
          if (cancelled) return;
          let text = m.body?.trim() || "";
          if (!text && m.isEncrypted && deviceId) {
            const cached = await getLocalEncryptedMessage({ userId, messageId: m.id, chatId, deviceId }).catch(() => null);
            if (cached?.body) {
              text = cached.body;
              decrypted[m.id] = cached.body;
            }
          }
          if (!text) text = labelFor(m.type);
          preview.push({ id: m.id, mine: m.senderUserId === userId, text });
        }

        if (cancelled) return;
        if (Object.keys(decrypted).length > 0) {
          putChatDecrypted(chatId, { ...getChatDecrypted(chatId), ...decrypted });
        }
        if (preview.length > 0) {
          putChatPreview(chatId, preview);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return null;
}
