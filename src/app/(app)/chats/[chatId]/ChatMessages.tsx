"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { useSocket } from "@/hooks/useSocket";
import { ChatHeader } from "./ChatHeader";
import { ChatComposer } from "./ChatComposer";
import { MessageBubble, Message } from "./MessageBubble";
import { useChatAppearance, ChatAppearanceSheet, getChatAppearanceVars } from "./ChatAppearance";
import { MediaViewer, MediaItem } from "./MediaViewer";
import { usePathname, useSearchParams } from "next/navigation";
import { usePresence } from "@/hooks/usePresence";
import { decryptMessage, decryptMessageV2, encryptMessageForDevices } from "@/lib/e2ee/utils";
import { fetchRecipientKeyBundle, getLocalPublicJwk, registerCurrentDevice } from "@/lib/e2ee/keys";
import { getLocalEncryptedMessage, storeAndVerifyLocalEncryptedMessage } from "@/lib/e2ee/indexed-db";
import { encryptMediaForDevices } from "@/lib/e2ee/media";

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

function generateClientId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatMessages({
  chatId,
  currentUserId,
  currentRole,
  isLocked,
  initialMessages,
  initialPinnedMessage,
  initialForwardChats,
  chatInfo,
}: {
  chatId: string;
  currentUserId: string;
  currentRole: ChatRole;
  isLocked: boolean;
  initialMessages: unknown[];
  initialPinnedMessage: Message | null;
  initialForwardChats: ForwardChatOption[];
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
  const { socket } = useSocket();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const partnerPresence = usePresence({
    userId: chatInfo.type === "DIRECT" ? chatInfo.otherMember?.id : null,
    initialIsOnline: chatInfo.type === "DIRECT" ? chatInfo.otherMember?.isOnline : false,
    initialLastSeenAt: chatInfo.type === "DIRECT" ? chatInfo.otherMember?.lastSeenAt ?? null : null,
  });
  
  const [messages, setMessages] = useState<Message[]>(() =>
    initialMessages.map(normalizeMessage).filter((m): m is Message => !!m)
  );

  const [decryptedBodies, setDecryptedBodies] = useState<Record<string, string>>({});
  const [unavailableMessageIds, setUnavailableMessageIds] = useState<Record<string, true>>({});
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
    async function decryptAll() {
      const newDecrypted: Record<string, string> = { ...decryptedBodies };
      const newUnavailable: Record<string, true> = { ...unavailableMessageIds };
      let changed = false;
      let unavailableChanged = false;

      for (const msg of messages) {
        if (!msg.isEncrypted || msg.body || decryptedBodies[msg.id]) continue;

        // Try local encrypted cache first. Persistent cache must never store plaintext.
        const cached = localDeviceId
          ? await getLocalEncryptedMessage({ userId: currentUserId, messageId: msg.id, chatId, deviceId: localDeviceId }).catch(() => null)
          : null;
        if (cached) {
          if (newDecrypted[msg.id] !== cached.body) {
            newDecrypted[msg.id] = cached.body;
            changed = true;
          }
          if (newUnavailable[msg.id]) {
            delete newUnavailable[msg.id];
            unavailableChanged = true;
          }
          if ((msg.encryptionVersion ?? 0) >= 2 && localDeviceId) {
            const envelope = msg.envelopes?.find((item) => item.recipientDeviceId === localDeviceId);
            if (envelope?.ciphertext && !envelope.encryptedPayloadDeletedAt) {
              void sendDeliveryAck(msg.id, localDeviceId);
            }
          }
          continue;
        }

        if ((msg.encryptionVersion ?? 0) >= 2) {
          if (!localDeviceId) continue;
          const envelope = msg.envelopes?.find((item) => item.recipientDeviceId === localDeviceId);
          if (!envelope) {
            if (!newUnavailable[msg.id]) {
              newUnavailable[msg.id] = true;
              unavailableChanged = true;
            }
            continue;
          }

          if (!envelope.ciphertext || !envelope.iv || !envelope.salt) {
            if (!newUnavailable[msg.id]) {
              newUnavailable[msg.id] = true;
              unavailableChanged = true;
            }
            continue;
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
            newDecrypted[msg.id] = decrypted;
            changed = true;
            if (newUnavailable[msg.id]) {
              delete newUnavailable[msg.id];
              unavailableChanged = true;
            }
            try {
              await saveVerifiedLocalMessage(msg, decrypted, localDeviceId);
            } catch (error) {
              console.error("[e2ee] Failed to save local encrypted cache", error);
              continue;
            }
            void sendDeliveryAck(msg.id, localDeviceId);
          } else {
            newDecrypted[msg.id] = "Не удалось расшифровать сообщение";
            changed = true;
          }
          continue;
        }

        // Legacy v1: If no server payload, cannot decrypt
        if (!msg.ciphertext) continue;

        const recipientUserId = msg.senderUserId === currentUserId
          ? chatInfo.otherMember?.id
          : currentUserId;
        const senderKey = msg.senderUserId === currentUserId ? myPublicKey : otherMemberPublicKey;
        if (!recipientUserId) continue;
        if (!senderKey) continue;

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
          newDecrypted[msg.id] = decrypted;
          changed = true;

          // Store in local cache and ack delivery if recipient
          if (msg.senderUserId !== currentUserId) {
            if (localDeviceId) {
              try {
                await saveVerifiedLocalMessage(msg, decrypted, localDeviceId);
                if (!msg.deliveredAt) {
                  void sendDeliveryAck(msg.id);
                }
              } catch (error) {
                console.error("[e2ee] Failed to save local encrypted cache", error);
              }
            }
          } else {
            // Also store own sent messages for local history, encrypted at rest.
            if (localDeviceId) {
              await saveVerifiedLocalMessage(msg, decrypted, localDeviceId).catch((error) => {
                console.error("[e2ee] Failed to save local encrypted cache", error);
              });
            }
          }
        } else if (msg.senderUserId !== currentUserId) {
          newDecrypted[msg.id] = "Не удалось расшифровать сообщение";
          changed = true;
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
  }, [messages, otherMemberPublicKey, myPublicKey, chatId, currentUserId, chatInfo.otherMember?.id, localDeviceId, decryptedBodies, unavailableMessageIds, saveVerifiedLocalMessage, sendDeliveryAck]);

  const messagesWithDecrypted = useMemo(() => {
    return messages.map(msg => ({
      ...msg,
      body: msg.body || decryptedBodies[msg.id] || (msg.isEncrypted ? ((msg.encryptionVersion ?? 0) >= 2 ? "" : msg.ciphertext ? "Зашифрованное сообщение" : "") : msg.body || ""),
      messageUnavailableOnThisDevice: Boolean(unavailableMessageIds[msg.id]),
    })) as MessageWithDecrypted[];
  }, [messages, decryptedBodies, unavailableMessageIds]);

  const [pending, setPending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<Record<string, { displayName: string; timeoutId: ReturnType<typeof setTimeout> }>>({});
  const [isTypingLocal, setIsTypingLocal] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [menuState, setMenuState] = useState<{ id: string; rect: DOMRect; readers?: { name: string; avatarUrl: string | null }[] } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  const forceScrollBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 100;
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) forceScrollBottom("smooth");
  }, [messages, forceScrollBottom]);

  const handleLongPress = useCallback(async (id: string, rect: DOMRect) => {
    if (isSelectionMode) return;
    setMenuState({ id, rect });
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
  const [recentChats] = useState<ForwardChatOption[]>(initialForwardChats);
  const [showForwardPicker, setShowForwardPicker] = useState(false);
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

  const handleDeleteQuietly = useCallback((id: string) => {
    setMessages(curr => curr.filter(m => m.id !== id));
    setMenuState(null);
    try { fetch(`/api/messages/${id}`, { method: "DELETE" }); } catch {}
  }, []);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    setMessages(curr => curr.filter(m => !selectedIds.has(m.id)));
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    for (const id of ids) fetch(`/api/messages/${id}`, { method: "DELETE" }).catch(() => {});
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
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setToastMessage("Скопировано");
      setTimeout(() => setToastMessage(null), 2000);
    } catch (e) {
      setToastMessage("Не удалось скопировать");
      setTimeout(() => setToastMessage(null), 2000);
    }
    setMenuState(null);
  }, []);

  const initiateForward = useCallback((msg: Message | Message[]) => {
    setForwardingMessages(Array.isArray(msg) ? msg : [msg]);
    setShowForwardPicker(true);
    setMenuState(null);
  }, []);

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
      setMessages((current) => {
        const optimisticId = payload.clientId ? `temp-${payload.clientId}` : null;
        const withoutOptimistic = optimisticId ? current.filter((message) => message.id !== optimisticId) : current;
        const exists = withoutOptimistic.some((message) => message.id === normalized.id);
        debugRealtime(exists ? "message deduped" : "message appended", { messageId: normalized.id, chatId: payload.chatId });
        return exists ? withoutOptimistic : [...withoutOptimistic, normalized];
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
    };
  }, [chatId, currentUserId, debugRealtime, localDeviceId, markAsRead, saveVerifiedLocalMessage, sendDeliveryAck, socket]);

  const toggleReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await fetch(`/api/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      setMenuState(null);
    } catch {}
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

  const handleAttach = useCallback(async (file: File, caption?: string) => {
    setUploading(true);
    setComposerError(null);
    debugMedia("file selected", { name: file.name, type: file.type, size: file.size, caption });
    const shouldEncryptMedia = chatInfo.type === "DIRECT";
    const mediaRecipientUserId = chatInfo.otherMember?.id ?? currentUserId;

    // Optimistic message for media
    const clientId = generateClientId();
    const tempUrl = URL.createObjectURL(file);
    const isAudio = file.type.startsWith("audio/");
    const optimisticMessage: Message = {
      ...createOptimisticMessage({
        clientId,
        body: caption || null,
        currentUserId,
        replyToMessage: replyingToMessage,
      }),
      type: file.type.startsWith("image/") ? "IMAGE" : file.type.startsWith("video/") ? "VIDEO" : (isAudio ? "VOICE" : "FILE"),
      attachments: [{
        id: `temp-${clientId}`,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        url: tempUrl,
      }]
    };

    setMessages((current) => [...current, optimisticMessage]);
    setReplyingToMessage(null);

    try {
      const formData = new FormData();
      if (shouldEncryptMedia) {
        if (caption?.trim()) {
          throw new Error("Подписи к зашифрованным медиа пока не поддержаны.");
        }

        const encryptedMedia = await encryptMediaForDevices({
          file,
          recipientUserId: mediaRecipientUserId,
          chatId,
          senderUserId: currentUserId,
        });
        const encryptedFile = new File([encryptedMedia.encryptedBlob], "encrypted-media.bin", {
          type: "application/octet-stream",
        });
        formData.append("file", encryptedFile);
        formData.append("encrypted", "true");
        formData.append("mediaEncryptionVersion", String(encryptedMedia.mediaEncryptionVersion));
        formData.append("fileIv", encryptedMedia.fileIv);
        formData.append("fileAlgorithm", encryptedMedia.fileAlgorithm);
        formData.append("senderDeviceId", encryptedMedia.senderDeviceId);
        formData.append("mediaKeyEnvelopes", JSON.stringify(encryptedMedia.mediaKeyEnvelopes));
        formData.append("clientMimeType", file.type);
        formData.append("originalSizeBytes", String(file.size));
      } else {
        formData.append("file", file);
      }
      if (caption && !shouldEncryptMedia) {
        formData.append("body", caption);
      }

      debugMedia("upload started", { chatId, name: file.name });
      const response = await fetch(`/api/chats/${chatId}/attachments`, { method: "POST", body: formData });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || "Не удалось отправить файл");
      }
      const data = await response.json();
      const normalized = normalizeMessage(data.message);
      
      if (normalized) {
        setMessages((current) => {
          const withoutOptimistic = current.filter((message) => message.id !== optimisticMessage.id);
          const exists = withoutOptimistic.some((message) => message.id === normalized.id);
          return exists ? withoutOptimistic : [...withoutOptimistic, normalized];
        });
      }
      URL.revokeObjectURL(tempUrl);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Не удалось отправить файл";
      debugMedia("upload error", { reason });
      setMessages((current) => current.filter((message) => message.id !== optimisticMessage.id));
      setComposerError(reason);
      URL.revokeObjectURL(tempUrl);
      throw error; // Re-throw to inform composer
    } finally {
      setUploading(false);
    }
  }, [chatId, chatInfo.otherMember?.id, chatInfo.type, currentUserId, debugMedia, replyingToMessage]);

  const handleSend = useCallback(async (body: string, file?: File) => {
    if (!body.trim() && !file) return;

    if (file) {
      await handleAttach(file, body.trim());
      return;
    }

    const trimmedBody = body.trim();
    const replyTarget = replyingToMessage;

    if (!editingMessage) {
      const clientId = generateClientId();
      const optimisticMessage = createOptimisticMessage({
        clientId,
        body: trimmedBody,
        currentUserId,
        replyToMessage: replyTarget,
      });

      setMessages((current) => [...current, optimisticMessage]);
      setReplyingToMessage(null);
      setPending(true);
      setComposerError(null);

    try {
      let payload: Record<string, unknown>;
      if (chatInfo.type === "DIRECT" && chatInfo.otherMember?.id) {
        let encrypted: Awaited<ReturnType<typeof encryptMessageForDevices>>;
        try {
          encrypted = await encryptMessageForDevices(trimmedBody, chatInfo.otherMember.id, chatId, currentUserId);
        } catch (encryptError) {
          console.error("[e2ee] Encryption failed before message POST", encryptError);
          const message = encryptError instanceof Error
            ? encryptError.message
            : "Не удалось зашифровать сообщение на этом устройстве";
          throw new Error(message);
        }

        payload = {
          ...encrypted,
          type: "TEXT",
          replyToMessageId: replyTarget?.id,
          clientId,
        };
        plaintextByClientIdRef.current.set(clientId, trimmedBody);
      } else {
        payload = {
          body: trimmedBody,
          replyToMessageId: replyTarget?.id,
          clientId,
        };
      }

      const response = await fetch(`/api/chats/${chatId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Не удалось отправить сообщение");
        }

        const data = await response.json();
        const normalized = normalizeMessage(data.message);
        if (normalized) {
          if (payload.encrypted === true) {
            plaintextByClientIdRef.current.delete(clientId);
            setDecryptedBodies((current) => ({ ...current, [normalized.id]: trimmedBody }));
            if ((normalized.encryptionVersion ?? 0) >= 2 && localDeviceId) {
              try {
                await saveVerifiedLocalMessage(normalized, trimmedBody, localDeviceId);
                void sendDeliveryAck(normalized.id, localDeviceId);
              } catch (error) {
                console.error("[e2ee] Failed to save local encrypted cache", error);
                setComposerError("Не удалось сохранить сообщение на устройстве.");
              }
            }
          }
          setMessages((current) => {
            const withoutOptimistic = current.filter((message) => message.id !== optimisticMessage.id);
            const exists = withoutOptimistic.some((message) => message.id === normalized.id);
            return exists ? withoutOptimistic : [...withoutOptimistic, normalized];
          });
        }
      } catch (error) {
        plaintextByClientIdRef.current.delete(clientId);
        setMessages((current) => current.filter((message) => message.id !== optimisticMessage.id));
        setComposerError(error instanceof Error ? error.message : "Не удалось отправить сообщение");
        throw error;
      } finally {
        setPending(false);
      }

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
  }, [chatId, currentUserId, editingMessage, replyingToMessage, handleAttach, chatInfo.otherMember, chatInfo.type, localDeviceId, saveVerifiedLocalMessage, sendDeliveryAck]);

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

  const themeVars = getChatAppearanceVars(settings);
  const focusedMessage = useMemo(() => menuState ? messages.find(m => m.id === menuState.id) : null, [menuState, messages]);

  // Safe Area Insets for positioning
  const envTop = typeof window !== 'undefined' ? parseInt(getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top') || '0') : 0;

  const menuPosition = useMemo(() => {
    if (!menuState || !focusedMessage) return null;
    const spaceBelow = window.innerHeight - menuState.rect.bottom;
    const spaceAbove = menuState.rect.top;
    const menuHeight = 320;
    const showAbove = spaceBelow < menuHeight && spaceAbove > spaceBelow;
    
    // Clamp values to screen
    const top = showAbove ? 'auto' : Math.max(envTop + 80, Math.min(window.innerHeight - menuHeight - 20, menuState.rect.top - 60));
    const bottom = showAbove ? Math.max(20, window.innerHeight - menuState.rect.top + 10) : 'auto';
    
    return {
      top,
      bottom,
      left: focusedMessage.senderUserId === currentUserId ? 'auto' : Math.min(window.innerWidth - 260, Math.max(16, menuState.rect.left)),
      right: focusedMessage.senderUserId === currentUserId ? Math.min(window.innerWidth - 260, Math.max(16, window.innerWidth - menuState.rect.right)) : 'auto',
    };
  }, [menuState, focusedMessage, currentUserId, envTop]);

  const renderOverlay = () => {
    if (!menuState || !focusedMessage || !mounted) return null;

    return createPortal(
      <div className="fixed inset-0 z-[900] flex flex-col no-select">
        {/* Backdrop */}
        <div 
          className="absolute inset-0 bg-black/35 backdrop-blur-xl animate-in fade-in duration-300" 
          onClick={() => setMenuState(null)} 
        />

        {/* Selected Message Clone */}
        <div 
          className="focused-message-clone"
          style={{
            top: menuState.rect.top,
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

        {/* Action Menu & Reactions */}
        <div className="menu-content" style={menuPosition as React.CSSProperties}>
          <div
            className="reaction-bar self-center mb-4 rounded-[2rem] border p-2 shadow-2xl backdrop-blur-2xl animate-in zoom-in-95 duration-200"
            style={{
              backgroundColor: "var(--message-menu-bg)",
              borderColor: "var(--chat-menu-border)",
              color: "var(--message-menu-fg)",
            }}
          >
             {/* Readers summary for groups */}
             {chatInfo.type === "GROUP" && focusedMessage.senderUserId === currentUserId && (
               <div className="flex items-center justify-between gap-3 mb-2 px-3 py-1.5 bg-foreground/5 rounded-2xl">
                 <span className="text-[10px] font-black uppercase tracking-widest text-muted/80">
                   {!menuState.readers ? "Загрузка..." : menuState.readers.length === 0 ? "Никто не прочитал" : `${menuState.readers.length} прочитали`}
                 </span>
                 <div className="flex items-center -space-x-1.5">
                   {menuState.readers?.slice(0, 3).map((r, i) => (
                     <div key={i} className="h-5 w-5 rounded-full border-2 border-[var(--message-menu-bg)] bg-primary/20 flex items-center justify-center overflow-hidden shrink-0 relative">
                       {r.avatarUrl ? (
                         <Image src={r.avatarUrl.startsWith('http') ? r.avatarUrl : `/api/avatars/${r.avatarUrl}`} fill className="object-cover" alt={r.name} />
                       ) : (
                         <span className="text-[9px] font-black text-primary">{r.name[0]?.toUpperCase()}</span>
                       )}
                     </div>
                   ))}
                 </div>
               </div>
             )}

             <div className="flex gap-1">
               {ALLOWED_REACTIONS.map(emoji => (
                 <button 
                  key={emoji} 
                  className={`reaction-btn rounded-full px-1.5 text-2xl transition-smooth hover:scale-125 active:scale-90 ${focusedMessage.reactions.some(r => r.emoji === emoji && r.userId === currentUserId) ? "bg-primary/20" : ""}`}
                  onClick={() => toggleReaction(menuState.id, emoji)}
                 >
                  {emoji}
                 </button>
               ))}
             </div>
          </div>

          <div
            className={`action-menu min-w-[220px] overflow-hidden rounded-[2rem] border shadow-2xl backdrop-blur-3xl animate-in slide-in-from-bottom-4 duration-300 ${focusedMessage.senderUserId === currentUserId ? "self-end" : "self-start"}`}
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
            
            {focusedMessage.body && (!focusedMessage.isEncrypted || !["Зашифрованное сообщение", "Сообщение доставлено и удалено с сервера"].includes(focusedMessage.body)) && (
              <button className="action-item w-full flex items-center justify-between px-6 py-4 border-b border-border-subtle transition-colors hover:bg-foreground/5" onClick={() => handleCopy(focusedMessage.body!)}>
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

            <button className="action-item w-full flex items-center justify-between px-6 py-4 text-red-500 hover:bg-red-500/10 transition-colors" onClick={() => handleDeleteQuietly(focusedMessage.id)}>
              <span className="font-bold text-sm">Удалить</span>
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  };

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
      const isGroupStart = !prev || prev.senderUserId !== msg.senderUserId || (new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() > 300000);
      const isGroupEnd = !next || next.senderUserId !== msg.senderUserId || (new Date(next.createdAt).getTime() - new Date(msg.createdAt).getTime() > 300000);
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

  const formatDateLabel = (date: Date) => {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return "Сегодня";
    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) return "Вчера";
    return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
  };

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
      className={`chat-screen transition-[opacity] duration-150 ${menuState ? "overflow-hidden" : ""}`} 
      style={themeVars as React.CSSProperties}
    >
      <ChatHeader
        chatId={chatId}
        chatType={chatInfo.type}
        title={
          chatInfo.type === "GROUP"
            ? (chatInfo.title || "Группа")
            : (chatInfo.otherMember?.displayName || "Избранное")
        }
        subtitle={getStatusSubtitle()}
        avatarUrl={chatInfo.type === "GROUP" ? chatInfo.avatarUrl : chatInfo.otherMember?.avatarUrl}
        isConnected={chatInfo.type === "DIRECT" ? partnerPresence.isOnline : false}
        currentUser={currentUserInfo}
        partnerId={chatInfo.otherMember?.id}
      />

      {isSearchOpen && (
        <div className="sticky top-0 z-[150] glass-header px-4 py-3 animate-in slide-in-from-top-full duration-300 shadow-xl">
           <div className="relative flex items-center gap-3">
              <div className="relative flex-1">
                 <input 
                   className="input-nox h-12 pl-12 pr-4 bg-foreground/5 border-none focus:ring-primary/20" 
                   placeholder="Поиск сообщений..." 
                   value={searchQuery}
                   onChange={e => setSearchQuery(e.target.value)}
                   autoFocus
                 />
                 <svg className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              </div>
              <button onClick={closeSearch} className="text-sm font-black uppercase text-primary">Отмена</button>
           </div>
           
           {searchResults.length > 0 && (
             <div className="mt-4 max-h-60 overflow-y-auto space-y-2 pb-2">
                {searchResults.map(m => (
                  <button key={m.id} onClick={() => jumpToMessage(m.id)} className="w-full text-left p-3 rounded-2xl hover:bg-foreground/5 transition-smooth active:scale-[0.98]">
                     <div className="flex justify-between mb-1">
                        <span className="text-[10px] font-black uppercase text-primary">{m.senderName}</span>
                        <span className="text-[9px] font-bold text-muted">{new Date(m.createdAt).toLocaleDateString()}</span>
                     </div>
                     <p className="text-xs truncate text-foreground/80">
                        {searchQuery ? (
                          m.body.split(new RegExp(`(${searchQuery})`, "gi")).map((part, i) =>
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
              <div className="min-w-0 cursor-pointer" onClick={() => jumpToMessage(pinnedMessage.id)}>
                 <p className="text-[10px] font-black uppercase text-primary">Закреплённое сообщение</p>
                 <p className="text-xs truncate text-foreground/60">{pinnedMessage.body || pinnedMessage.attachments[0]?.fileName || "Вложение"}</p>
              </div>
           </div>
           <button onClick={() => void togglePin(pinnedMessage)} className="text-muted p-2"><svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
        </div>
      )}

      <div 
        ref={scrollContainerRef} 
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-1 py-4 scrollbar-hide overscroll-contain"
        style={{ overflowAnchor: "none" }}
      >
        <div className="mx-auto max-w-3xl">
          {groupedMessages.map((item, idx) => (
            item.type === "date" ? (
              <div key={`date-${idx}`} className="flex justify-center py-6">
                <span
                  className="rounded-full border px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest backdrop-blur-md"
                  style={{
                    backgroundColor: "var(--chat-date-bg)",
                    color: "var(--chat-date-fg)",
                    borderColor: "var(--chat-focus-ring)",
                  }}
                >
                  {formatDateLabel(item.date)}
                </span>
              </div>
            ) : (
              <div 
                key={item.message.id} 
                ref={el => { messageRefs.current[item.message.id] = el; }}
                className={`animate-in fade-in slide-in-from-bottom-2 duration-180 ${highlightedId === item.message.id ? "ring-2 ring-primary rounded-3xl ring-offset-4 ring-offset-transparent bg-primary/5 scale-[1.02] transition-all duration-200" : ""}`}
              >
                <MessageBubble
                  message={item.message}
                  mine={item.mine}
                  settings={settings}
                  onLongPress={handleLongPress}
                  onReaction={toggleReaction}
                  onMediaClick={setSelectedMedia}
                  onSwipeReply={(message) => {
                    setEditingMessage(null);
                    setReplyingToMessage(message);
                  }}
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
                />
              </div>
            )
          ))}
          <div ref={messagesEndRef} className="h-4" style={{ overflowAnchor: "auto" }} />
        </div>
      </div>

      {isSelectionMode ? (
        <div className="glass-composer px-6 py-4 flex items-center justify-between animate-in slide-in-from-bottom-full duration-300">
           <button onClick={() => { setIsSelectionMode(false); setSelectedIds(new Set()); }} className="text-sm font-black uppercase text-primary">Отмена</button>
           <div className="flex gap-6">
              <button onClick={handleDeleteSelected} disabled={selectedIds.size === 0} className="touch-target h-12 w-12 rounded-2xl bg-danger/10 text-danger disabled:opacity-30"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg></button>
              <button onClick={() => initiateForward(messages.filter(m => selectedIds.has(m.id)))} disabled={selectedIds.size === 0} className="touch-target h-12 w-12 rounded-2xl bg-primary/10 text-primary disabled:opacity-30"><svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg></button>
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
            onSend={handleSend}
            onTyping={handleTyping}
            onVoiceStart={startRecording}
            onVoiceStop={stopRecording}
            onVoiceCancel={cancelRecording}
            isRecording={isRecording}
            recordingDuration={recordingDuration}
            isLocked={isLocked && currentRole === "MEMBER"}
            pending={pending || uploading}
            replyingTo={replyingToMessage}
            editingTo={editingMessage}
            onCancelAction={() => { setEditingMessage(null); setReplyingToMessage(null); }}
          />
        </>
      )}

      {renderOverlay()}

      {showForwardPicker && (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-xl p-6 animate-in fade-in">
           <div className="w-full max-w-sm rounded-[2.5rem] bg-surface p-6 shadow-2xl">
              <h2 className="text-xl font-black mb-6 px-2">Переслать в...</h2>
              <div className="max-h-80 overflow-y-auto space-y-2 pr-2 scrollbar-hide">
                 {recentChats.length === 0 ? (
                   <div className="rounded-2xl border border-border-subtle/40 bg-surface/60 p-5 text-center text-sm font-medium text-muted">
                     Нет доступных чатов для пересылки.
                   </div>
                 ) : recentChats.map(c => (
                   <button key={c.id} onClick={() => void confirmForward(c.id)} disabled={isForwarding} className="w-full flex items-center gap-4 p-4 rounded-2xl hover:bg-foreground/5 transition-smooth active:scale-95 disabled:opacity-50">
                      <div className="relative h-10 w-10 overflow-hidden rounded-xl bg-primary/10 text-primary flex items-center justify-center font-black">
                        {c.title[0]}
                      </div>
                      <span className="font-bold truncate">{c.title}</span>
                      {isForwarding ? <span className="ml-auto text-xs font-black uppercase text-muted">...</span> : null}
                   </button>
                 ))}
              </div>
              <button onClick={() => setShowForwardPicker(false)} className="w-full mt-6 py-4 font-black uppercase text-muted hover:text-foreground">Отмена</button>
           </div>
        </div>
      )}

      <ChatAppearanceSheet isOpen={isAppearanceOpen} onClose={() => setIsAppearanceOpen(false)} settings={settings} onUpdate={updateSettings} onReset={resetSettings} />
      <MediaViewer item={selectedMedia} onClose={() => setSelectedMedia(null)} />
    </div>
  );
}
