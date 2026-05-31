/**
 * In-memory (RAM-only) cache of decrypted media object URLs.
 *
 * SECURITY: blob object URLs live only in this tab's memory for the session and
 * are never persisted. Same lifetime as the decrypted media the user already
 * sees. On reload the cache is gone and media is re-fetched + re-decrypted.
 *
 * Purpose: a chat's images / videos / round-videos are decrypted once and then
 * reused instantly when scrolling back or re-opening the chat — no repeated
 * download+decrypt, no visible "Расшифровка медиа…" flash, no layout jump.
 */

type Entry = { url: string; ts: number };

const MAX_ENTRIES = 80; // cap memory; evict oldest beyond this
const store = new Map<string, Entry>();

export function getMediaUrl(attachmentId: string): string | null {
  const entry = store.get(attachmentId);
  if (!entry) return null;
  entry.ts = Date.now();
  return entry.url;
}

export function putMediaUrl(attachmentId: string, url: string) {
  const existing = store.get(attachmentId);
  if (existing) {
    // Reuse the already-cached URL; revoke the freshly created duplicate caller-side.
    existing.ts = Date.now();
    return existing.url;
  }
  store.set(attachmentId, { url, ts: Date.now() });

  if (store.size > MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTs = Infinity;
    for (const [key, entry] of store) {
      if (entry.ts < oldestTs) {
        oldestTs = entry.ts;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      const evicted = store.get(oldestKey);
      store.delete(oldestKey);
      if (evicted) {
        try { URL.revokeObjectURL(evicted.url); } catch { /* ignore */ }
      }
    }
  }
  return url;
}

export function hasMediaUrl(attachmentId: string): boolean {
  return store.has(attachmentId);
}
