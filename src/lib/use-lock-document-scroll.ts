"use client";

import { useCallback } from "react";

/**
 * Stops the page itself from scrolling for as long as a caller holds the lock.
 *
 * The one thing this exists to prevent: WKWebView's own "scroll the page to
 * reveal the focused field" behaviour, which runs before any of the app's own
 * keyboard-height CSS gets a chance to react. In a single-screen layout like
 * the conversation there is nothing below the fold to reveal — the composer
 * is already visible — so that scroll only misaligns a screen that was sized
 * correctly a moment earlier. `position: fixed` on the document removes the
 * scroll surface entirely, so there is nothing left for iOS to scroll: the
 * keyboard then does the one thing that is actually true, shrinking the
 * visible height, and nothing has to compensate for a scroll that never
 * happens.
 *
 * A second lock, native rather than CSS, does the same job inside the iOS
 * shell: WKWebView's outer page scroll is a real `UIScrollView`, separate
 * from any CSS `overflow`, and disabling it is `NoxViewController`'s side of
 * this same contract. Both locks are refcounted so overlapping holders (an
 * emoji panel opening while the field is still focused, for instance) never
 * unlock each other early.
 */
let holders = 0;

function setLocked(locked: boolean) {
  const root = document.documentElement;
  if (locked) root.dataset.scrollLocked = "1";
  else delete root.dataset.scrollLocked;

  const channel = (window as unknown as { webkit?: { messageHandlers?: Record<string, { postMessage: (value: unknown) => void }> } })
    .webkit?.messageHandlers?.noxScrollLock;
  channel?.postMessage(locked);
}

export function useLockDocumentScroll() {
  const lock = useCallback(() => {
    holders += 1;
    if (holders === 1) setLocked(true);
  }, []);

  const unlock = useCallback(() => {
    holders = Math.max(0, holders - 1);
    if (holders === 0) setLocked(false);
  }, []);

  return { lock, unlock };
}
