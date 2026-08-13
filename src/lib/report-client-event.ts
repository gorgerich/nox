"use client";

/**
 * Reports a client-only failure to the server.
 *
 * Fire-and-forget by design: telemetry that can fail a user's action is worse
 * than no telemetry. Errors here are swallowed, and `keepalive` lets the report
 * survive the page being closed a moment later — which is exactly when the
 * interesting failures happen.
 */
export function reportClientEvent(
  event: string,
  fields: { chatId?: string; detail?: string } = {},
): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, ...fields }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never let reporting a problem become one.
  }
}
