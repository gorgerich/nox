"use client";

import { useSyncExternalStore } from "react";

/**
 * Reads a value that only exists in the browser without breaking hydration.
 *
 * Anything derived from `navigator`, a live socket, or other client-only state
 * differs between the server render and the first client render. Reading it
 * directly in render makes the two markups disagree, and React throws the
 * server tree away — which is what happened to the call buttons in the chat
 * header and to the connection banner.
 *
 * `useSyncExternalStore` is React's sanctioned answer: the hydration render
 * uses `serverValue` on both sides, so the markups match, and the real value is
 * applied in the re-render immediately after. Nothing is suppressed.
 *
 * Use it only for values that genuinely cannot exist during SSR. It is not a
 * way to silence a mismatch that has a real cause.
 */
const subscribeToNothing = () => () => {};

export function useClientValue<T>(getClientValue: () => T, serverValue: T): T {
  return useSyncExternalStore(subscribeToNothing, getClientValue, () => serverValue);
}
