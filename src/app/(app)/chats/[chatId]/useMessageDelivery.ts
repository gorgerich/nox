"use client";

/**
 * React binding for the message delivery controller.
 *
 * The hook is deliberately thin: it subscribes, it wires the browser's online
 * and visibility signals, and it hands the controller a transport. It owns no
 * delivery state of its own, so unmounting the conversation screen tears down
 * the subscription and nothing else — the send keeps going.
 */
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  getDeliveryController,
  type DeliveryState,
  type DeliveryTransport,
  type OutgoingMessage,
} from "@/lib/messages/delivery-controller";
import {
  createIndexedDbPendingRepository,
  createMemoryPendingRepository,
  createResilientPendingRepository,
  type OutboxBlobStore,
} from "@/lib/messages/pending-repository";
import type { ServerMessage } from "@/lib/messages/reconcile";
import { attachmentMetaOf } from "./attachment-transport";

/** How often stalled sends are checked. Cheap: a pure scan of a short list. */
const TICK_MS = 5_000;

export type UseMessageDelivery = {
  outgoing: OutgoingMessage[];
  /** Only the ones not yet committed — what the conversation renders as bubbles. */
  pending: OutgoingMessage[];
  storageDegraded: boolean;
  /** Resolves once the message is durable. The composer clears on that promise. */
  send: (body: string, replyToMessageId?: string | null) => Promise<OutgoingMessage>;
  /** Resolves once the file's bytes and metadata are durable, not once uploaded. */
  sendAttachment: (
    file: File,
    options?: { caption?: string; replyToMessageId?: string | null },
  ) => Promise<OutgoingMessage>;
  retry: (clientMessageId: string) => void;
  discard: (clientMessageId: string) => Promise<void>;
  ingestServerMessage: (server: ServerMessage) => void;
  ingestHistory: (history: ServerMessage[]) => void;
  failedClientIds: Set<string>;
};

export function useMessageDelivery(params: {
  chatId: string;
  userId: string;
  transport: DeliveryTransport;
  blobs: OutboxBlobStore;
  onCommitted: (server: ServerMessage, clientMessageId: string) => void;
}): UseMessageDelivery {
  const { chatId, userId, blobs } = params;

  // The transport closes over encryption keys and component callbacks, so it is
  // read through a ref: the controller always calls the latest one without the
  // controller itself being recreated (which would fork the queue).
  const { transport, onCommitted } = params;

  const controller = useMemo(() => {
    const repository = createResilientPendingRepository(
      typeof indexedDB === "undefined"
        ? createMemoryPendingRepository()
        : createIndexedDbPendingRepository(userId, chatId),
      createMemoryPendingRepository(),
      (error) => console.error("[delivery] pending store unavailable, using memory", error),
    );

    return getDeliveryController({ chatId, userId, repository, transport, onCommitted, blobs });
    // The transport and the commit callback close over component state, so they
    // change on most renders. They are rebound below instead of being deps: a
    // new controller per render would fork the queue and send twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, userId]);

  // Keep the long-lived controller pointed at the current render's callbacks.
  useEffect(() => {
    controller.rebind({ transport, onCommitted });
  }, [controller, transport, onCommitted]);

  const state = useSyncExternalStore<DeliveryState>(
    useCallback((listener) => controller.subscribe(listener), [controller]),
    useCallback(() => controller.getState(), [controller]),
    // The server render has nothing pending; a stable empty state avoids a
    // hydration mismatch on the first paint.
    () => EMPTY_STATE,
  );

  // Restore anything a previous session left behind, once per conversation.
  useEffect(() => {
    void controller.hydrate();
  }, [controller]);

  // Online/offline. `navigator.onLine` is only a hint, so a failed attempt is
  // still retried when the browser claims to be online.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sync = () => controller.setOnline(navigator.onLine !== false);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [controller]);

  // Coming back to a backgrounded tab is a good moment to drain the queue —
  // mobile browsers freeze timers and sockets while the app is hidden.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void controller.flush();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [controller]);

  // Nothing may spin forever.
  useEffect(() => {
    const timer = setInterval(() => controller.tick(), TICK_MS);
    return () => clearInterval(timer);
  }, [controller]);

  const send = useCallback(
    (body: string, replyToMessageId?: string | null) => controller.enqueue({ body, replyToMessageId: replyToMessageId ?? null }),
    [controller],
  );

  const sendAttachment = useCallback(
    (file: File, options?: { caption?: string; replyToMessageId?: string | null }) =>
      controller.enqueueAttachment({
        blob: file,
        attachment: attachmentMetaOf(file),
        caption: options?.caption,
        replyToMessageId: options?.replyToMessageId ?? null,
      }),
    [controller],
  );

  const retry = useCallback((clientMessageId: string) => controller.retry(clientMessageId), [controller]);
  const discard = useCallback((clientMessageId: string) => controller.discard(clientMessageId), [controller]);
  const ingestServerMessage = useCallback((server: ServerMessage) => controller.ingestServerMessage(server), [controller]);
  const ingestHistory = useCallback((history: ServerMessage[]) => controller.ingestHistory(history), [controller]);

  const pending = useMemo(() => state.messages.filter((message) => !message.serverId), [state.messages]);
  const failedClientIds = useMemo(
    () => new Set(state.messages.filter((message) => message.status === "failed").map((message) => message.clientMessageId)),
    [state.messages],
  );

  return {
    outgoing: state.messages,
    pending,
    storageDegraded: state.storageDegraded,
    send,
    sendAttachment,
    retry,
    discard,
    ingestServerMessage,
    ingestHistory,
    failedClientIds,
  };
}

const EMPTY_STATE: DeliveryState = { messages: [], flushing: false, storageDegraded: false };
