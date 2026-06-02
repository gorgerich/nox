/**
 * In-memory (RAM-only) client cache for instant chat rendering.
 *
 * SECURITY: this cache lives only in JS memory for the current tab/session. It
 * is NEVER written to disk / IndexedDB / localStorage / sessionStorage, so
 * decrypted plaintext is not persisted (same lifetime as the React state that
 * already holds it). On reload the cache is empty and the normal SSR + E2EE
 * decrypt path runs.
 *
 * Purpose:
 *  - `decrypted`: seed a chat's decrypted bodies on mount so re-opening a chat
 *    in the same session shows text immediately (no "Загрузка зашифрованного
 *    сообщения…" reflash while decryption re-runs).
 *  - `preview` + `header`: let the route-level loading.tsx paint the real last
 *    messages instantly (instead of gray skeleton bars) while the server
 *    component streams the fresh page — the Telegram "instant open" feel.
 */

import type { ChatListItem } from "./chat-list";

// --- Chat list cache (RAM only) -------------------------------------------
// Lets the Chats tab loading.tsx paint the last-known list instantly instead of
// gray skeleton rows while the server re-renders.
let chatListCache: ChatListItem[] | null = null;

export function putChatList(list: ChatListItem[]) {
  chatListCache = list;
}

export function getChatList(): ChatListItem[] | null {
  return chatListCache;
}

export type ChatPreviewMessage = {
  id: string;
  mine: boolean;
  text: string;
};

export type ChatHeaderCache = {
  title: string;
  avatarUrl: string | null;
  isSelfChat: boolean;
};

type ChatCacheEntry = {
  header: ChatHeaderCache | null;
  preview: ChatPreviewMessage[];
  decrypted: Record<string, string>;
  ts: number;
};

const MAX_CHATS = 40; // cap memory: evict oldest beyond this many chats
const MAX_PREVIEW = 30; // only the tail is needed for an open-screen preview

const store = new Map<string, ChatCacheEntry>();

function ensure(chatId: string): ChatCacheEntry {
  let entry = store.get(chatId);
  if (!entry) {
    entry = { header: null, preview: [], decrypted: {}, ts: Date.now() };
    store.set(chatId, entry);
  }
  return entry;
}

function evictIfNeeded() {
  if (store.size <= MAX_CHATS) return;
  let oldestKey: string | null = null;
  let oldestTs = Infinity;
  for (const [key, entry] of store) {
    if (entry.ts < oldestTs) {
      oldestTs = entry.ts;
      oldestKey = key;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

export function putChatHeader(chatId: string, header: ChatHeaderCache) {
  const entry = ensure(chatId);
  entry.header = header;
  entry.ts = Date.now();
  evictIfNeeded();
}

export function putChatPreview(chatId: string, preview: ChatPreviewMessage[]) {
  const entry = ensure(chatId);
  entry.preview = preview.slice(-MAX_PREVIEW);
  entry.ts = Date.now();
  evictIfNeeded();
}

export function putChatDecrypted(chatId: string, decrypted: Record<string, string>) {
  const entry = ensure(chatId);
  entry.decrypted = decrypted;
  entry.ts = Date.now();
  evictIfNeeded();
}

export function getChatDecrypted(chatId: string): Record<string, string> {
  return store.get(chatId)?.decrypted ?? {};
}

export function getChatCache(chatId: string): ChatCacheEntry | null {
  return store.get(chatId) ?? null;
}

export function clearChatCache(chatId: string) {
  store.delete(chatId);
}

/** Extract chatId from a /chats/<id> pathname. Returns null for list/sub-routes. */
export function chatIdFromPath(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  const match = pathname.match(/^\/chats\/([^/]+)/);
  if (!match) return null;
  const id = match[1];
  // Exclude known non-chat segments under /chats.
  if (id === "new" || id === "archive") return null;
  return id;
}
