/**
 * One reconciliation layer for outgoing messages.
 *
 * Everything that can introduce a copy of the same message — the optimistic
 * insert, the HTTP response, the socket echo, a server history fetch and the
 * restored local cache — goes through here, so a message is matched by identity
 * rather than by text or position.
 *
 * Matching order:
 *   1. canonical server id
 *   2. stable clientMessageId
 * Text + timestamp is never a key.
 */

export type LocalMessageStatus =
  | "queued"      // created locally, not yet on the wire (offline or waiting)
  | "encrypting"  // sealing for the recipient devices
  | "sending"     // request in flight
  | "sent"        // server committed
  | "delivered"   // recipient device acknowledged
  | "read"        // recipient read it
  | "failed";     // terminal for now; retryable with the same client id

/** How long a message may stay in flight before it is treated as failed. */
export const SEND_TIMEOUT_MS = 45_000;

export type ReconcilableMessage = {
  /** Canonical server id once committed; null while the message is local-only. */
  serverId: string | null;
  /** Stable per-message id created once on the client and reused on every retry. */
  clientMessageId: string;
  /** Stable across the message's whole life so React never remounts the bubble. */
  renderKey: string;
  status: LocalMessageStatus;
  body: string | null;
  createdAt: string;
  /** When the current attempt started, used for the in-flight timeout. */
  attemptStartedAt: string | null;
};

export type ServerMessage = {
  id: string;
  clientId?: string | null;
  body: string | null;
  createdAt: string;
};

/** Terminal and in-flight statuses, used to decide what a reconnect may resend. */
const IN_FLIGHT: LocalMessageStatus[] = ["queued", "encrypting", "sending"];
export function isInFlight(status: LocalMessageStatus): boolean {
  return IN_FLIGHT.includes(status);
}

/**
 * A locally created message. The render key is derived from the client id and
 * never changes, so adopting a server id later does not remount the bubble.
 */
export function createLocalMessage(params: {
  clientMessageId: string;
  body: string | null;
  createdAt?: string;
}): ReconcilableMessage {
  return {
    serverId: null,
    clientMessageId: params.clientMessageId,
    renderKey: `local:${params.clientMessageId}`,
    status: "queued",
    body: params.body,
    createdAt: params.createdAt ?? new Date().toISOString(),
    attemptStartedAt: null,
  };
}

function matches(message: ReconcilableMessage, server: ServerMessage): boolean {
  if (message.serverId && message.serverId === server.id) return true;
  if (server.clientId && message.clientMessageId === server.clientId) return true;
  return false;
}

/**
 * Fold a canonical server message into the list.
 *
 * If it corresponds to a message we already hold — by server id or client id —
 * that entry is *updated in place*, keeping its render key and position. Only a
 * genuinely unknown message is appended. This is what makes a duplicate socket
 * echo, or an echo racing the HTTP response, a no-op instead of a second bubble.
 */
export function reconcileServerMessage(
  messages: ReconcilableMessage[],
  server: ServerMessage,
  status: LocalMessageStatus = "sent",
): ReconcilableMessage[] {
  const index = messages.findIndex((message) => matches(message, server));

  if (index === -1) {
    return [
      ...messages,
      {
        serverId: server.id,
        clientMessageId: server.clientId ?? `server:${server.id}`,
        renderKey: server.clientId ? `local:${server.clientId}` : `server:${server.id}`,
        status,
        body: server.body,
        createdAt: server.createdAt,
        attemptStartedAt: null,
      },
    ];
  }

  const existing = messages[index];
  const next = [...messages];
  next[index] = {
    ...existing,
    serverId: server.id,
    body: server.body,
    // The server's timestamp is authoritative once committed.
    createdAt: server.createdAt,
    // Never regress a delivery status that has already advanced.
    status: rank(status) > rank(existing.status) ? status : existing.status,
    attemptStartedAt: null,
  };
  return next;
}

const ORDER: LocalMessageStatus[] = ["failed", "queued", "encrypting", "sending", "sent", "delivered", "read"];
function rank(status: LocalMessageStatus): number {
  return ORDER.indexOf(status);
}

/** Merge a page of canonical history without dropping still-pending local messages. */
export function mergeServerHistory(
  messages: ReconcilableMessage[],
  history: ServerMessage[],
): ReconcilableMessage[] {
  let merged = messages;
  for (const server of history) merged = reconcileServerMessage(merged, server);
  return merged;
}

/** Mark the start of an attempt. Retry reuses the same client id, so no new bubble appears. */
export function markSending(
  messages: ReconcilableMessage[],
  clientMessageId: string,
  now: string = new Date().toISOString(),
): ReconcilableMessage[] {
  return messages.map((message) =>
    message.clientMessageId === clientMessageId
      ? { ...message, status: "sending", attemptStartedAt: now }
      : message,
  );
}

export function markFailed(messages: ReconcilableMessage[], clientMessageId: string): ReconcilableMessage[] {
  return messages.map((message) =>
    message.clientMessageId === clientMessageId && !message.serverId
      ? { ...message, status: "failed", attemptStartedAt: null }
      : message,
  );
}

/**
 * Nothing may sit in flight forever. Any attempt older than the timeout becomes
 * failed, which is retryable — rather than a bubble that spins indefinitely.
 */
export function expireStalledSends(
  messages: ReconcilableMessage[],
  now: number = Date.now(),
  timeoutMs: number = SEND_TIMEOUT_MS,
): ReconcilableMessage[] {
  return messages.map((message) => {
    if (message.serverId || !isInFlight(message.status)) return message;
    if (!message.attemptStartedAt) return message;
    if (now - new Date(message.attemptStartedAt).getTime() < timeoutMs) return message;
    return { ...message, status: "failed", attemptStartedAt: null };
  });
}

/** Messages a reconnect may safely resend: never committed, so the same client id is reused. */
export function resendableOnReconnect(messages: ReconcilableMessage[]): ReconcilableMessage[] {
  return messages.filter((message) => !message.serverId && (isInFlight(message.status) || message.status === "failed"));
}
