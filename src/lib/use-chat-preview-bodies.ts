"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChatListItem } from "./chat-list";
import { getChatDecrypted } from "./chat-cache";
import { getLocalEncryptedMessage } from "./e2ee/indexed-db";
import { getLocalDeviceId } from "./e2ee/keys";

/**
 * The plaintext of each chat's last message, read from this device's own
 * storage.
 *
 * The chat list gets `body: null` for every encrypted message, because the
 * server genuinely does not have the plaintext and must not — that part is
 * correct and is not what this changes. What was missing is the other half:
 * this device *does* hold the text, and nothing was reading it, so every row
 * fell through to "Зашифрованное сообщение".
 *
 * Two sources, cheapest first:
 *
 *  1. the RAM cache that `ChatCacheHydrator` fills on start and the
 *     conversation screen tops up as it decrypts — a synchronous map lookup;
 *  2. failing that, one keyed IndexedDB read for that exact message.
 *
 * Bounded by design: **one lookup per chat**, for the last message only, and
 * only for ids not already resolved. Opening the list does not decrypt
 * history, and a re-render does no work at all — the results live in state
 * keyed by message id, so a row whose last message has not changed reuses the
 * value it already had.
 *
 * No decryption happens here. Only messages this device has already decrypted
 * once (by having the conversation open) are readable, which is a deliberate
 * limit rather than an oversight: decrypting from the list would need each
 * sender's key fetched per chat — the N+1 that a list screen must not do.
 * Anything not found stays encrypted-looking, which is honest.
 */
export function useChatPreviewBodies(
  chats: ChatListItem[],
  userId: string | undefined,
): Record<string, string> {
  const [bodies, setBodies] = useState<Record<string, string>>({});
  // Ids already looked up — successfully or not. Prevents a message with no
  // local copy from being re-queried on every list update.
  const attemptedRef = useRef<Set<string>>(new Set());

  // The exact set of messages worth resolving: encrypted, still without text,
  // and actually shown. Recomputed only when the list's last messages change.
  const wanted = useMemo(() => {
    const items: { chatId: string; messageId: string }[] = [];
    for (const chat of chats) {
      const message = chat.lastMessage;
      if (!message || message.deletedAt) continue;
      if (message.body) continue;
      if (!message.isEncrypted) continue;
      items.push({ chatId: chat.id, messageId: message.id });
    }
    return items;
  }, [chats]);

  useEffect(() => {
    if (!userId || wanted.length === 0) return;

    let cancelled = false;

    // The RAM cache is synchronous, so anything already hydrated resolves in
    // this pass without touching IndexedDB at all.
    const fromMemory: Record<string, string> = {};
    const needsDisk: { chatId: string; messageId: string }[] = [];
    for (const item of wanted) {
      if (attemptedRef.current.has(item.messageId)) continue;
      const cached = getChatDecrypted(item.chatId)?.[item.messageId];
      if (cached) {
        fromMemory[item.messageId] = cached;
        attemptedRef.current.add(item.messageId);
      } else {
        needsDisk.push(item);
      }
    }

    // Both sources publish through the same async pass. The RAM hits are
    // already resolved by this point, so the await below costs them nothing —
    // and keeping one `setBodies` call out of the effect body avoids the
    // synchronous cascade that a same-tick state write would cause.
    (async () => {
      const resolved: Record<string, string> = { ...fromMemory };

      if (needsDisk.length > 0) {
        const deviceId = await getLocalDeviceId(userId).catch(() => null);
        if (cancelled) return;

        if (deviceId) {
          for (const item of needsDisk) {
            if (cancelled) return;
            attemptedRef.current.add(item.messageId);
            const stored = await getLocalEncryptedMessage({
              userId,
              messageId: item.messageId,
              chatId: item.chatId,
              deviceId,
            }).catch(() => null);
            if (stored?.body) resolved[item.messageId] = stored.body;
          }
        }
      }

      if (!cancelled && Object.keys(resolved).length > 0) {
        setBodies((current) => ({ ...current, ...resolved }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, wanted]);

  return bodies;
}
