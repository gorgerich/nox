"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useSocket } from "@/hooks/useSocket";
import { ChatHeader } from "./ChatHeader";
import { ChatComposer } from "./ChatComposer";
import { MessageBubble, Message } from "./MessageBubble";
import { useChatAppearance, getChatAppearanceVars, resolveChatScheme } from "./ChatAppearance";
import { AppearanceSheet } from "./AppearanceSheet";
import { MediaPreviewComposer, MediaPreviewItem } from "./MediaPreviewComposer";
import { MediaViewer, MediaItem } from "./MediaViewer";
import { usePathname, useSearchParams } from "next/navigation";
import { usePresence } from "@/hooks/usePresence";
import { decryptMessage, decryptMessageV2, encryptMessageForDevices } from "@/lib/e2ee/utils";
import { fetchRecipientKeyBundle, getLocalPublicJwk, registerCurrentDevice } from "@/lib/e2ee/keys";
import { getLocalEncryptedMessage, storeAndVerifyLocalEncryptedMessage, putPersistedChatMessages, getPersistedChatMessages } from "@/lib/e2ee/indexed-db";
import { normalizeAvatarUrl } from "@/lib/media-url";
import { getChatDecrypted, putChatDecrypted, putChatPreview, putChatHeader, getChatMessages, putChatMessages } from "@/lib/chat-cache";
import { escapeRegExp } from "@/lib/text";
import { startsGroup, endsGroup } from "@/lib/message-grouping";
import { LocalTime } from "@/lib/time-format";
import { InlineConnectionNotice, type ConnectionStatus } from "./InlineConnectionNotice";
import { HistoryUnavailableNotice } from "./HistoryUnavailableNotice";
import { DateSeparator, TypingIndicator } from "./ConversationMarkers";
import { ChatThemePortal } from "./ChatThemePortal";
import { classifyHistory } from "@/lib/history-availability";
import { useTheme } from "@/components/ThemeProvider";
import { EMOJI_GROUPS } from "@/lib/emoji-data";
import { ChevronDown } from "lucide-react";
import { useMessageDelivery } from "./useMessageDelivery";
import { sendStagedAttachment } from "./attachment-transport";
import { createIndexedDbOutboxBlobStore } from "@/lib/messages/pending-repository";
import type { DeliveryTransport } from "@/lib/messages/delivery-controller";
import type { ServerMessage } from "@/lib/messages/reconcile";

type ChatRole = "OWNER" | "ADMIN" | "MEMBER";

type MessageWithDecrypted = Message & { body: string; messageUnavailableOnThisDevice?: boolean };

interface GroupedDate {
  type: "date";
  date: Date;
}

interface GroupedMessage {
  type: "message";
  message: MessageWithDecrypted;
  mine: boolean;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  showDisplayName: boolean;
}

type GroupedItem = GroupedDate | GroupedMessage;

interface ForwardChatOption {
  id: string;
  title: string;
  avatarUrl: string | null;
}

interface SearchResultMessage {
  id: string;
  body: string;
  createdAt: string;
  senderName: string;
}

function createOptimisticMessage(params: {
  clientId: string;
  body: string | null;
  currentUserId: string;
  replyToMessage: Message | null;
}): Message {
  return {
    id: `temp-${params.clientId}`,
    body: params.body,
    type: "TEXT",
    senderUserId: params.currentUserId,
    deletedAt: null,
    editedAt: null,
    replyToMessageId: params.replyToMessage?.id ?? null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
    sender: {
      id: params.currentUserId,
      username: "me",
      profile: {
        displayName: "Я",
        avatarUrl: null,
      },
    },
    attachments: [],
    reactions: [],
    replyToMessage: params.replyToMessage
      ? {
          id: params.replyToMessage.id,
          body: params.replyToMessage.body,
          deletedAt: params.replyToMessage.deletedAt,
          type: params.replyToMessage.type,
          sender: {
            username: params.replyToMessage.sender.username,
            profile: {
              displayName: params.replyToMessage.sender.profile?.displayName ?? null,
            },
          },
        }
      : null,
    receipts: [],
  };
}

function normalizeMessage(message: unknown): Message | null {
  const m = message as Message;
  if (!m?.id || !m.senderUserId || !m.sender?.id || !m.createdAt) return null;
  if (m.deletedAt) return null; 
  if (!m.receipts) m.receipts = [];
  if (!m.envelopes) m.envelopes = [];
  return m;
}

const ALLOWED_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "👎"];
const DEBUG_REALTIME = process.env.NEXT_PUBLIC_DEBUG_REALTIME === "true";
const DEBUG_MEDIA = process.env.NEXT_PUBLIC_DEBUG_MEDIA === "true" || DEBUG_REALTIME;
const NON_COPYABLE_MESSAGE_TEXTS = new Set([
  "Зашифрованное сообщение",
  "Загрузка зашифрованного сообщения…",
  "Не удалось расшифровать сообщение",
  "Сообщение недоступно на этом устройстве",
  "Сообщение доставлено",
  "Сообщение доставлено и удалено с сервера",
]);

function getCopyableMessageText(message: Message | MessageWithDecrypted | null) {
  if (!message || message.type !== "TEXT" || message.deletedAt || message.messageUnavailableOnThisDevice) {
    return null;
  }

  const text = message.body?.trim();
  if (!text || (message.isEncrypted && NON_COPYABLE_MESSAGE_TEXTS.has(text))) {
    return null;
  }

  return text;
}

function E2EEDisclaimer() {
  return (
    <div className="px-3 pb-3 pt-1">
      <Link
        href="/safety"
        className="mx-auto flex max-w-[34rem] items-start gap-3 rounded-[1.25rem] border border-border-subtle/50 bg-surface/82 px-4 py-3.5 text-left shadow-[0_10px_28px_rgba(15,23,42,0.06)] backdrop-blur-xl transition-smooth active:scale-[0.99]"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
          <svg className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M12 3.75 5.5 6.4v5.35c0 4.08 2.76 7.9 6.5 8.95 3.74-1.05 6.5-4.87 6.5-8.95V6.4L12 3.75Z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M9.6 12.2 11.3 14l3.5-4" />
          </svg>
        </span>
        <span className="text-[14px] font-semibold leading-5 text-foreground">
          Сообщения и звонки защищены сквозным шифрованием. Никто вне этого чата, даже Nox, не может читать или слушать их. Нажмите, чтобы узнать больше.
        </span>
      </Link>
    </div>
  );
}

export function ChatMessages({
  chatId,
  currentUserId,
  currentRole,
  isLocked,
  initialMessages,
  initialPinnedMessage,
  initialForwardChats,
  initialDisappearingSeconds = null,
  chatInfo,
}: {
  chatId: string;
  currentUserId: string;
  currentRole: ChatRole;
  isLocked: boolean;
  initialMessages: unknown[];
  initialPinnedMessage: Message | null;
  initialForwardChats: ForwardChatOption[];
  initialDisappearingSeconds?: number | null;
  chatInfo: {
    type: string;
    title: string | null;
    avatarUrl?: string | null;
    memberCount?: number;
    otherMember?: {
      id: string;
      displayName: string;
      avatarUrl: string | null;
      username: string;
      lastSeenAt?: string | null;
      isOnline?: boolean;
    };
  };
}) {
  const { socket, connected } = useSocket();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const partnerPresence = usePresence({
    userId: chatInfo.type === "DIRECT" ? chatInfo.otherMember?.id : null,
    initialIsOnline: chatInfo.type === "DIRECT" ? chatInfo.otherMember?.isOnline : false,
    initialLastSeenAt: chatInfo.type === "DIRECT" ? chatInfo.otherMember?.lastSeenAt ?? null : null,
  });
  
  // Seed synchronously from the RAM full-message cache so a chat opened earlier
  // this session (or warmed by the boot hydrator after reload) shows its full
  // content INSTANTLY — no skeleton, ready to read. Falls back to the SSR set
  // (pinned only) when nothing is cached. The client history loader then
  // reconciles with the network silently.
  const seedMessages = (() => {
    const cached = getChatMessages(chatId);
    const base = cached && cached.length ? cached : initialMessages;
    return base.map(normalizeMessage).filter((m): m is Message => !!m);
  })();
  const [messages, setMessages] = useState<Message[]>(() => seedMessages);

  // Messages present on first render shouldn't replay the entrance animation —
  // otherwise opening a chat fires 50 slide-ins at once. Only messages that
  // arrive afterwards animate in. Seeded with the first paint set and topped up
  // after the client-side history load resolves (see the loader effect below).
  const [initialMessageIds, setInitialMessageIds] = useState<Set<string>>(
    () => new Set(seedMessages.map((m) => m.id))
  );
  // Guard so the first client history load runs once and recomputes the
  // "unread" divider / animation-suppression set from the authoritative batch.
  const historyLoadedRef = useRef(false);

  // Cursor pagination ("load older" up the history). hasMoreOlder is set from
  // the authoritative load and from each older page. The refs guard against
  // concurrent loads and tell the auto-scroll effect to anchor instead of
  // treating a prepended page as freshly arrived messages.
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  const isPrependingRef = useRef(false);
  const messagesRef = useRef<Message[]>(seedMessages);

  // First message that was unread by me when the chat opened — we render an
  // "unread messages" divider above it (computed once, kept for the session).
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);

  // Sends that failed keep their optimistic bubble on screen, marked as failed,
  // with the original text held here so the user can retry. Previously a failed
  // send deleted the bubble outright and only surfaced a composer error, which
  // silently threw away what the user had typed.
  const [failedSends, setFailedSends] = useState<Record<string, { body: string; replyToId: string | null }>>({});

  // Surface the transport state in the UI. The socket already tracked
  // connect/disconnect; nothing rendered it, so a dropped connection was
  // invisible until a send failed.
  const [isBrowserOnline, setIsBrowserOnline] = useState(true);
  const wasDisconnectedRef = useRef(false);
  const [showRestored, setShowRestored] = useState(false);

  useEffect(() => {
    const online = () => setIsBrowserOnline(true);
    const offline = () => setIsBrowserOnline(false);
    setIsBrowserOnline(navigator.onLine);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);

  useEffect(() => {
    if (!connected) {
      wasDisconnectedRef.current = true;
      setShowRestored(false);
      return;
    }
    if (wasDisconnectedRef.current) {
      wasDisconnectedRef.current = false;
      setShowRestored(true);
      const id = setTimeout(() => setShowRestored(false), 2200);
      return () => clearTimeout(id);
    }
  }, [connected]);

  const connectionStatus: ConnectionStatus = !isBrowserOnline
    ? "offline"
    : !connected
      ? "reconnecting"
      : showRestored
        ? "restored"
        : "online";

  const [disappearingSeconds, setDisappearingSeconds] = useState<number | null>(initialDisappearingSeconds);
  const changeDisappearing = useCallback(async (seconds: number | null) => {
    const prev = disappearingSeconds;
    setDisappearingSeconds(seconds); // optimistic
    try {
      const res = await fetch(`/api/chats/${chatId}/disappearing`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: seconds ?? 0 }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      setDisappearingSeconds(prev); // revert on failure
    }
  }, [chatId, disappearingSeconds]);

  // Seed from the in-memory cache so re-opening a chat in the same session shows
  // text instantly instead of re-decrypting (no "Загрузка…" reflash).
  const [decryptedBodies, setDecryptedBodies] = useState<Record<string, string>>(() => getChatDecrypted(chatId));
  const [unavailableMessageIds, setUnavailableMessageIds] = useState<Record<string, true>>({});
  const [historyNoticeDismissed, setHistoryNoticeDismissed] = useState(false);

  // Client-side history load — the chat page no longer fetches messages on the
  // server (no RSC block). We paint instantly from the persistent cache, then
  // reconcile with the network. Optimistic (temp-) and the pinned message are
  // preserved across reconciliation.
  useEffect(() => {
    let cancelled = false;
    const pinnedId = initialPinnedMessage?.id ?? null;

    const applyBatch = (incoming: Message[], authoritative: boolean) => {
      if (cancelled || incoming.length === 0) return;
      const incomingIds = new Set(incoming.map((m) => m.id));
      setMessages((current) => {
        const keep = current.filter(
          (m) => !incomingIds.has(m.id) && (m.id.startsWith("temp-") || m.id === pinnedId),
        );
        return [...incoming, ...keep].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
      });
      if (authoritative && !historyLoadedRef.current) {
        historyLoadedRef.current = true;
        setInitialMessageIds(new Set(incoming.map((m) => m.id)));
        for (const m of incoming) {
          if (m.senderUserId !== currentUserId && (m.receipts ?? []).some((r) => r.userId === currentUserId && !r.readAt)) {
            setFirstUnreadId(m.id);
            break;
          }
        }
      }
    };

    (async () => {
      // 1) Instant paint from the persistent cache (ciphertext metadata on disk).
      if (!historyLoadedRef.current) {
        const persisted = await getPersistedChatMessages(chatId).catch(() => null);
        if (!cancelled && persisted?.messages?.length) {
          const norm = (persisted.messages as unknown[])
            .map(normalizeMessage)
            .filter((m): m is Message => !!m);
          applyBatch(norm, false);
        }
      }
      // 2) Reconcile with the network (authoritative).
      try {
        const res = await fetch(`/api/chats/${chatId}/messages`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const fresh = ((data.messages as unknown[]) ?? [])
            .map(normalizeMessage)
            .filter((m): m is Message => !!m);
          applyBatch(fresh, true);
          if (!cancelled) setHasMoreOlder(Boolean(data.hasMore));
        }
      } catch {
        // Offline — keep whatever the cache gave us.
      }
    })();

    return () => { cancelled = true; };
  }, [chatId, currentUserId, initialPinnedMessage?.id]);
  // Mirror the decryption maps in refs so the decrypt effect can read the
  // current state WITHOUT listing it as a dependency. Otherwise every decrypted
  // message re-triggers the effect, which then re-scans all messages (and hits
  // IndexedDB again) — a re-render storm that made opening a chat with history
  // feel slow. With refs the effect runs once per `messages` change.
  const decryptedBodiesRef = useRef(decryptedBodies);
  const unavailableMessageIdsRef = useRef(unavailableMessageIds);
  useEffect(() => { decryptedBodiesRef.current = decryptedBodies; }, [decryptedBodies]);
  useEffect(() => { unavailableMessageIdsRef.current = unavailableMessageIds; }, [unavailableMessageIds]);
  const plaintextByClientIdRef = useRef<Map<string, string>>(new Map());
  const [otherMemberPublicKey, setOtherMemberPublicKey] = useState<string | null>(null);
  const [myPublicKey, setMyPublicKey] = useState<string | null>(null);
  const [localDeviceId, setLocalDeviceId] = useState<string | null>(null);

  const sendDeliveryAck = useCallback(async (messageId: string, deviceId?: string | null) => {
    try {
      await fetch(`/api/messages/${messageId}/delivery-ack`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(deviceId ? { deviceId } : {}),
      });
    } catch (err) {
      console.error("[e2ee] Failed to send delivery ack", err);
    }
  }, []);

  const saveVerifiedLocalMessage = useCallback(async (message: Message, body: string, deviceId: string) => {
    return storeAndVerifyLocalEncryptedMessage({
      userId: currentUserId,
      messageId: message.id,
      chatId,
      deviceId,
      senderId: message.senderUserId,
      createdAt: message.createdAt,
      type: message.type,
      body,
    });
  }, [chatId, currentUserId]);

  // Fetch keys for decryption
  useEffect(() => {
    if (chatInfo.type === "DIRECT" && chatInfo.otherMember?.id) {
      fetchRecipientKeyBundle(chatInfo.otherMember.id).then(setOtherMemberPublicKey);
    }
    getLocalPublicJwk().then(setMyPublicKey);
    registerCurrentDevice(currentUserId)
      .then((device) => setLocalDeviceId(device.deviceId))
      .catch(() => setLocalDeviceId(null));
  }, [chatInfo.otherMember?.id, chatInfo.type, currentUserId]);

  // Decrypt messages when they arrive or keys change
  useEffect(() => {
    // Per-message decryption outcome. Merged into state in one pass after all
    // messages resolve, so we never trigger a render mid-batch.
    type DecryptResult =
      | { id: string; body: string; clearUnavailable?: boolean }
      | { id: string; unavailable: true }
      | { id: string; clearUnavailable: true }
      | null;

    async function decryptOne(msg: Message): Promise<DecryptResult> {
      // Attachments carry their own media-key flow; never show them as
      // "unavailable" here, and clear any stale flag.
      if (msg.attachments.length > 0) {
        return unavailableMessageIdsRef.current[msg.id] ? { id: msg.id, clearUnavailable: true } : null;
      }

      if (!msg.isEncrypted || msg.body || decryptedBodiesRef.current[msg.id]) return null;

      // Try local encrypted cache first. Persistent cache must never store plaintext.
      const cached = localDeviceId
        ? await getLocalEncryptedMessage({ userId: currentUserId, messageId: msg.id, chatId, deviceId: localDeviceId }).catch(() => null)
        : null;
      if (cached) {
        if ((msg.encryptionVersion ?? 0) >= 2 && localDeviceId) {
          const envelope = msg.envelopes?.find((item) => item.recipientDeviceId === localDeviceId);
          if (envelope?.ciphertext && !envelope.encryptedPayloadDeletedAt) {
            void sendDeliveryAck(msg.id, localDeviceId);
          }
        }
        return { id: msg.id, body: cached.body, clearUnavailable: true };
      }

      if ((msg.encryptionVersion ?? 0) >= 2) {
        if (!localDeviceId) return null;
        const envelope = msg.envelopes?.find((item) => item.recipientDeviceId === localDeviceId);
        if (!envelope || !envelope.ciphertext || !envelope.iv || !envelope.salt) {
          return { id: msg.id, unavailable: true };
        }

        const decrypted = await decryptMessageV2({
          chatId,
          senderUserId: msg.senderUserId,
          senderDeviceId: envelope.senderDeviceId,
          envelope: {
            recipientUserId: envelope.recipientUserId,
            recipientDeviceId: envelope.recipientDeviceId,
            ciphertext: envelope.ciphertext,
            iv: envelope.iv,
            salt: envelope.salt,
            algorithm: envelope.algorithm,
            encryptionVersion: envelope.encryptionVersion,
          },
        });

        if (decrypted) {
          try {
            await saveVerifiedLocalMessage(msg, decrypted, localDeviceId);
          } catch (error) {
            console.error("[e2ee] Failed to save local encrypted cache", error);
            return null;
          }
          void sendDeliveryAck(msg.id, localDeviceId);
          return { id: msg.id, body: decrypted, clearUnavailable: true };
        }
        return { id: msg.id, body: "Не удалось расшифровать сообщение" };
      }

      // Legacy v1: If no server payload, cannot decrypt
      if (!msg.ciphertext) return null;

      const recipientUserId = msg.senderUserId === currentUserId
        ? chatInfo.otherMember?.id
        : currentUserId;
      const senderKey = msg.senderUserId === currentUserId ? myPublicKey : otherMemberPublicKey;
      if (!recipientUserId || !senderKey) return null;

      const decrypted = await decryptMessage(
        {
          ciphertext: msg.ciphertext || null,
          iv: msg.iv || null,
          salt: msg.salt || null,
          chatId,
          senderUserId: msg.senderUserId,
          recipientUserId,
          algorithm: msg.algorithm || null,
          encryptionVersion: msg.encryptionVersion || null,
        },
        senderKey
      );

      if (decrypted) {
        if (localDeviceId) {
          if (msg.senderUserId !== currentUserId) {
            try {
              await saveVerifiedLocalMessage(msg, decrypted, localDeviceId);
              if (!msg.deliveredAt) void sendDeliveryAck(msg.id);
            } catch (error) {
              console.error("[e2ee] Failed to save local encrypted cache", error);
            }
          } else {
            // Also store own sent messages for local history, encrypted at rest.
            await saveVerifiedLocalMessage(msg, decrypted, localDeviceId).catch((error) => {
              console.error("[e2ee] Failed to save local encrypted cache", error);
            });
          }
        }
        return { id: msg.id, body: decrypted };
      }
      if (msg.senderUserId !== currentUserId) {
        return { id: msg.id, body: "Не удалось расшифровать сообщение" };
      }
      return null;
    }

    async function decryptAll() {
      // Decrypt every message concurrently. The old serial loop awaited each
      // IndexedDB read + ECDH/AES one-by-one, so a 50-message chat paid 50×
      // round-trips in sequence — that's the long "Загрузка зашифрованного
      // сообщения…" delay. Promise.all collapses it to roughly one batch.
      const results = await Promise.all(messages.map(decryptOne));

      const newDecrypted: Record<string, string> = { ...decryptedBodiesRef.current };
      const newUnavailable: Record<string, true> = { ...unavailableMessageIdsRef.current };
      let changed = false;
      let unavailableChanged = false;

      for (const result of results) {
        if (!result) continue;
        if ("body" in result && newDecrypted[result.id] !== result.body) {
          newDecrypted[result.id] = result.body;
          changed = true;
        }
        if ("unavailable" in result && !newUnavailable[result.id]) {
          newUnavailable[result.id] = true;
          unavailableChanged = true;
        }
        if ("clearUnavailable" in result && result.clearUnavailable && newUnavailable[result.id]) {
          delete newUnavailable[result.id];
          unavailableChanged = true;
        }
      }

      if (changed) {
        setDecryptedBodies(newDecrypted);
      }
      if (unavailableChanged) {
        setUnavailableMessageIds(newUnavailable);
      }
    }

    decryptAll();
    // decryptedBodies/unavailableMessageIds are intentionally read via refs (not
    // deps) to avoid a re-run storm — see the refs declared above.
  }, [messages, otherMemberPublicKey, myPublicKey, chatId, currentUserId, chatInfo.otherMember?.id, localDeviceId, saveVerifiedLocalMessage, sendDeliveryAck]);

  // --- outgoing message delivery -------------------------------------------
  //
  // Sending used to live in a callback on this component, which meant leaving
  // the screen destroyed the in-flight state. It now belongs to a controller
  // that outlives the screen; this component only supplies the transport and
  // renders whatever the controller holds.

  /** Canonical messages the transport has fetched, awaiting the commit callback. */
  const committedByClientIdRef = useRef<Map<string, Message>>(new Map());

  /** Where accepted-but-not-yet-uploaded attachment bytes live. */
  const outboxBlobs = useMemo(() => createIndexedDbOutboxBlobStore(currentUserId), [currentUserId]);

  const sendTransport = useCallback<DeliveryTransport>(async ({ clientMessageId, body, replyToMessageId, attachment }) => {
    if (attachment) {
      return sendStagedAttachment({
        clientMessageId,
        attachment,
        caption: body,
        blobs: outboxBlobs,
        chatId,
        currentUserId,
        chatType: chatInfo.type,
        otherMemberId: chatInfo.otherMember?.id ?? null,
        onNormalized: (message) => committedByClientIdRef.current.set(clientMessageId, message),
      });
    }

    let payload: Record<string, unknown>;
    try {
      // `replyToMessageId` is optional on the wire, not nullable — sending an
      // explicit null is rejected with a 400, which the controller then treats
      // as permanent and the message never leaves the device.
      const reply = replyToMessageId ? { replyToMessageId } : {};
      if (chatInfo.type === "DIRECT" && chatInfo.otherMember?.id) {
        const encrypted = await encryptMessageForDevices(body, chatInfo.otherMember.id, chatId, currentUserId);
        payload = { ...encrypted, type: "TEXT", ...reply, clientId: clientMessageId };
        plaintextByClientIdRef.current.set(clientMessageId, body);
      } else {
        payload = { body, ...reply, clientId: clientMessageId };
      }
    } catch (error) {
      // A device that cannot seal this message will not seal it on a retry
      // either — repeating the identical request only burns the budget.
      console.error("[e2ee] Encryption failed before message POST", error);
      return { ok: false, errorCode: "ENCRYPT_FAILED", retryable: false };
    }

    let response: Response;
    try {
      response = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      plaintextByClientIdRef.current.delete(clientMessageId);
      return { ok: false, errorCode: "NETWORK", retryable: true };
    }

    if (!response.ok) {
      plaintextByClientIdRef.current.delete(clientMessageId);
      // 4xx is the server saying no; only 408/429 and 5xx are worth repeating.
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      return { ok: false, errorCode: `HTTP_${response.status}`, retryable };
    }

    const data = await response.json().catch(() => null);
    const normalized = data ? normalizeMessage(data.message) : null;
    if (!normalized) {
      plaintextByClientIdRef.current.delete(clientMessageId);
      return { ok: false, errorCode: "BAD_RESPONSE", retryable: false };
    }

    committedByClientIdRef.current.set(clientMessageId, normalized);
    // A 2xx is the commit. The socket echo, if it comes, only reconciles.
    return {
      ok: true,
      message: { id: normalized.id, clientId: clientMessageId, body, createdAt: normalized.createdAt },
    };
  }, [chatId, chatInfo.otherMember, chatInfo.type, currentUserId, outboxBlobs]);

  const handleCommitted = useCallback((server: ServerMessage, clientMessageId: string) => {
    const normalized = committedByClientIdRef.current.get(clientMessageId);
    committedByClientIdRef.current.delete(clientMessageId);
    plaintextByClientIdRef.current.delete(clientMessageId);
    if (!normalized) return;

    setMessages((current) => {
      const exists = current.some((message) => message.id === normalized.id);
      return exists
        ? current.map((message) => (message.id === normalized.id ? normalized : message))
        : [...current, normalized];
    });

    const plaintext = server.body;
    if (normalized.isEncrypted && plaintext) {
      setDecryptedBodies((current) => ({ ...current, [normalized.id]: plaintext }));
      if ((normalized.encryptionVersion ?? 0) >= 2 && localDeviceId) {
        void saveVerifiedLocalMessage(normalized, plaintext, localDeviceId)
          .then(() => sendDeliveryAck(normalized.id, localDeviceId))
          .catch((error) => {
            // The message is committed on the server either way; only the local
            // cache is missing, which the next open re-fetches.
            console.error("[e2ee] Failed to save local encrypted cache", error);
          });
      }
    }
  }, [localDeviceId, saveVerifiedLocalMessage, sendDeliveryAck]);

  const delivery = useMessageDelivery({
    chatId,
    userId: currentUserId,
    transport: sendTransport,
    blobs: outboxBlobs,
    onCommitted: handleCommitted,
  });

  // Object URLs for attachments that are still only on this device. They are
  // rebuilt from the outbox rather than kept from the original File, so a
  // reload during an upload still shows the picture instead of a blank bubble.
  const [pendingAttachmentUrls, setPendingAttachmentUrls] = useState<Record<string, string>>({});
  const pendingUrlsRef = useRef<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const wanted = new Set(delivery.pending.filter((message) => message.attachment).map((message) => message.clientMessageId));

    for (const [clientMessageId, url] of Object.entries(pendingUrlsRef.current)) {
      if (wanted.has(clientMessageId)) continue;
      URL.revokeObjectURL(url);
      delete pendingUrlsRef.current[clientMessageId];
      setPendingAttachmentUrls((current) => {
        const next = { ...current };
        delete next[clientMessageId];
        return next;
      });
    }

    for (const clientMessageId of wanted) {
      if (pendingUrlsRef.current[clientMessageId]) continue;
      void outboxBlobs
        .get(clientMessageId)
        .then((blob) => {
          if (cancelled || !blob || pendingUrlsRef.current[clientMessageId]) return;
          const url = URL.createObjectURL(blob);
          pendingUrlsRef.current[clientMessageId] = url;
          setPendingAttachmentUrls((current) => ({ ...current, [clientMessageId]: url }));
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
  }, [delivery.pending, outboxBlobs]);

  // The socket effect must not re-subscribe every time delivery state changes,
  // so it reaches the controller through a ref kept current in an effect.
  const deliveryRef = useRef<typeof delivery | null>(null);
  useEffect(() => {
    deliveryRef.current = delivery;
  }, [delivery]);

  const messagesWithDecrypted = useMemo(() => {
    const canonical = messages.map(msg => ({
      ...msg,
      body: msg.body || decryptedBodies[msg.id] || (msg.isEncrypted ? ((msg.encryptionVersion ?? 0) >= 2 ? "" : msg.ciphertext ? "Зашифрованное сообщение" : "") : msg.body || ""),
      messageUnavailableOnThisDevice: msg.attachments.length === 0 && Boolean(unavailableMessageIds[msg.id]),
    })) as MessageWithDecrypted[];

    // Messages the server has not confirmed are rendered from the controller,
    // not from component state, so they survive leaving and re-entering the
    // chat. One already present in `messages` is not drawn twice.
    const overlay = delivery.pending
      .filter((outgoing) => !canonical.some((message) => message.id === outgoing.serverId))
      .map((outgoing) => {
        const replyTarget = outgoing.replyToMessageId
          ? messages.find((message) => message.id === outgoing.replyToMessageId) ?? null
          : null;
        const base = createOptimisticMessage({
          clientId: outgoing.clientMessageId,
          body: outgoing.body,
          currentUserId,
          replyToMessage: replyTarget,
        });
        // A pending attachment renders from its staged metadata, so the bubble
        // looks the same before and after the upload — and still looks right
        // after a reload, when the original File no longer exists.
        const attachment = outgoing.attachment
          ? [{
              id: `temp-${outgoing.clientMessageId}`,
              fileName: outgoing.attachment.fileName,
              mimeType: outgoing.attachment.mimeType,
              sizeBytes: outgoing.attachment.sizeBytes,
              url: pendingAttachmentUrls[outgoing.clientMessageId] ?? "",
            }]
          : [];
        return {
          ...base,
          type: outgoing.attachment ? outgoing.attachment.kind : base.type,
          attachments: attachment,
          createdAt: outgoing.createdAt,
          messageUnavailableOnThisDevice: false,
        } as MessageWithDecrypted;
      });

    return overlay.length > 0 ? [...canonical, ...overlay] : canonical;
  }, [messages, decryptedBodies, unavailableMessageIds, delivery.pending, currentUserId]);

  // Persist decrypted bodies to the in-memory cache so a later re-open seeds
  // instantly (RAM only — see chat-cache.ts).
  useEffect(() => {
    putChatDecrypted(chatId, decryptedBodies);
  }, [chatId, decryptedBodies]);

  // Cache the chat header + a tail preview so the route loading.tsx can paint
  // the real last messages instantly on the next open instead of gray bars.
  const headerCache = useMemo(() => ({
    title: chatInfo.type === "DIRECT"
      ? (chatInfo.otherMember?.displayName ?? chatInfo.title ?? "Чат")
      : (chatInfo.title ?? "Группа"),
    avatarUrl: chatInfo.type === "DIRECT"
      ? (chatInfo.otherMember?.avatarUrl ?? null)
      : (chatInfo.avatarUrl ?? null),
    isSelfChat: chatInfo.type === "DIRECT" && !chatInfo.otherMember,
  }), [chatInfo]);

  useEffect(() => {
    putChatHeader(chatId, headerCache);
  }, [chatId, headerCache]);

  // Keep the synchronous RAM full-message cache fresh so re-opening this chat
  // (same session) paints instantly with full content — no skeleton.
  useEffect(() => {
    if (messages.length > 0) putChatMessages(chatId, messages);
  }, [chatId, messages]);

  // Persist ciphertext message metadata + header to IndexedDB (debounced) so a
  // cold start (after reload) can hydrate the RAM cache and open chats instantly.
  // Plaintext is never written here — decrypted bodies stay encrypted-at-rest in
  // the separate messages store.
  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      void putPersistedChatMessages(chatId, {
        messages: messages.slice(-50),
        header: headerCache,
        ts: Date.now(),
      }).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [chatId, messages, headerCache]);

  useEffect(() => {
    const preview = messagesWithDecrypted
      .filter((msg) => !msg.deletedAt)
      .map((msg) => {
        let text = msg.body?.trim() || "";
        if (!text) {
          if (msg.type === "IMAGE") text = "Фото";
          else if (msg.type === "VIDEO") text = "Видео";
          else if (msg.type === "VIDEO_NOTE") text = "Видеосообщение";
          else if (msg.type === "VOICE") text = "Голосовое сообщение";
          else if (msg.type === "FILE") text = "Файл";
          else text = "Сообщение";
        }
        return { id: msg.id, mine: msg.senderUserId === currentUserId, text };
      });
    putChatPreview(chatId, preview);
  }, [chatId, messagesWithDecrypted, currentUserId]);

  const [pending, setPending] = useState(false);
  // Uploads no longer block the composer: the controller owns the upload and
  // the bubble shows its own progress, so the user can keep typing.
  const [composerError, setComposerError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, { displayName: string; timeoutId: ReturnType<typeof setTimeout> }>>({});
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [menuState, setMenuState] = useState<{ id: string; rect: DOMRect; readers?: { name: string; avatarUrl: string | null }[] } | null>(null);
  // Whether the quick reaction strip has morphed into the full emoji picker
  // (chevron tap). Reset explicitly on every long-press open below.
  const [reactionPickerExpanded, setReactionPickerExpanded] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<File[]>([]);

  const [showScrollDown, setShowScrollDown] = useState(false);
  const [unseenCount, setUnseenCount] = useState(0);
  const prevMessageCountRef = useRef(messages.length);

  const forceScrollBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
    setShowScrollDown(false);
    setUnseenCount(0);
  }, []);

  // Keep a live reference to messages so loadOlder can read the current oldest
  // id without re-creating on every message change.
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  // Load one older page above the current history, then anchor the scroll so the
  // message the user was looking at stays put (overflowAnchor is disabled on the
  // container, so we restore scrollTop by the height delta manually).
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || !hasMoreOlder) return;
    const oldest = messagesRef.current.find((m) => !m.id.startsWith("temp-"));
    if (!oldest) return;
    const container = scrollContainerRef.current;
    const prevHeight = container?.scrollHeight ?? 0;
    const prevTop = container?.scrollTop ?? 0;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const res = await fetch(
        `/api/chats/${chatId}/messages?before=${encodeURIComponent(oldest.id)}&limit=30`,
        { cache: "no-store" },
      );
      if (!res.ok) return;
      const data = await res.json();
      const older = ((data.messages as unknown[]) ?? [])
        .map(normalizeMessage)
        .filter((m): m is Message => !!m);
      setHasMoreOlder(Boolean(data.hasMore));
      if (older.length > 0) {
        isPrependingRef.current = true;
        setMessages((current) => {
          const ids = new Set(current.map((m) => m.id));
          const merged = [...older.filter((m) => !ids.has(m.id)), ...current];
          return merged.sort(
            (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
          );
        });
        requestAnimationFrame(() => {
          const c = scrollContainerRef.current;
          if (c) c.scrollTop = prevTop + (c.scrollHeight - prevHeight);
        });
      }
    } catch {
      // Offline / failed — keep the history we already have.
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [chatId, hasMoreOlder]);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    isAtBottomRef.current = atBottom;
    setShowScrollDown(scrollHeight - scrollTop - clientHeight > 400);
    if (atBottom) setUnseenCount(0);
    // Near the top — pull in the previous page.
    if (scrollTop < 320) void loadOlder();
  }, [loadOlder]);

  useEffect(() => {
    const grew = messages.length - prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;
    if (isPrependingRef.current) {
      // Older history was prepended — don't auto-scroll or count it as unseen.
      isPrependingRef.current = false;
      return;
    }
    if (isAtBottomRef.current) {
      forceScrollBottom("smooth");
    } else if (grew > 0) {
      // New messages arrived while the user is scrolled up — count them.
      setUnseenCount((n) => n + grew);
    }
  }, [messages, forceScrollBottom]);

  const handleLongPress = useCallback(async (id: string, rect: DOMRect) => {
    if (isSelectionMode) return;
    setMenuState({ id, rect });
    setReactionPickerExpanded(false);
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(40);

    if (chatInfo.type === "GROUP") {
      try {
        const response = await fetch(`/api/messages/${id}/readers`);
        if (response.ok) {
          const data = await response.json();
          setMenuState(prev => prev && prev.id === id ? { ...prev, readers: data.readers } : prev);
        }
      } catch (err) {
        console.error("Failed to fetch readers", err);
      }
    }
  }, [isSelectionMode, chatInfo.type]);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [pinnedMessage, setPinnedMessage] = useState<Message | null>(initialPinnedMessage);
  const [forwardingMessages, setForwardingMessages] = useState<Message[] | null>(null);
  // Forward-target list is loaded lazily (only when the forward picker opens) so the
  // chat page no longer pays a heavy "all chats" query on every open.
  const [recentChats, setRecentChats] = useState<ForwardChatOption[]>(initialForwardChats);
  const [recentChatsLoading, setRecentChatsLoading] = useState(false);
  const recentChatsLoadedRef = useRef(initialForwardChats.length > 0);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
  // The action overlay is portalled to document.body and the forward picker is
  // rendered inline; both are driven from here, so both traps live here too.
  const actionOverlayRef = useFocusTrap<HTMLDivElement>(Boolean(menuState), () => setMenuState(null));
  const forwardPickerRef = useFocusTrap<HTMLDivElement>(showForwardPicker, () => setShowForwardPicker(false));
  const [isForwarding, setIsForwarding] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Message Search State
  const [isSearchOpen, setIsSearchOpen] = useState(() => searchParams.get("search") === "true");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultMessage[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(() => searchParams.get("highlightMessageId"));

  useEffect(() => {
    const highlightId = searchParams.get("highlightMessageId");
    if (highlightId) {
      const jumpWithRetry = (retries = 5) => {
        const el = messageRefs.current[highlightId];
        if (el) {
          el.scrollIntoView({ behavior: "auto", block: "center" });
          setHighlightedId(highlightId);
          setTimeout(() => setHighlightedId(null), 3000);
          
          // Clear param from URL without reload
          const url = new URL(window.location.href);
          url.searchParams.delete("highlightMessageId");
          window.history.replaceState({}, '', url.toString());
        } else if (retries > 0) {
          setTimeout(() => jumpWithRetry(retries - 1), 100);
        }
      };
      jumpWithRetry();
    }
  }, [searchParams]);

  const { settings, updateSettings, resetSettings } = useChatAppearance(chatId);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const initialScrollDoneRef = useRef(false);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingCancelledRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);

  const debugRealtime = useCallback((label: string, data: Record<string, unknown> = {}) => {
    if (!DEBUG_REALTIME) {
      return;
    }

    console.log(`[realtime-client] ${label}`, data);
  }, []);

  const debugMedia = useCallback((label: string, data: Record<string, unknown> = {}) => {
    if (!DEBUG_MEDIA) {
      return;
    }

    console.log(`[media] ${label}`, data);
  }, []);

  const markAsRead = useCallback(async () => {
    try {
      await fetch(`/api/chats/${chatId}/read`, { method: "POST" });
    } catch {
      // silenced
    }
  }, [chatId]);

  useEffect(() => {
    const frameId = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frameId);
  }, []);

  useEffect(() => {
    if (pathname === `/chats/${chatId}`) {
      return;
    }

    const rafId = requestAnimationFrame(() => {
      setMenuState(null);
      setIsAppearanceOpen(false);
      setSelectedMedia(null);
      setShowForwardPicker(false);
      setEditingMessage(null);
      setReplyingToMessage(null);
      setIsSelectionMode(false);
      setSelectedIds(new Set());
    });
    document.body.style.overflow = "";
    document.body.style.pointerEvents = "";
    document.body.classList.remove("hide-bottom-nav", "modal-open", "chat-active");
    return () => cancelAnimationFrame(rafId);
  }, [chatId, pathname]);

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
      }
      mediaRecorderRef.current?.stream?.getTracks().forEach((track) => track.stop());
      document.body.style.overflow = "";
      document.body.style.pointerEvents = "";
      document.body.classList.remove("hide-bottom-nav", "modal-open", "chat-active");
    };
  }, []);

  const jumpToMessage = useCallback((id: string) => {
    const el = messageRefs.current[id];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedId(id);
      setTimeout(() => setHighlightedId(null), 2500);
      setIsSearchOpen(false);
    }
  }, []);

  useEffect(() => {
    const isSearchParam = searchParams.get("search") === "true";
    if (isSearchParam && !isSearchOpen) {
      setTimeout(() => setIsSearchOpen(true), 0);
    }
  }, [searchParams, isSearchOpen]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      const t = setTimeout(() => setSearchResults([]), 0);
      searchAbortRef.current?.abort();
      return () => clearTimeout(t);
    }
    const t = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const res = await fetch(`/api/chats/${chatId}/search?q=${encodeURIComponent(searchQuery)}`, {
          signal: controller.signal
        });
        const data = await res.json();
        
        const q = searchQuery.toLowerCase();
        const localMatches = messagesWithDecrypted
          .filter((m) => m.isEncrypted && m.body && m.body.toLowerCase().includes(q))
          .map((m) => ({
            id: m.id,
            body: m.body,
            createdAt: m.createdAt,
            senderName: m.sender.profile?.displayName || m.sender.username,
          }));

        const merged = [...localMatches, ...(data.messages || [])];
        const unique = Array.from(new Map(merged.map(m => [m.id, m])).values()) as SearchResultMessage[];

        setSearchResults(unique.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error("Search failed", err);
        }
      }
    }, 400);
    return () => {
      clearTimeout(t);
      searchAbortRef.current?.abort();
    };
  }, [searchQuery, chatId, messagesWithDecrypted]);

  useEffect(() => {
    initialScrollDoneRef.current = false;
    let frameId: number;
    const stabilize = () => {
       forceScrollBottom("auto");
       if (!initialScrollDoneRef.current) frameId = requestAnimationFrame(stabilize);
    };
    stabilize();
    const t1 = setTimeout(() => forceScrollBottom("auto"), 100);
    const t2 = setTimeout(() => {
      forceScrollBottom("auto");
      initialScrollDoneRef.current = true;
    }, 240);
    void markAsRead();
    return () => { cancelAnimationFrame(frameId); clearTimeout(t1); clearTimeout(t2); };
  }, [chatId, forceScrollBottom, markAsRead]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      if (next.size === 0) setIsSelectionMode(false);
      return next;
    });
  }, []);

  const startSelection = useCallback((id: string) => {
    setIsSelectionMode(true);
    setSelectedIds(new Set([id]));
    setMenuState(null);
  }, []);

  // Stable reference so memo() on MessageBubble isn't defeated (otherwise every
  // bubble re-renders on each parent state change — typing, scroll, etc.).
  const handleSwipeReply = useCallback((message: Message) => {
    setEditingMessage(null);
    setReplyingToMessage(message);
  }, []);

  const handleDeleteQuietly = useCallback(async (id: string) => {
    setMenuState(null);
    setComposerError("");

    try {
      const response = await fetch(`/api/messages/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось удалить сообщение.");
      }
      setMessages((current) => current.filter((message) => message.id !== id));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Не удалось удалить сообщение.");
    }
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    setComposerError("");

    const results = await Promise.all(ids.map(async (id) => {
      try {
        const response = await fetch(`/api/messages/${id}`, { method: "DELETE" });
        return response.ok ? id : null;
      } catch {
        return null;
      }
    }));
    const deletedIds = new Set(results.filter((id): id is string => Boolean(id)));
    const failedIds = ids.filter((id) => !deletedIds.has(id));

    if (deletedIds.size > 0) {
      setMessages((current) => current.filter((message) => !deletedIds.has(message.id)));
    }
    if (failedIds.length > 0) {
      setSelectedIds(new Set(failedIds));
      setComposerError(
        failedIds.length === 1
          ? "Не удалось удалить сообщение."
          : `Не удалось удалить сообщений: ${failedIds.length}.`,
      );
      return;
    }

    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, [selectedIds]);

  const togglePin = useCallback(async (message: Message) => {
    const previousPinnedMessage = pinnedMessage;
    const nextPinnedMessage = previousPinnedMessage?.id === message.id ? null : message;
    setPinnedMessage(nextPinnedMessage);
    setMenuState(null);

    try {
      const response = await fetch(`/api/chats/${chatId}/pinned-message`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageId: nextPinnedMessage?.id ?? null }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось обновить закреплённое сообщение");
      }
    } catch (error) {
      setPinnedMessage(previousPinnedMessage);
      setComposerError(error instanceof Error ? error.message : "Не удалось обновить закреплённое сообщение");
    }
  }, [chatId, pinnedMessage]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.readOnly = true;
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setToastMessage("Скопировано");
      setTimeout(() => setToastMessage(null), 2000);
    } catch {
      setToastMessage("Не удалось скопировать");
      setTimeout(() => setToastMessage(null), 2000);
    }
    setMenuState(null);
  }, []);

  const loadForwardChats = useCallback(async () => {
    if (recentChatsLoadedRef.current) return;
    recentChatsLoadedRef.current = true;
    setRecentChatsLoading(true);
    try {
      const res = await fetch("/api/chats", { cache: "no-store" });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      type ApiChat = {
        id: string;
        type: "DIRECT" | "GROUP";
        title: string | null;
        otherMember: { displayName?: string | null; username?: string | null; avatarUrl: string | null } | null;
      };
      const options: ForwardChatOption[] = ((data.chats ?? []) as ApiChat[])
        .filter((c) => c.id !== chatId)
        .map((c) => ({
          id: c.id,
          title: c.type === "DIRECT"
            ? (c.otherMember?.displayName ?? c.otherMember?.username ?? "Чат")
            : (c.title ?? "Группа"),
          avatarUrl: c.type === "DIRECT" ? (c.otherMember?.avatarUrl ?? null) : null,
        }));
      setRecentChats(options);
    } catch {
      recentChatsLoadedRef.current = false; // allow retry on next open
    } finally {
      setRecentChatsLoading(false);
    }
  }, [chatId]);

  const initiateForward = useCallback((msg: Message | Message[]) => {
    setForwardingMessages(Array.isArray(msg) ? msg : [msg]);
    setShowForwardPicker(true);
    setMenuState(null);
    void loadForwardChats();
  }, [loadForwardChats]);

  const confirmForward = useCallback(async (targetChatId: string) => {
    if (!forwardingMessages || forwardingMessages.length === 0) return;
    setIsForwarding(true);
    setComposerError(null);

    try {
      const response = await fetch("/api/messages/forward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetChatId,
          messageIds: forwardingMessages.map((message) => message.id),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось переслать сообщение");
      }
      const data = await response.json().catch(() => null);

      if (targetChatId === chatId && Array.isArray(data?.messages)) {
        setMessages((current) => {
          const next = [...current];
          for (const item of data.messages) {
            const normalized = normalizeMessage(item);
            if (!normalized || next.some((message) => message.id === normalized.id)) {
              continue;
            }
            next.push(normalized);
          }
          return next;
        });
      }

      setShowForwardPicker(false);
      setForwardingMessages(null);
      setIsSelectionMode(false);
      setSelectedIds(new Set());
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Не удалось переслать сообщение");
    } finally {
      setIsForwarding(false);
    }
  }, [chatId, forwardingMessages]);

  useEffect(() => {
    if (!socket) return;
    debugRealtime("chat mounted", { chatId });

    const syncActiveChat = () => {
      socket.emit("chat:join", chatId, (response?: { ok?: boolean }) => {
        debugRealtime("chat:join emitted", { chatId, ok: response?.ok ?? null });
      });
      socket.emit("chat:active", { chatId }, (response?: { ok?: boolean }) => {
        debugRealtime("chat:active emitted", { chatId, ok: response?.ok ?? null });
      });
    };

    const handleNewMessage = (payload: { chatId: string; message: unknown; clientId?: string | null }) => {
      if (payload.chatId !== chatId) return;
      const normalized = normalizeMessage(payload.message);
      if (!normalized) {
        return;
      }

      debugRealtime("message:new received", { messageId: normalized.id, chatId: payload.chatId });
      const localPlaintext = payload.clientId ? plaintextByClientIdRef.current.get(payload.clientId) : null;
      if (localPlaintext) {
        plaintextByClientIdRef.current.delete(payload.clientId as string);
        setDecryptedBodies((current) => ({ ...current, [normalized.id]: localPlaintext }));
        if (localDeviceId) {
          void saveVerifiedLocalMessage(normalized, localPlaintext, localDeviceId)
            .then(() => {
              if ((normalized.encryptionVersion ?? 0) >= 2) {
                return sendDeliveryAck(normalized.id, localDeviceId);
              }
            })
            .catch((error) => {
              console.error("[e2ee] Failed to save local encrypted cache", error);
              setComposerError("Не удалось сохранить сообщение на устройстве.");
            });
        }
      }
      // If this echo belongs to a message we sent, the controller folds it onto
      // the entry that is already there — it never adds a bubble. The optimistic
      // overlay disappears on its own once the controller holds a server id.
      deliveryRef.current?.ingestServerMessage({
        id: normalized.id,
        clientId: payload.clientId ?? null,
        body: localPlaintext ?? normalized.body,
        createdAt: normalized.createdAt,
      });

      setMessages((current) => {
        const exists = current.some((message) => message.id === normalized.id);
        debugRealtime(exists ? "message deduped" : "message appended", { messageId: normalized.id, chatId: payload.chatId });
        return exists ? current.map((message) => (message.id === normalized.id ? normalized : message)) : [...current, normalized];
      });

      if (normalized.senderUserId !== currentUserId) {
        void markAsRead();
      }
    };

    const handleDeletedMessage = (payload: { chatId: string; messageId: string }) => {
      if (payload.chatId !== chatId) return;
      setMessages((current) => current.filter((message) => message.id !== payload.messageId));
    };

    const handleUpdatedMessage = (payload: { chatId: string; message: unknown }) => {
      if (payload.chatId !== chatId) return;
      const normalized = normalizeMessage(payload.message);
      if (!normalized) {
        return;
      }
      setMessages((current) => current.map((message) => (message.id === normalized.id ? normalized : message)));
    };

    const handleReactionsUpdated = (payload: { chatId: string; messageId: string; reactions: Message["reactions"] }) => {
      if (payload.chatId !== chatId) return;
      setMessages((current) =>
        current.map((message) => (message.id === payload.messageId ? { ...message, reactions: payload.reactions } : message)),
      );
    };

    const handleReceiptsUpdated = (payload: { chatId: string; userId: string; deliveredAt?: string | Date | null; readAt?: string | Date | null }) => {
      if (payload.chatId !== chatId) return;
      if (payload.userId === currentUserId) {
        debugRealtime("receipts ignored for current user", { chatId, userId: payload.userId });
        return;
      }
      const deliveredAt = payload.deliveredAt ? new Date(payload.deliveredAt).toISOString() : null;
      const readAt = payload.readAt ? new Date(payload.readAt).toISOString() : null;
      setMessages((current) =>
        current.map((message) => {
          if (message.senderUserId !== currentUserId) {
            return message;
          }

          const existingReceipt = message.receipts.find((receipt) => receipt.userId === payload.userId);
          if (existingReceipt) {
            return {
              ...message,
              receipts: message.receipts.map((receipt) =>
                receipt.userId === payload.userId
                  ? {
                      ...receipt,
                      deliveredAt: deliveredAt ?? receipt.deliveredAt,
                      readAt: readAt ?? receipt.readAt,
                    }
                  : receipt,
              ),
            };
          }

          return {
            ...message,
            receipts: [
              ...message.receipts,
              {
                userId: payload.userId,
                deliveredAt,
                readAt,
              },
            ],
          };
        }),
      );
    };

    const handleTypingUpdate = (payload: { chatId: string; userId: string; displayName: string; isTyping: boolean }) => {
      if (payload.chatId !== chatId || payload.userId === currentUserId) return;
      setTypingUsers((current) => {
        const next = { ...current };
        if (payload.isTyping) {
          if (next[payload.userId]?.timeoutId) {
            clearTimeout(next[payload.userId].timeoutId);
          }
          const timeoutId = setTimeout(() => {
            setTypingUsers((prev) => {
              const cleared = { ...prev };
              delete cleared[payload.userId];
              return cleared;
            });
          }, 5000);
          next[payload.userId] = { displayName: payload.displayName, timeoutId };
        } else {
          if (next[payload.userId]?.timeoutId) {
            clearTimeout(next[payload.userId].timeoutId);
          }
          delete next[payload.userId];
        }
        return next;
      });
    };

    const handlePinnedMessageUpdated = (payload: { chatId: string; pinnedMessage: unknown | null }) => {
      if (payload.chatId !== chatId) return;
      const normalizedPinnedMessage = payload.pinnedMessage ? normalizeMessage(payload.pinnedMessage) : null;
      setPinnedMessage(normalizedPinnedMessage);

      if (normalizedPinnedMessage) {
        setMessages((current) => {
          const exists = current.some((message) => message.id === normalizedPinnedMessage.id);
          return exists ? current : [...current, normalizedPinnedMessage];
        });
      }
    };

    syncActiveChat();
    socket.on("connect", syncActiveChat);
    socket.on("message:new", handleNewMessage);
    socket.on("message:deleted", handleDeletedMessage);
    socket.on("message:updated", handleUpdatedMessage);
    socket.on("message:reactions-updated", handleReactionsUpdated);
    socket.on("message:receipts-updated", handleReceiptsUpdated);
    socket.on("typing:update", handleTypingUpdate);
    socket.on("chat:pinned-message-updated", handlePinnedMessageUpdated);
    const handleDisappearingUpdated = (payload: { chatId: string; disappearingSeconds: number | null }) => {
      if (payload?.chatId === chatId) setDisappearingSeconds(payload.disappearingSeconds ?? null);
    };
    socket.on("chat:disappearing-updated", handleDisappearingUpdated);
    return () => {
      socket.emit("chat:inactive", { chatId });
      socket.emit("chat:leave", chatId);
      socket.off("connect", syncActiveChat);
      socket.off("message:new", handleNewMessage);
      socket.off("message:deleted", handleDeletedMessage);
      socket.off("message:updated", handleUpdatedMessage);
      socket.off("message:reactions-updated", handleReactionsUpdated);
      socket.off("message:receipts-updated", handleReceiptsUpdated);
      socket.off("typing:update", handleTypingUpdate);
      socket.off("chat:pinned-message-updated", handlePinnedMessageUpdated);
      socket.off("chat:disappearing-updated", handleDisappearingUpdated);
    };
  }, [chatId, currentUserId, debugRealtime, localDeviceId, markAsRead, saveVerifiedLocalMessage, sendDeliveryAck, socket]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      const response = await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось обновить реакцию.");
      }
      setMenuState(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Не удалось обновить реакцию.");
    }
  }, []);

  const handleTyping = useCallback((text: string) => {
    if (!socket) return;

    if (text.length > 0) {
      if (!isTypingLocal) {
        setIsTypingLocal(true);
        socket.emit("typing:start", { chatId });
      }
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        setIsTypingLocal(false);
        socket.emit("typing:stop", { chatId });
      }, 3000);
    } else if (isTypingLocal) {
      setIsTypingLocal(false);
      socket.emit("typing:stop", { chatId });
    }
  }, [chatId, isTypingLocal, socket]);

  /**
   * Hands a file to the delivery controller and returns as soon as the bytes
   * and the metadata are on disk. Uploading, encryption, retries and
   * reconciliation are the controller's job from that point — the same job it
   * already does for text — so an attachment no longer disappears when the
   * screen unmounts and a retry no longer sends the file twice.
   */
  const handleAttach = useCallback(async (file: File) => {
    setComposerError(null);
    debugMedia("file selected", { name: file.name, type: file.type, size: file.size });
    const replyTarget = replyingToMessage;
    setReplyingToMessage(null);
    await delivery.sendAttachment(file, { replyToMessageId: replyTarget?.id ?? null });
  }, [debugMedia, delivery, replyingToMessage]);

  const handleSend = useCallback(async (body: string) => {
    if (!body.trim()) return;

    const trimmedBody = body.trim();
    const replyTarget = replyingToMessage;

    if (!editingMessage) {
      // Hand the message to the controller and return as soon as it is durable.
      // Everything after that — encryption, the request, retries — happens
      // outside this component, so the composer is free immediately and the
      // send is not tied to this screen staying mounted.
      setReplyingToMessage(null);
      setComposerError(null);
      await delivery.send(trimmedBody, replyTarget?.id ?? null);
      return;
    }

    setPending(true);
    setComposerError(null);
    try {
      const url = editingMessage ? `/api/messages/${editingMessage.id}` : `/api/chats/${chatId}/messages`;
      const method = editingMessage ? "PATCH" : "POST";
      const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: trimmedBody, replyToMessageId: replyTarget?.id }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось отправить сообщение");
      }
      const data = await response.json();
      const m = normalizeMessage(data.message);
      if (m) {
        setMessages(curr => {
          const exists = curr.find(x => x.id === m.id);
          if (exists) return curr.map(x => x.id === m.id ? m : x);
          return [...curr, m];
        });
      }
      setEditingMessage(null);
      setReplyingToMessage(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Не удалось отправить сообщение");
      throw error;
    } finally {
      setPending(false);
    }
  }, [chatId, editingMessage, replyingToMessage, delivery]);

  // Retry a failed send. The controller reuses the original clientMessageId, so
  // if the first attempt did reach the server the retry returns that same
  // message instead of creating a second one. Re-sending the text as a fresh
  // message — what this used to do — is exactly what produced duplicates.
  const handleRetrySend = useCallback((messageId: string) => {
    const clientMessageId = messageId.startsWith("temp-") ? messageId.slice("temp-".length) : null;
    if (clientMessageId) {
      setComposerError(null);
      delivery.retry(clientMessageId);
      return;
    }

    // Attachments still use the older optimistic path.
    const failed = failedSends[messageId];
    if (!failed) return;
    setFailedSends((current) => {
      const next = { ...current };
      delete next[messageId];
      return next;
    });
    setMessages((current) => current.filter((message) => message.id !== messageId));
    setComposerError(null);
    void handleSend(failed.body).catch(() => {
      // handleSend already records the new failure and surfaces the error.
    });
  }, [delivery, failedSends, handleSend]);

  const handleSendFromPreview = useCallback(async (items: MediaPreviewItem[], caption: string) => {
    // The preview closes only after every file is durable. Closing first, as
    // this did, meant a failure between the two left the user with nothing —
    // no preview, no bubble, no file.
    for (const item of items) {
      await handleAttach(item.file);
    }

    // The caption travels as its own message: the server rejects a caption on
    // encrypted media, so this is the only form that works in both chat kinds.
    if (caption.trim()) {
      await handleSend(caption);
    }

    setPreviewFiles([]);
  }, [handleAttach, handleSend]);

  const startRecording = useCallback(async () => {
    try {
      isRecordingCancelledRef.current = false;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeTypes = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
      const selectedMimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || "";
      const recorder = new MediaRecorder(stream, selectedMimeType ? { mimeType: selectedMimeType } : undefined);
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        if (isRecordingCancelledRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: selectedMimeType || "audio/webm" });
        const extension = selectedMimeType.includes("mp4") ? "m4a" : "webm";
        const file = new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type });
        await handleAttach(file);
        stream.getTracks().forEach((track) => track.stop());
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingDuration(0);
      recordingTimerRef.current = setInterval(() => setRecordingDuration((value) => value + 1), 1000);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Нет доступа к микрофону");
    }
  }, [handleAttach]);

  const stopRecording = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  const cancelRecording = useCallback(() => {
    isRecordingCancelledRef.current = true;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    mediaRecorderRef.current?.stop();
    setIsRecording(false);
  }, []);

  const getStatusSubtitle = useCallback(() => {
    const users = Object.values(typingUsers);
    if (users.length > 0) {
      if (chatInfo.type === "GROUP") {
        return users.length === 1 
          ? `${users[0].displayName} печатает...`
          : `${users.length} человека печатают...`;
      }
      return "печатает...";
    }
    if (chatInfo.type === "DIRECT") {
      return partnerPresence.label;
    }
    const memberCount = chatInfo.memberCount || 0;
    return `${memberCount} ${memberCount === 1 ? 'участник' : (memberCount > 1 && memberCount < 5) ? 'участника' : 'участников'}`;
  }, [chatInfo.type, chatInfo.memberCount, partnerPresence.label, typingUsers]);

  // The chat inherits the app's resolved scheme; getChatAppearanceVars turns
  // that into one effective chat scheme and re-points the app tokens for this
  // subtree, so header, history, composer and notices can't disagree.
  const { effectiveTheme } = useTheme();
  const themeVars = getChatAppearanceVars(settings, effectiveTheme);
  const chatScheme = resolveChatScheme(settings, effectiveTheme);
  const focusedMessage = useMemo(() => menuState ? messages.find(m => m.id === menuState.id) : null, [menuState, messages]);
  const focusedMessageCopyText = useMemo(() => {
    if (!menuState) return null;
    return getCopyableMessageText(messagesWithDecrypted.find((message) => message.id === menuState.id) ?? null);
  }, [menuState, messagesWithDecrypted]);

  // The reaction bar is pinned right above the focused bubble and the action
  // menu right below it — each independently clamped to stay on-screen —
  // instead of the old single "menu block" positioned by a fixed magic offset
  // from the bubble's top. That old offset was tuned for a short single-line
  // message: any taller bubble (multi-line text, image, reply quote, reactions
  // row) let the action menu start ABOVE the bubble's real bottom edge,
  // visually covering / hiding the selected message behind it.
  //
  // Safe-area inset is read lazily inside these memos (only when the overlay
  // is actually open) instead of as a standalone render-time constant —
  // getComputedStyle forces a style recalc, and this component re-renders on
  // every keystroke/incoming message, so computing it unconditionally on every
  // render was a needless layout cost paid on the hot path.
  const GAP = 10;
  const getSafeAreaTop = () =>
    typeof window !== 'undefined'
      ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top') || '0')
      : 0;

  // When expanded, the scrollable emoji grid is capped to exactly the room
  // available above the bubble (not a fixed guess) — so the bar's own height
  // can never grow past the bubble and overlap it, whatever the screen size or
  // where the bubble sits. The action menu is hidden while expanded (see JSX
  // below): letting two independently-sized floating panels coexist above/
  // below the same bubble was what produced the overlapping mess when the
  // picker grew tall — removing one side of that conflict fixes it outright
  // instead of trying to out-guess every combination of sizes.
  /**
   * The long-press overlay is one composition, not three independent layers:
   * reaction bar above the bubble, the bubble, the action menu below it. Each
   * piece used to position itself and clamp itself into the viewport on its
   * own, so for a message near the bottom of the screen the menu's clamp and
   * the bar's clamp landed on the same pixels and the two drew on top of each
   * other.
   *
   * Laying the stack out once fixes that: measure what the three parts need,
   * and if they do not fit where the bubble sits, move the whole stack — the
   * clone included — until they do.
   */
  const overlayLayout = useMemo(() => {
    if (!menuState || !focusedMessage) return null;

    const envTop = getSafeAreaTop();
    const viewport = window.innerHeight;
    const topBound = envTop + 16;
    const bottomBound = viewport - 16;

    const mine = focusedMessage.senderUserId === currentUserId;
    // Item count decides the menu height. Every row is the same 48px, so this
    // is exact rather than the previous flat 320px guess, which was wrong for
    // both a two-item menu and a seven-item one.
    const itemCount =
      3 + // reply, pin, forward
      1 + // select
      1 + // delete
      (focusedMessageCopyText ? 1 : 0) +
      (mine && focusedMessage.type === "TEXT" ? 1 : 0);
    const menuHeight = itemCount * 48 + 8;

    const barHeight = reactionPickerExpanded ? 0 : 64; // expanded picker is sized below
    const expandedChrome = 34;

    let offset = 0;
    if (!reactionPickerExpanded) {
      const stackTop = menuState.rect.top - GAP - barHeight;
      const stackBottom = menuState.rect.bottom + GAP + menuHeight;
      // Pull up first, then push down: with the bubble taller than the space
      // between the bars, the top edge is the one that must win, because a
      // menu can scroll and a bubble cannot.
      if (stackBottom > bottomBound) offset -= stackBottom - bottomBound;
      if (stackTop + offset < topBound) offset += topBound - (stackTop + offset);
    }

    const bubbleTop = menuState.rect.top + offset;
    const bubbleBottom = menuState.rect.bottom + offset;

    const centerX = menuState.rect.left + menuState.rect.width / 2;
    const halfWidth = (reactionPickerExpanded ? 336 : 260) / 2;
    const barLeft = Math.min(window.innerWidth - 16 - halfWidth, Math.max(16 + halfWidth, centerX));

    let pickerMaxHeight = 0;
    let barBottom = viewport - bubbleTop + GAP;
    if (reactionPickerExpanded) {
      const availableAbove = bubbleTop - envTop - GAP - 16 - expandedChrome;
      pickerMaxHeight = Math.max(160, Math.min(420, availableAbove));
      const expandedHeight = pickerMaxHeight + expandedChrome;
      barBottom = Math.min(barBottom, Math.max(20, viewport - expandedHeight - envTop - 16));
    }

    return {
      cloneOffset: offset,
      bar: {
        style: { left: barLeft, bottom: barBottom, transform: "translateX(-50%)" } as React.CSSProperties,
        pickerMaxHeight,
      },
      menu: {
        top: bubbleBottom + GAP,
        // The menu is the part that gives way when the screen is too short.
        maxHeight: Math.max(160, bottomBound - (bubbleBottom + GAP)),
        left: mine ? "auto" : Math.min(window.innerWidth - 260, Math.max(16, menuState.rect.left)),
        right: mine ? Math.min(window.innerWidth - 260, Math.max(16, window.innerWidth - menuState.rect.right)) : "auto",
      },
    };
  }, [menuState, focusedMessage, currentUserId, focusedMessageCopyText, reactionPickerExpanded]);

  const reactionBarLayout = overlayLayout?.bar ?? null;

  const actionMenuStyle = useMemo(() => {
    if (!overlayLayout) return null;
    const { top, maxHeight, left, right } = overlayLayout.menu;
    return { top, maxHeight, left, right, overflowY: "auto" } as React.CSSProperties;
  }, [overlayLayout]);

  const renderOverlay = () => {
    if (!menuState || !focusedMessage || !mounted) return null;

    // Mounted on document.body, so it must carry the chat's variables with it.
    return (
      <ChatThemePortal themeVars={themeVars as React.CSSProperties} scheme={chatScheme}>
      <div
        ref={actionOverlayRef}
        className="fixed inset-0 z-[900] flex flex-col no-select"
        role="dialog"
        aria-modal="true"
        aria-label="Действия с сообщением"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/32 backdrop-blur-md animate-in fade-in duration-200"
          onClick={() => setMenuState(null)}
        />

        {/* Selected Message Clone */}
        <div 
          className="focused-message-clone"
          style={{
            top: menuState.rect.top + (overlayLayout?.cloneOffset ?? 0),
            left: menuState.rect.left,
            width: menuState.rect.width,
            height: menuState.rect.height,
          }}
        >
          <MessageBubble
            message={focusedMessage}
            mine={focusedMessage.senderUserId === currentUserId}
            settings={settings}
            onLongPress={() => {}}
            onReaction={() => {}}
            onMediaClick={() => {}}
            isGroupStart={true}
            isGroupEnd={true}
            showDisplayName={false}
            selectionMode={false}
            isSelected={false}
            onSelect={() => {}}
            isFocused={true}
            chatId={chatId}
            currentUserId={currentUserId}
            localDeviceId={localDeviceId}
          />
        </div>

        {/* Reactions — pinned right above the bubble, independently of the
            action menu, so it never fights the menu for vertical space. */}
        <div className="fixed z-[910] pointer-events-auto" style={reactionBarLayout?.style}>
          <div
            className="reaction-bar relative rounded-[1.45rem] border p-1.5 shadow-[0_12px_34px_rgba(15,23,42,0.16)] backdrop-blur-2xl animate-in zoom-in-95 duration-200"
            style={{
              backgroundColor: "var(--message-menu-bg)",
              borderColor: "var(--chat-menu-border)",
              color: "var(--message-menu-fg)",
              width: reactionPickerExpanded ? "min(21rem, calc(100vw - 2rem))" : undefined,
            }}
          >
             {/* Cloudy tail pointing down at the focused bubble. */}
             <span
               aria-hidden="true"
               className="absolute left-1/2 top-full -mt-[7px] h-3.5 w-3.5 -translate-x-1/2 rotate-45 rounded-[3px] border-b border-r"
               style={{ backgroundColor: "var(--message-menu-bg)", borderColor: "var(--chat-menu-border)" }}
             />

             {/* Readers summary for groups (quick-strip mode only — keeps the
                 expanded picker focused on emoji, matching the strip morphing
                 into a picker rather than stacking more chrome). */}
             {!reactionPickerExpanded && chatInfo.type === "GROUP" && focusedMessage.senderUserId === currentUserId && (
               <div className="flex items-center justify-between gap-3 mb-2 px-3 py-1.5 bg-foreground/5 rounded-2xl">
                 <span className="text-[11px] font-semibold text-muted/80">
                   {!menuState.readers ? "Загрузка..." : menuState.readers.length === 0 ? "Никто не прочитал" : `${menuState.readers.length} прочитали`}
                 </span>
                 <div className="flex items-center -space-x-1.5">
                   {menuState.readers?.slice(0, 3).map((r, i) => (
                     <div key={i} className="h-5 w-5 rounded-full border-2 border-[var(--message-menu-bg)] bg-primary/20 flex items-center justify-center overflow-hidden shrink-0 relative">
                       {r.avatarUrl ? (
                         <Image src={normalizeAvatarUrl(r.avatarUrl) || ""} fill className="object-cover" alt={r.name} />
                       ) : (
                         <span className="text-[9px] font-semibold text-primary">{r.name[0]?.toUpperCase()}</span>
                       )}
                     </div>
                   ))}
                 </div>
               </div>
             )}

             {reactionPickerExpanded ? (
               <div
                 className="w-full overflow-y-auto scrollbar-hide animate-in fade-in duration-150"
                 style={{ maxHeight: reactionBarLayout?.pickerMaxHeight || 288 }}
               >
                 {EMOJI_GROUPS.map((group) => (
                   <div key={group.label} className="mb-2 last:mb-0">
                     <p className="mb-1 px-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted/60">{group.label}</p>
                     <div className="grid grid-cols-8 gap-0.5">
                       {group.emojis.map((emoji) => (
                         <button
                           key={emoji}
                           type="button"
                           aria-label={`Реакция ${emoji}`}
                           className={`reaction-btn rounded-lg p-1 text-xl transition-transform active:scale-90 ${focusedMessage.reactions.some(r => r.emoji === emoji && r.userId === currentUserId) ? "bg-primary/20" : ""}`}
                           onClick={() => toggleReaction(menuState.id, emoji)}
                         >
                           {emoji}
                         </button>
                       ))}
                     </div>
                   </div>
                 ))}
               </div>
             ) : (
               <div className="flex items-center gap-1">
                 {ALLOWED_REACTIONS.map((emoji, index) => (
                   <button
                    key={emoji}
                    type="button"
                    aria-label={`Реакция ${emoji}`}
                    className={`reaction-btn reaction-pop rounded-full px-1.5 text-2xl transition-[transform,background-color] duration-150 active:scale-[0.96] ${focusedMessage.reactions.some(r => r.emoji === emoji && r.userId === currentUserId) ? "bg-primary/20" : ""}`}
                    style={{ animationDelay: `${index * 28}ms` }}
                    onClick={() => toggleReaction(menuState.id, emoji)}
                   >
                    {emoji}
                   </button>
                 ))}
                 <button
                   type="button"
                   aria-label="Больше эмодзи"
                   className="reaction-pop flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted/70 transition-colors hover:bg-foreground/5 active:scale-95"
                   style={{ animationDelay: `${ALLOWED_REACTIONS.length * 28}ms` }}
                   onClick={() => setReactionPickerExpanded(true)}
                 >
                   <ChevronDown className="h-5 w-5" strokeWidth={2.4} />
                 </button>
               </div>
             )}
          </div>
        </div>

        {/* Action menu — pinned right below the bubble; the message is never
            hidden behind it since this position is derived from the bubble's
            real bottom edge, not a fixed guess. Hidden while the reaction
            picker is expanded: two independently-floating panels around the
            same bubble is exactly what produced the overlapping mess. */}
        {!reactionPickerExpanded && (
        <div className="fixed z-[910] pointer-events-auto" style={actionMenuStyle as React.CSSProperties}>
          <div
            className={`action-menu min-w-[220px] overflow-hidden rounded-[1.45rem] border shadow-[0_14px_42px_rgba(15,23,42,0.18)] backdrop-blur-3xl animate-in zoom-in-95 duration-200 ${focusedMessage.senderUserId === currentUserId ? "origin-top-right" : "origin-top-left"}`}
            style={{
              backgroundColor: "var(--surface)",
              borderColor: "rgba(150,150,150,0.15)",
              color: "var(--foreground)",
            }}
          >
            <button className="action-item w-full flex items-center justify-between px-6 py-4 border-b border-border-subtle transition-colors hover:bg-foreground/5" onClick={() => { setReplyingToMessage(focusedMessage); setMenuState(null); }}>
              <span className="font-bold text-sm">Ответить</span>
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>
            </button>
            
            {focusedMessageCopyText && (
              <button className="action-item w-full flex items-center justify-between px-6 py-4 border-b border-border-subtle transition-colors hover:bg-foreground/5" onClick={() => handleCopy(focusedMessageCopyText)}>
                <span className="font-bold text-sm">Копировать</span>
                <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" /></svg>
              </button>
            )}

            <button className="action-item w-full flex items-center justify-between px-6 py-4 border-b border-border-subtle transition-colors hover:bg-foreground/5" onClick={() => void togglePin(focusedMessage)}>
              <span className="font-bold text-sm">{pinnedMessage?.id === focusedMessage.id ? "Открепить" : "Закрепить"}</span>
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
            </button>

            {focusedMessage.senderUserId === currentUserId && focusedMessage.type === "TEXT" && (
              <button className="action-item w-full flex items-center justify-between px-6 py-4 border-b border-border-subtle transition-colors hover:bg-foreground/5" onClick={() => { setEditingMessage(focusedMessage); setMenuState(null); }}>
                <span className="font-bold text-sm">Изменить</span>
                <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
              </button>
            )}

            <button className="action-item w-full flex items-center justify-between px-6 py-4 border-b border-border-subtle transition-colors hover:bg-foreground/5" onClick={() => initiateForward(focusedMessage)}>
              <span className="font-bold text-sm">Переслать</span>
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
            </button>

            <button className="action-item w-full flex items-center justify-between px-6 py-4 border-b border-border-subtle transition-colors hover:bg-foreground/5" onClick={() => startSelection(focusedMessage.id)}>
              <span className="font-bold text-sm">Выбрать</span>
              <svg className="h-5 w-5 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>

            <button className="action-item w-full flex items-center justify-between px-6 py-4 text-destructive hover:bg-destructive/10 transition-colors" onClick={() => handleDeleteQuietly(focusedMessage.id)}>
              <span className="font-bold text-sm">Удалить</span>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
        )}
      </div>
      </ChatThemePortal>
    );
  };

  // Why is history unreadable here? Distinguishes "sealed to a previous
  // install" from an empty chat or a transient failure, so we can explain
  // rather than render a wall of unavailable rows.
  const historyAvailability = useMemo(() => classifyHistory({
    messages: messages.map((message) => ({
      id: message.id,
      envelopeDeviceIds: (message.envelopes ?? []).map((envelope) => envelope.recipientDeviceId),
      unavailable: Boolean(unavailableMessageIds[message.id]),
    })),
    localDeviceId,
  }), [messages, unavailableMessageIds, localDeviceId]);

  const showHistoryUnavailable =
    !historyNoticeDismissed &&
    (historyAvailability === "missing-device-key" || historyAvailability === "partially-unavailable");

  const groupedMessages = useMemo(() => {
    const result: GroupedItem[] = [];
    messagesWithDecrypted.forEach((msg, idx) => {
      const prev = messagesWithDecrypted[idx - 1];
      const next = messagesWithDecrypted[idx + 1];
      const date = new Date(msg.createdAt).toDateString();
      const prevDate = prev ? new Date(prev.createdAt).toDateString() : null;
      if (date !== prevDate) {
        result.push({ type: "date", date: new Date(msg.createdAt) });
      }
      // Grouping rules live in src/lib/message-grouping so they stay in step
      // with the date separators above (a new day always opens a new group).
      const isGroupStart = startsGroup(msg, prev);
      const isGroupEnd = endsGroup(msg, next);
      result.push({ 
        type: "message", 
        message: msg, 
        mine: msg.senderUserId === currentUserId, 
        isGroupStart, 
        isGroupEnd, 
        showDisplayName: isGroupStart && chatInfo.type === "GROUP" 
      });
    });
    return result;
  }, [messagesWithDecrypted, currentUserId, chatInfo.type]);

  const currentUserInfo = useMemo(() => { return { displayName: "Я", avatarUrl: null }; }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setSearchQuery("");
    setSearchResults([]);
    
    // Clear param from URL without reload
    const url = new URL(window.location.href);
    url.searchParams.delete("search");
    window.history.replaceState({}, '', url.toString());
  }, []);

  return (
    <div
      className={`chat-screen relative isolate transition-[opacity] duration-150 ${menuState ? "overflow-hidden" : ""}`}
      style={themeVars as React.CSSProperties}
    >
      <div className="chat-wallpaper-layer" aria-hidden="true" />
      <ChatHeader
        chatId={chatId}
        chatType={chatInfo.type}
        title={
          chatInfo.type === "GROUP"
            ? (chatInfo.title || "Группа")
            : (chatInfo.otherMember?.displayName || "Личное")
        }
        subtitle={chatInfo.type === "DIRECT" && !chatInfo.otherMember ? "Сообщения самому себе" : getStatusSubtitle()}
        avatarUrl={chatInfo.type === "GROUP" ? chatInfo.avatarUrl : chatInfo.otherMember?.avatarUrl}
        isConnected={chatInfo.type === "DIRECT" ? partnerPresence.isOnline : false}
        currentUser={currentUserInfo}
        partnerId={chatInfo.otherMember?.id}
        disappearingSeconds={disappearingSeconds}
        onSetDisappearing={changeDisappearing}
        onSearchClick={() => setIsSearchOpen(true)}
        onAppearanceClick={() => setIsAppearanceOpen(true)}
        themeVars={themeVars as React.CSSProperties}
        chatScheme={chatScheme}
      />

      <InlineConnectionNotice status={connectionStatus} />

      {isSearchOpen && (
        <div className="sticky top-0 z-[150] glass-header px-4 py-3 animate-in slide-in-from-top-2 duration-200 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
           <div className="relative flex items-center gap-3">
              <div className="relative flex-1">
                 <input 
                   className="input-nox h-12 pl-12 pr-4 bg-foreground/5 border-none focus:ring-primary/20" 
                   placeholder="Поиск сообщений..."
                   aria-label="Поиск сообщений в чате"
                   
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                   autoFocus
                 />
                 <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
              <button type="button" onClick={closeSearch} className="text-sm font-semibold text-primary">Отмена</button>
           </div>
           
           {searchResults.length > 0 && (
             <div className="mt-4 max-h-60 overflow-y-auto space-y-2 pb-2">
                {searchResults.map(m => (
                  <button key={m.id} onClick={() => jumpToMessage(m.id)} className="w-full text-left p-3 rounded-2xl hover:bg-foreground/5 transition-smooth active:scale-[0.98]">
                     <div className="flex justify-between mb-1">
                        <span className="text-xs font-semibold text-primary">{m.senderName}</span>
                        <LocalTime value={m.createdAt} kind="date" className="text-[9px] font-bold text-muted" />
                     </div>
                     <p className="text-xs truncate text-foreground/80">
                        {searchQuery ? (
                          m.body.split(new RegExp(`(${escapeRegExp(searchQuery)})`, "gi")).map((part, i) =>
                            part.toLowerCase() === searchQuery.toLowerCase() ? (
                              <mark key={i} className="bg-primary/30 text-inherit rounded-sm px-0.5 font-bold">
                                {part}
                              </mark>
                            ) : (
                              part
                            )
                          )
                        ) : (
                          m.body
                        )}
                     </p>
                  </button>
                ))}
             </div>
           )}
        </div>
      )}

      {pinnedMessage && (
        <div className="sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-border-subtle/30 px-4 py-2 flex items-center justify-between animate-in slide-in-from-top-2">
           <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-1 bg-primary rounded-full" />
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => jumpToMessage(pinnedMessage.id)}
              >
                 <p className="text-xs font-semibold text-primary">Закреплённое сообщение</p>
                 <p className="text-xs truncate text-foreground/60">{pinnedMessage.body || pinnedMessage.attachments[0]?.fileName || "Вложение"}</p>
              </button>
           </div>
           <button type="button" aria-label="Открепить сообщение" onClick={() => void togglePin(pinnedMessage)} className="touch-target text-muted"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      )}

      <div 
        ref={scrollContainerRef} 
        onScroll={handleScroll}
        className="relative z-10 min-h-0 flex-1 overflow-y-auto px-1 py-4 scrollbar-hide overscroll-contain"
        style={{ overflowAnchor: "none" }}
      >
        <div className="mx-auto max-w-3xl">
          {loadingOlder ? (
            <div className="flex justify-center py-3" aria-hidden="true">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary/80" />
            </div>
          ) : null}
          {messagesWithDecrypted.length === 0 ? (
            <>
              <div className="flex justify-center py-3">
                <span
                  className="rounded-full border px-3 py-1.5 text-[11px] font-semibold backdrop-blur-md"
                  style={{
                    backgroundColor: "var(--chat-date-bg)",
                    color: "var(--chat-date-fg)",
                    borderColor: "var(--chat-focus-ring)",
                  }}
                >
                  Сегодня
                </span>
              </div>
              {chatInfo.type === "DIRECT" ? <E2EEDisclaimer /> : null}
            </>
          ) : null}
          {showHistoryUnavailable && (
            <HistoryUnavailableNotice
              scope={historyAvailability === "missing-device-key" ? "all" : "partial"}
              onDismiss={() => setHistoryNoticeDismissed(true)}
            />
          )}

          {groupedMessages.map((item, idx) => (
            item.type === "date" ? (
              <DateSeparator key={`date-${idx}`} date={item.date} />
            ) : (
              <div
                key={item.message.id}
                ref={el => { messageRefs.current[item.message.id] = el; }}
                className={`${initialMessageIds.has(item.message.id) ? "" : "animate-in fade-in slide-in-from-bottom-2 duration-200"} ${highlightedId === item.message.id ? "ring-2 ring-primary rounded-3xl ring-offset-4 ring-offset-transparent bg-primary/5 scale-[1.02] transition-[transform,background-color,box-shadow] duration-200" : ""}`}
              >
                {firstUnreadId === item.message.id ? (
                  <div className="my-3 flex items-center gap-3 px-2">
                    <div className="h-px flex-1 bg-primary/30" />
                    <span className="rounded-full bg-primary/15 px-3 py-1 text-[11px] font-semibold text-primary">Непрочитанные</span>
                    <div className="h-px flex-1 bg-primary/30" />
                  </div>
                ) : null}
                <MessageBubble
                  message={item.message}
                  mine={item.mine}
                  settings={settings}
                  onLongPress={handleLongPress}
                  onReaction={toggleReaction}
                  onMediaClick={setSelectedMedia}
                  onSwipeReply={handleSwipeReply}
                  onReplyPreviewClick={jumpToMessage}
                  isGroupStart={item.isGroupStart}
                  isGroupEnd={item.isGroupEnd}
                  showDisplayName={item.showDisplayName}
                  selectionMode={isSelectionMode}
                  isSelected={selectedIds.has(item.message.id)}
                  onSelect={toggleSelection}
                  isFocused={menuState?.id === item.message.id}
                  searchQuery={isSearchOpen ? searchQuery : ""}
                  chatId={chatId}
                  currentUserId={currentUserId}
                  localDeviceId={localDeviceId}
                  isFailed={
                    item.message.id.startsWith("temp-")
                      ? delivery.failedClientIds.has(item.message.id.slice("temp-".length))
                      : Boolean(failedSends[item.message.id])
                  }
                  onRetry={handleRetrySend}
                />
              </div>
            )
          ))}
          <TypingIndicator names={Object.values(typingUsers).map((user) => user.displayName)} />

          <div ref={messagesEndRef} className="h-4" style={{ overflowAnchor: "auto" }} />
        </div>
      </div>

      {showScrollDown && !isSelectionMode ? (
        <button
          onClick={() => forceScrollBottom("smooth")}
          aria-label="Вниз к последним сообщениям"
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-30 flex h-12 w-12 items-center justify-center rounded-full border border-border-subtle/40 bg-surface shadow-[0_10px_24px_rgba(15,23,42,0.10)] transition-smooth active:scale-[0.96] animate-in fade-in zoom-in-90"
        >
          <svg className="h-6 w-6 text-foreground/80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
          {unseenCount > 0 ? (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-none tabular-nums text-primary-foreground shadow">
              {unseenCount > 99 ? "99+" : unseenCount}
            </span>
          ) : null}
        </button>
      ) : null}

      {isSelectionMode ? (
        <div className="glass-composer px-6 py-4 flex items-center justify-between animate-in slide-in-from-bottom-4 duration-200">
           <button type="button" onClick={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }} className="text-sm font-semibold text-primary">Отмена</button>
           <div className="flex gap-6">
              <button type="button" aria-label="Удалить выбранные сообщения" onClick={handleDeleteSelected} disabled={selectedIds.size === 0} className="touch-target h-12 w-12 rounded-full bg-danger/10 text-danger disabled:opacity-30"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
              <button type="button" aria-label="Переслать выбранные сообщения" onClick={() => initiateForward(messages.filter(m => selectedIds.has(m.id)))} disabled={selectedIds.size === 0} className="touch-target h-12 w-12 rounded-full bg-primary/10 text-primary disabled:opacity-30"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg></button>
           </div>
        </div>
      ) : (
        <>
          {composerError ? (
            <div className="px-4 pb-2 text-center text-xs font-semibold text-danger">
              {composerError}
            </div>
          ) : null}
          <ChatComposer
            chatId={chatId}
            onSend={handleSend}
            onTyping={handleTyping}
            onVoiceStart={startRecording}
            onVoiceStop={stopRecording}
            onVoiceCancel={cancelRecording}
            onFilesSelected={setPreviewFiles}
            onVideoMessageCaptured={handleAttach}
            isRecording={isRecording}
            recordingDuration={recordingDuration}
            isLocked={isLocked && currentRole === "MEMBER"}
            pending={pending}
            replyingTo={replyingToMessage}
            editingTo={editingMessage}
            onCancelAction={() => { setEditingMessage(null); setReplyingToMessage(null); }}
          />
        </>
      )}

      {renderOverlay()}

      {/* A stable, always-present region. Inserting a live region and its text
          in the same commit is unreliable — screen readers announce what
          changes inside a region they are already watching, so the region has
          to exist first and only its text may change. */}
      <div className="sr-only" role="status" aria-live="polite">{toastMessage ?? ""}</div>

      {toastMessage ? (
        <div aria-hidden="true" className="pointer-events-none fixed left-1/2 bottom-[calc(env(safe-area-inset-bottom,0px)+96px)] z-[1000] -translate-x-1/2 rounded-full border border-border-subtle bg-surface-elevated/95 px-4 py-2 text-xs font-semibold text-foreground shadow-[0_10px_24px_rgba(15,23,42,0.10)] backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2">
          {toastMessage}
        </div>
      ) : null}

      {showForwardPicker && (
        <div ref={forwardPickerRef} className="fixed inset-0 z-[400] flex items-center justify-center bg-black/55 p-6 backdrop-blur-sm animate-in fade-in" role="dialog" aria-modal="true" aria-labelledby="forward-picker-title">
           <div className="premium-glass w-full max-w-sm rounded-[1.75rem] p-6">
              <h2 id="forward-picker-title" className="mb-6 px-2 text-xl font-semibold">Переслать</h2>
              <div className="max-h-80 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
                 {recentChatsLoading && recentChats.length === 0 ? (
                   <div className="flex items-center justify-center gap-3 p-6 text-sm font-medium text-muted">
                     <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                     Загрузка чатов…
                   </div>
                 ) : recentChats.length === 0 ? (
                   <div className="rounded-2xl border border-border-subtle/40 bg-surface/60 p-5 text-center text-sm font-medium text-muted">
                     Нет доступных чатов для пересылки.
                   </div>
                 ) : recentChats.map(c => (
                   <button key={c.id} onClick={() => void confirmForward(c.id)} disabled={isForwarding} className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-foreground/5 transition-smooth active:scale-[0.96] disabled:opacity-50">
                      <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary/10 font-semibold text-primary">
                        {c.title[0]}
                      </div>
                      <span className="truncate font-semibold">{c.title}</span>
                      {isForwarding ? <span className="ml-auto text-xs font-semibold text-muted">...</span> : null}
                   </button>
                 ))}
              </div>
              <button type="button" onClick={() => setShowForwardPicker(false)} className="mt-6 w-full py-4 font-semibold text-muted hover:text-foreground">Отмена</button>
           </div>
        </div>
      )}

      <AppearanceSheet
        isOpen={isAppearanceOpen}
        onClose={() => setIsAppearanceOpen(false)}
        settings={settings}
        onUpdate={updateSettings}
        onReset={resetSettings}
        // The sheet's chrome follows the app, its preview follows the chat.
        appScheme={effectiveTheme}
      />
      <MediaViewer item={selectedMedia} onClose={() => setSelectedMedia(null)} />

      {previewFiles.length > 0 && (
        <MediaPreviewComposer
          initialFiles={previewFiles}
          onSend={handleSendFromPreview}
          onCancel={() => setPreviewFiles([])}
          captionIsSeparateMessage={chatInfo.type === "DIRECT"}
        />
      )}
    </div>
  );
}
