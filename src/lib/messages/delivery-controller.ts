/**
 * The one place an outgoing message lives between "the user pressed send" and
 * "the server has it".
 *
 * It is deliberately outside React. The bug this replaces was structural: the
 * send lived inside a `useCallback` in the conversation component, so unmounting
 * the screen destroyed the in-flight state — the message vanished, or came back
 * duplicated when a retry minted a second client id.
 *
 * Guarantees:
 *  - a message is durably stored before the composer is cleared;
 *  - a successful HTTP response alone marks it `sent`; the socket echo is a
 *    reconciliation, never a precondition;
 *  - a retry reuses the same `clientMessageId`, so the server recognises it and
 *    returns the already-committed message instead of creating a second one;
 *  - nothing stays in flight forever;
 *  - leaving the screen does not cancel delivery.
 *
 * Everything it touches is injected — the repository, the transport and the
 * clock — so the whole path is exercised in a validation script with no DOM.
 */
import {
  createLocalMessage,
  expireStalledSends,
  isInFlight,
  markFailed,
  markSending,
  reconcileServerMessage,
  mergeServerHistory,
  SEND_TIMEOUT_MS,
  type LocalMessageStatus,
  type ReconcilableMessage,
  type ServerMessage,
} from "./reconcile";
import type { PendingMessageRecord, PendingRepository } from "./pending-repository";

export type SendAttempt = {
  clientMessageId: string;
  body: string;
  replyToMessageId: string | null;
  attempt: number;
};

export type TransportResult =
  | { ok: true; message: ServerMessage }
  | { ok: false; errorCode: string; retryable: boolean };

export type DeliveryTransport = (attempt: SendAttempt) => Promise<TransportResult>;

export type OutgoingMessage = ReconcilableMessage & {
  replyToMessageId: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
};

export type DeliveryState = {
  messages: OutgoingMessage[];
  /** True while the controller is talking to the server. */
  flushing: boolean;
  /** Set when the pending store had to fall back to memory. */
  storageDegraded: boolean;
};

export type DeliveryControllerOptions = {
  chatId: string;
  userId: string;
  repository: PendingRepository;
  transport: DeliveryTransport;
  /** Retry budget for a single message before it is left failed for the user. */
  maxAttempts?: number;
  now?: () => number;
  timeoutMs?: number;
  /** Called once the server has committed a message, with the canonical form. */
  onCommitted?: (message: ServerMessage, clientMessageId: string) => void;
};

const DEFAULT_MAX_ATTEMPTS = 3;

function newClientMessageId(): string {
  const globalCrypto = typeof crypto !== "undefined" ? crypto : undefined;
  if (globalCrypto?.randomUUID) return globalCrypto.randomUUID();
  return `cid-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export class MessageDeliveryController {
  private readonly options: Required<Pick<DeliveryControllerOptions, "maxAttempts" | "now" | "timeoutMs">> &
    DeliveryControllerOptions;
  private messages: OutgoingMessage[] = [];
  private listeners = new Set<(state: DeliveryState) => void>();
  private flushing = false;
  /** Set while a flush is running so a second one waits instead of racing. */
  private flushQueued = false;
  /** The running pass, so a concurrent caller awaits it rather than starting another. */
  private flushRun: Promise<void> | null = null;
  private online = true;
  private storageDegraded = false;
  private hydrated = false;
  /**
   * Automatic attempts made in *this* session, keyed by client id.
   * `attemptCount` on the record is the lifetime total and is kept for display;
   * the retry budget is per session, so a message that exhausted its retries
   * yesterday is tried again after a reload instead of sitting there forever.
   */
  private sessionAttempts = new Map<string, number>();

  constructor(options: DeliveryControllerOptions) {
    this.options = {
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      now: () => Date.now(),
      timeoutMs: SEND_TIMEOUT_MS,
      ...options,
    };
  }

  // --- observation ----------------------------------------------------------

  /**
   * The snapshot is cached and only replaced when something actually changed.
   * `useSyncExternalStore` compares snapshots by identity, so returning a fresh
   * object on every read makes React re-render forever.
   */
  private snapshot: DeliveryState = { messages: [], flushing: false, storageDegraded: false };

  getState(): DeliveryState {
    if (
      this.snapshot.messages !== this.messages ||
      this.snapshot.flushing !== this.flushing ||
      this.snapshot.storageDegraded !== this.storageDegraded
    ) {
      this.snapshot = { messages: this.messages, flushing: this.flushing, storageDegraded: this.storageDegraded };
    }
    return this.snapshot;
  }

  subscribe(listener: (state: DeliveryState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    const state = this.getState();
    for (const listener of this.listeners) listener(state);
  }

  // --- lifecycle ------------------------------------------------------------

  /**
   * Reads back whatever the previous session left behind. Anything a crashed
   * tab left mid-flight becomes retryable first, so a reload never shows a
   * bubble that spins forever.
   */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    await this.options.repository.recoverInterrupted().catch(() => 0);
    const records = await this.options.repository.load().catch(() => [] as PendingMessageRecord[]);
    if (records.length > 0) {
      this.messages = records.map(recordToMessage);
      this.emit();
    }
  }

  /**
   * Rebind the parts that belong to the mounted screen. The controller outlives
   * the component, so a remount hands it a fresh transport and callback rather
   * than creating a second controller — which would send the queue twice.
   */
  rebind(parts: { transport?: DeliveryTransport; onCommitted?: DeliveryControllerOptions["onCommitted"]; repository?: PendingRepository }): void {
    if (parts.transport) this.options.transport = parts.transport;
    if (parts.onCommitted) this.options.onCommitted = parts.onCommitted;
    if (parts.repository) this.options.repository = parts.repository;
  }

  setOnline(online: boolean): void {
    const changed = this.online !== online;
    this.online = online;
    // Coming back online is the moment to drain the queue.
    if (changed && online) void this.flush();
  }

  isOnline(): boolean {
    return this.online;
  }

  // --- the send path --------------------------------------------------------

  /**
   * Accepts a message. Resolves once it is durably stored — that resolution is
   * what the composer waits for before clearing its draft. Network work
   * continues afterwards and is not tied to this promise or to any component.
   */
  async enqueue(input: { body: string; replyToMessageId?: string | null; clientMessageId?: string }): Promise<OutgoingMessage> {
    const body = input.body.trim();
    if (!body) throw new Error("empty message");

    const clientMessageId = input.clientMessageId ?? newClientMessageId();
    const message: OutgoingMessage = {
      ...createLocalMessage({ clientMessageId, body }),
      replyToMessageId: input.replyToMessageId ?? null,
      attemptCount: 0,
      lastErrorCode: null,
    };

    this.messages = [...this.messages, message];
    await this.persist(message);
    this.emit();

    void this.flush();
    return message;
  }

  /** Retry a failed message. The same client id is reused, so no second bubble. */
  retry(clientMessageId: string): void {
    const message = this.messages.find((candidate) => candidate.clientMessageId === clientMessageId);
    if (!message || message.serverId) return;
    // An explicit retry is a fresh budget — the user asked for it.
    this.sessionAttempts.delete(clientMessageId);
    this.update(clientMessageId, { status: "queued", lastErrorCode: null, attemptStartedAt: null });
    void this.flush();
  }

  /** Drop a message the user chose to discard. */
  async discard(clientMessageId: string): Promise<void> {
    this.messages = this.messages.filter((message) => message.clientMessageId !== clientMessageId);
    await this.options.repository.remove(clientMessageId).catch(() => {});
    this.emit();
  }

  /**
   * Drain the queue. Single-flight: a concurrent call sets a flag and the
   * running pass picks the work up, so two flushes can never send the same
   * message twice.
   */
  flush(): Promise<void> {
    if (this.flushRun) {
      // Awaiting the running pass — not returning early — is what makes
      // `await flush()` mean "the queue has been drained" for the caller.
      this.flushQueued = true;
      return this.flushRun;
    }
    this.flushRun = this.runFlush().finally(() => {
      this.flushRun = null;
    });
    return this.flushRun;
  }

  private async runFlush(): Promise<void> {
    this.flushing = true;
    this.emit();

    try {
      do {
        this.flushQueued = false;
        if (!this.online) break;

        // FIFO, so messages arrive in the order the user typed them.
        const next = () =>
          this.messages.find(
            (message) =>
              !message.serverId &&
              (message.status === "queued" || message.status === "failed") &&
              (this.sessionAttempts.get(message.clientMessageId) ?? 0) < this.options.maxAttempts,
          );

        for (let message = next(); message; message = next()) {
          await this.attempt(message.clientMessageId);
          if (!this.online) break;
        }
      } while (this.flushQueued);
    } finally {
      this.flushing = false;
      this.emit();
    }
  }

  private async attempt(clientMessageId: string): Promise<void> {
    const current = this.messages.find((message) => message.clientMessageId === clientMessageId);
    if (!current || current.serverId) return;

    const attempt = current.attemptCount + 1;
    this.sessionAttempts.set(clientMessageId, (this.sessionAttempts.get(clientMessageId) ?? 0) + 1);
    this.messages = markSending(this.messages, clientMessageId, new Date(this.options.now()).toISOString()) as OutgoingMessage[];
    this.update(clientMessageId, { attemptCount: attempt });

    const target = this.messages.find((message) => message.clientMessageId === clientMessageId);
    if (target) await this.persist(target);

    let result: TransportResult;
    try {
      result = await this.options.transport({
        clientMessageId,
        body: current.body ?? "",
        replyToMessageId: current.replyToMessageId,
        attempt,
      });
    } catch (error) {
      result = { ok: false, errorCode: errorCodeOf(error), retryable: true };
    }

    if (result.ok) {
      // A 2xx is sufficient. The socket echo, if it ever arrives, reconciles
      // onto this same entry rather than adding a second one.
      this.messages = reconcileServerMessage(this.messages, result.message, "sent") as OutgoingMessage[];
      this.options.onCommitted?.(result.message, clientMessageId);
      await this.options.repository.remove(clientMessageId).catch(() => {});
      this.emit();
      return;
    }

    this.messages = markFailed(this.messages, clientMessageId) as OutgoingMessage[];
    this.update(clientMessageId, { lastErrorCode: result.errorCode });
    const failed = this.messages.find((message) => message.clientMessageId === clientMessageId);
    if (failed) await this.persist(failed);
    this.emit();

    // A permanent rejection is not worth retrying — spend the budget at once.
    if (!result.retryable) this.sessionAttempts.set(clientMessageId, this.options.maxAttempts);
  }

  // --- inbound reconciliation ----------------------------------------------

  /** Fold a socket echo or an HTTP result in. Idempotent by construction. */
  ingestServerMessage(server: ServerMessage, status: LocalMessageStatus = "sent"): void {
    const known = this.messages.some(
      (message) => (message.serverId && message.serverId === server.id) || (server.clientId && message.clientMessageId === server.clientId),
    );
    // Messages the controller never sent belong to the conversation list, not here.
    if (!known) return;

    this.messages = reconcileServerMessage(this.messages, server, status) as OutgoingMessage[];
    if (server.clientId) void this.options.repository.remove(server.clientId).catch(() => {});
    this.emit();
  }

  /** Fold a page of canonical history in, without dropping pending messages. */
  ingestHistory(history: ServerMessage[]): void {
    const relevant = history.filter((server) =>
      this.messages.some(
        (message) => (message.serverId && message.serverId === server.id) || (server.clientId && message.clientMessageId === server.clientId),
      ),
    );
    if (relevant.length === 0) return;
    this.messages = mergeServerHistory(this.messages, relevant) as OutgoingMessage[];
    this.emit();
  }

  /** Move anything past the in-flight timeout to failed. Safe to call often. */
  tick(): void {
    const expired = expireStalledSends(this.messages, this.options.now(), this.options.timeoutMs) as OutgoingMessage[];
    const changed = expired.some((message, index) => message.status !== this.messages[index]?.status);
    if (!changed) return;
    this.messages = expired.map((message) =>
      message.status === "failed" && !message.lastErrorCode ? { ...message, lastErrorCode: "TIMEOUT" } : message,
    );
    for (const message of this.messages) {
      if (message.status === "failed") void this.persist(message);
    }
    this.emit();
  }

  /** Messages still owed, for a "you have unsent messages" affordance. */
  outstanding(): OutgoingMessage[] {
    return this.messages.filter((message) => !message.serverId && (isInFlight(message.status) || message.status === "failed"));
  }

  // --- internals ------------------------------------------------------------

  private update(clientMessageId: string, patch: Partial<OutgoingMessage>): void {
    this.messages = this.messages.map((message) =>
      message.clientMessageId === clientMessageId ? { ...message, ...patch } : message,
    );
  }

  private async persist(message: OutgoingMessage): Promise<void> {
    try {
      await this.options.repository.save(messageToRecord(message, this.options.chatId, this.options.userId));
    } catch {
      // The resilient repository absorbs this; a bare one may not. Losing the
      // durable copy must not lose the message, so the send continues.
      if (!this.storageDegraded) {
        this.storageDegraded = true;
        this.emit();
      }
    }
  }
}

function errorCodeOf(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "ABORTED";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "OFFLINE";
  return "NETWORK";
}

export function messageToRecord(message: OutgoingMessage, chatId: string, userId: string): PendingMessageRecord {
  return {
    renderKey: message.renderKey,
    clientMessageId: message.clientMessageId,
    serverId: message.serverId,
    chatId,
    senderUserId: userId,
    body: message.body,
    status: message.status,
    createdAt: message.createdAt,
    serverCreatedAt: null,
    attemptCount: message.attemptCount,
    lastErrorCode: message.lastErrorCode,
    updatedAt: new Date().toISOString(),
  };
}

export function recordToMessage(record: PendingMessageRecord): OutgoingMessage {
  return {
    serverId: record.serverId,
    clientMessageId: record.clientMessageId,
    renderKey: record.renderKey || `local:${record.clientMessageId}`,
    // A record restored from storage is never mid-flight: the tab that owned
    // that attempt is gone, so it starts retryable.
    status: record.status === "sending" || record.status === "encrypting" ? "failed" : record.status,
    body: record.body,
    createdAt: record.createdAt,
    attemptStartedAt: null,
    replyToMessageId: null,
    attemptCount: record.attemptCount ?? 0,
    lastErrorCode: record.lastErrorCode,
  };
}

// --- per-conversation registry ----------------------------------------------

const controllers = new Map<string, MessageDeliveryController>();

function key(userId: string, chatId: string) {
  return `${userId}:${chatId}`;
}

/**
 * One controller per (user, conversation), kept at module scope so navigating
 * away from the screen does not cancel a send in progress.
 */
export function getDeliveryController(options: DeliveryControllerOptions): MessageDeliveryController {
  const id = key(options.userId, options.chatId);
  const existing = controllers.get(id);
  if (existing) {
    existing.rebind({ transport: options.transport, onCommitted: options.onCommitted, repository: options.repository });
    return existing;
  }
  const controller = new MessageDeliveryController(options);
  controllers.set(id, controller);
  return controller;
}

/** Test affordance — drops every cached controller. */
export function resetDeliveryControllers(): void {
  controllers.clear();
}
