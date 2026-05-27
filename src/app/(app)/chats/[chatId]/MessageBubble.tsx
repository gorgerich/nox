"use client";

import { AppearanceSettings } from "./ChatAppearance";
import { VoicePlayer } from "./VoicePlayer";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { MediaItem } from "./MediaViewer";
import { decryptMediaBlob } from "@/lib/e2ee/media";

const SWIPE_REPLY_THRESHOLD = 64;
const SWIPE_REPLY_MAX = 92;

// Lightweight inline formatting + clickable links for message text.
// Supports **bold**, __italic__, `code`, and http(s) URLs.
const RICH_TEXT_RE = /(\*\*[^*\n]+\*\*|__[^_\n]+__|`[^`\n]+`|https?:\/\/[^\s]+)/g;

function renderRichText(text: string): React.ReactNode {
  const parts = text.split(RICH_TEXT_RE);
  return parts.map((part, i) => {
    if (!part) return null;
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {part}
        </a>
      );
    }
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.length > 4 && part.startsWith("__") && part.endsWith("__")) {
      return <em key={i}>{part.slice(2, -2)}</em>;
    }
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-black/20 px-1 py-0.5 font-mono text-[13px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export type Message = {
  id: string;
  body: string | null;
  ciphertext?: string | null;
  iv?: string | null;
  salt?: string | null;
  algorithm?: string | null;
  encryptionVersion?: number | null;
  isEncrypted?: boolean;
  senderKeyId?: string | null;
  type: "TEXT" | "IMAGE" | "VIDEO" | "VIDEO_NOTE" | "FILE" | "VOICE" | "SYSTEM";
  senderUserId: string;
  deletedAt: string | null;
  editedAt: string | null;
  replyToMessageId: string | null;
  deliveredAt: string | null;
  createdAt: string;
  sender: {
    id: string;
    username: string;
    profile: {
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    url?: string;
    encryptedSizeBytes?: number | null;
    isEncrypted?: boolean;
    mediaEncryptionVersion?: number | null;
    fileIv?: string | null;
    fileAlgorithm?: string | null;
    mediaKeyEnvelopes?: {
      id: string;
      recipientUserId: string;
      recipientDeviceId: string;
      senderDeviceId: string;
      encryptedMediaKey: string;
      iv: string;
      salt: string | null;
      algorithm: string;
      encryptionVersion: number;
      createdAt?: string;
      deliveredAt?: string | null;
      revokedAt?: string | null;
    }[];
  }[];
  reactions: {
    emoji: string;
    userId: string;
    user: {
      id: string;
      username: string;
      profile: { displayName: string } | null;
    };
  }[];
  replyToMessage: {
    id: string;
    body: string | null;
    deletedAt: string | null;
    type: string;
    sender: {
      username: string;
      profile: { displayName: string | null } | null;
    };
  } | null;
  receipts: {
    userId: string;
    deliveredAt: string | null;
    readAt: string | null;
  }[];
  envelopes?: {
    id: string;
    recipientUserId: string;
    recipientDeviceId: string;
    senderDeviceId: string;
    ciphertext: string | null;
    iv: string | null;
    salt: string | null;
    algorithm: string;
    encryptionVersion: number;
    createdAt?: string;
    deliveredAt?: string | null;
    readAt?: string | null;
    encryptedPayloadDeletedAt?: string | null;
  }[];
  messageUnavailableOnThisDevice?: boolean;
};

type Attachment = Message["attachments"][number];

function AttachmentPreview({
  attachment,
  message,
  mine,
  settings,
  onMediaClick,
  chatId,
  localDeviceId,
}: {
  attachment: Attachment;
  message: Message;
  mine: boolean;
  settings: AppearanceSettings;
  onMediaClick: (item: MediaItem) => void;
  chatId?: string;
  currentUserId?: string;
  localDeviceId?: string | null;
}) {
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(() => (
    attachment.isEncrypted ? null : attachment.url ?? null
  ));
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(Boolean(attachment.isEncrypted));

  useEffect(() => {
    if (!attachment.isEncrypted) {
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    async function decryptAttachment() {
      if (!chatId || !localDeviceId || !attachment.fileIv) {
        setIsDecrypting(false);
        setDecryptError("Медиа недоступно на этом устройстве");
        return;
      }

      const envelope = attachment.mediaKeyEnvelopes?.find((item) => item.recipientDeviceId === localDeviceId);
      if (!envelope) {
        setIsDecrypting(false);
        setDecryptError("Медиа недоступно на этом устройстве");
        return;
      }

      setIsDecrypting(true);
      setDecryptError(null);

      try {
        const response = await fetch(`/api/attachments/${attachment.id}/download`);
        if (!response.ok) throw new Error("DOWNLOAD_FAILED");
        const encryptedBlob = await response.blob();
        const decryptedBlob = await decryptMediaBlob({
          encryptedBlob,
          fileIv: attachment.fileIv,
          senderUserId: message.senderUserId,
          senderDeviceId: envelope.senderDeviceId,
          chatId,
          envelope,
          mimeType: attachment.mimeType,
        });

        if (!decryptedBlob) throw new Error("DECRYPT_FAILED");
        objectUrl = URL.createObjectURL(decryptedBlob);
        if (!cancelled) {
          setDecryptedUrl(objectUrl);
          setIsDecrypting(false);
        }
      } catch {
        if (!cancelled) {
          setIsDecrypting(false);
          setDecryptError("Не удалось расшифровать медиа");
        }
      }
    }

    void decryptAttachment();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    attachment.fileIv,
    attachment.id,
    attachment.isEncrypted,
    attachment.mediaKeyEnvelopes,
    attachment.mimeType,
    attachment.url,
    chatId,
    localDeviceId,
    message.senderUserId,
  ]);

  const sourceUrl = attachment.isEncrypted
    ? decryptedUrl
    : decryptedUrl || `/api/attachments/${attachment.id}/download`;
  const isImage = attachment.mimeType.startsWith("image/");
  const isVideo = attachment.mimeType.startsWith("video/");
  // Round video messages ("кружочки") are flagged by the message type (survives E2EE,
  // unlike the filename which is hidden for encrypted media).
  const isRoundVideo = isVideo && message.type === "VIDEO_NOTE";

  if (isDecrypting) {
    return (
      <div className="mt-2 first:mt-0 rounded-lg border border-border-subtle bg-surface-muted/60 px-3 py-2 text-[11px] font-semibold text-muted">
        Расшифровка медиа…
      </div>
    );
  }

  if (decryptError || !sourceUrl) {
    return (
      <div className="mt-2 first:mt-0 rounded-lg border border-border-subtle bg-surface-muted/60 px-3 py-2 text-[11px] font-semibold text-muted">
        {decryptError || "Медиа недоступно на этом устройстве"}
      </div>
    );
  }

  return (
    <div className="mt-2 first:mt-0 overflow-hidden rounded-lg">
      {message.type === "VOICE" ? (
        <VoicePlayer
          src={sourceUrl}
          isMine={mine}
          cornerRadius={settings.bubbleRadius}
        />
      ) : isImage ? (
        <div
          className="relative overflow-hidden rounded-lg border border-black/5 cursor-pointer active:opacity-90 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onMediaClick({ id: attachment.id, type: "IMAGE", url: sourceUrl, fileName: attachment.fileName }); }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceUrl}
            alt=""
            className="max-h-96 w-full object-cover transition-smooth hover:scale-105"
            loading="lazy"
          />
        </div>
      ) : isRoundVideo ? (
        <div
          className="relative mx-auto my-1 h-56 w-56 cursor-pointer overflow-hidden rounded-full border border-white/10 shadow-lg active:opacity-90"
          onClick={(e) => { e.stopPropagation(); onMediaClick({ id: attachment.id, type: "VIDEO", url: sourceUrl, fileName: attachment.fileName }); }}
        >
          <video src={sourceUrl} className="h-full w-full object-cover" autoPlay loop muted playsInline preload="metadata" />
          <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[10px] font-bold text-white">
            <svg className="inline h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </div>
      ) : isVideo ? (
        <div
          className="relative overflow-hidden rounded-lg cursor-pointer active:opacity-90 transition-opacity flex items-center justify-center"
          style={{
            backgroundColor: mine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)",
            border: "1px solid var(--bubble-incoming-border)",
          }}
          onClick={(e) => { e.stopPropagation(); onMediaClick({ id: attachment.id, type: "VIDEO", url: sourceUrl, fileName: attachment.fileName }); }}
        >
          <video src={sourceUrl} className="max-h-96 w-full object-cover" preload="metadata" muted playsInline />
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
              <svg className="h-6 w-6" style={{ color: "white" }} fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        </div>
      ) : (
        <div
          className="flex cursor-pointer items-center gap-3 rounded-xl p-4 backdrop-blur-md transition-smooth"
          style={{
            backgroundColor: mine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)",
            border: "1px solid var(--bubble-incoming-border)",
          }}
          onClick={(e) => {
            e.stopPropagation();
            const link = document.createElement("a");
            link.href = sourceUrl;
            link.download = attachment.fileName || "nox-file";
            link.target = "_self";
            link.click();
          }}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-inner" style={{ backgroundColor: "rgba(255,255,255,0.2)", color: mine ? "var(--bubble-outgoing-fg)" : "var(--bubble-incoming-fg)" }}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-black tracking-tight">{attachment.fileName}</p>
            <p className="text-[9px] font-black opacity-50 uppercase tracking-widest mt-0.5">
              {(attachment.sizeBytes / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export const MessageBubble = memo(function MessageBubble({
  message,
  mine,
  settings,
  onLongPress,
  onReaction,
  onMediaClick,
  onSwipeReply,
  onReplyPreviewClick,
  isGroupStart,
  isGroupEnd,
  showDisplayName,
  isSelected = false,
  selectionMode = false,
  onSelect,
  isFocused = false,
  searchQuery = "",
  chatId,
  currentUserId,
  localDeviceId,
}: {
  message: Message;
  mine: boolean;
  settings: AppearanceSettings;
  onLongPress: (id: string, rect: DOMRect) => void;
  onReaction: (id: string, emoji: string) => void;
  onMediaClick: (item: MediaItem) => void;
  onSwipeReply?: (message: Message) => void;
  onReplyPreviewClick?: (messageId: string) => void;
  isGroupStart: boolean;
  isGroupEnd: boolean;
  showDisplayName: boolean;
  isSelected?: boolean;
  selectionMode?: boolean;
  onSelect?: (id: string) => void;
  isFocused?: boolean;
  searchQuery?: string;
  chatId?: string;
  currentUserId?: string;
  localDeviceId?: string | null;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const replyIconRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef<{ x: number; y: number } | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const directionRef = useRef<"horizontal" | "vertical" | null>(null);
  const swipeTriggeredRef = useRef(false);
  const swipeOffsetRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  const canSwipeReply = Boolean(onSwipeReply && !selectionMode && !message.deletedAt && message.type !== "SYSTEM");

  const clearLongPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const updateDOM = useCallback((offset: number) => {
    if (bubbleRef.current) {
      bubbleRef.current.style.transform = `translate3d(${offset}px, 0, 0)`;
    }
    if (replyIconRef.current) {
      replyIconRef.current.style.opacity = String(Math.min(1, offset / SWIPE_REPLY_THRESHOLD));
    }
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (selectionMode || !event.isPrimary) return;
    if (rowRef.current) {
      rowRef.current.setPointerCapture(event.pointerId);
    }
    pointerIdRef.current = event.pointerId;
    const point = { x: event.clientX, y: event.clientY };
    startPosRef.current = point;
    directionRef.current = null;
    swipeTriggeredRef.current = false;
    swipeOffsetRef.current = 0;
    
    timerRef.current = setTimeout(() => {
      if (bubbleRef.current) {
        onLongPress(message.id, bubbleRef.current.getBoundingClientRect());
      }
      timerRef.current = null;
    }, 600);
  }, [message.id, onLongPress, selectionMode]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!startPosRef.current || pointerIdRef.current !== event.pointerId) return;
    const rawDx = event.clientX - startPosRef.current.x;
    const rawDy = event.clientY - startPosRef.current.y;
    const dx = Math.abs(rawDx);
    const dy = Math.abs(rawDy);

    if (!directionRef.current) {
      if (dy > 6 && dy > dx) {
        directionRef.current = "vertical";
        clearLongPress();
        return;
      }
      if (dx > 8 && dx > dy * 1.2) {
        directionRef.current = "horizontal";
        clearLongPress();
      } else {
        return;
      }
    }

    if (directionRef.current !== "horizontal") {
      return;
    }

    if (!canSwipeReply) {
      return;
    }

    // prevent default to stop scroll or selection when swiping horizontally
    event.preventDefault();

    const clamped = Math.max(0, Math.min(SWIPE_REPLY_MAX, rawDx));
    swipeOffsetRef.current = clamped;
    
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(() => {
        updateDOM(swipeOffsetRef.current);
        rafIdRef.current = null;
      });
    }
  }, [canSwipeReply, clearLongPress, updateDOM]);

  const resetGesture = useCallback(() => {
    if (rowRef.current && pointerIdRef.current !== null) {
      rowRef.current.releasePointerCapture(pointerIdRef.current);
    }
    pointerIdRef.current = null;
    startPosRef.current = null;
    directionRef.current = null;
    swipeTriggeredRef.current = false;
    swipeOffsetRef.current = 0;
    clearLongPress();
    
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    
    if (bubbleRef.current) {
      bubbleRef.current.style.transition = "transform 250ms cubic-bezier(0.4, 0, 0.2, 1)";
      bubbleRef.current.style.transform = "translate3d(0, 0, 0)";
    }
    if (replyIconRef.current) {
      replyIconRef.current.style.transition = "opacity 250ms ease";
      replyIconRef.current.style.opacity = "0";
    }
    
    setTimeout(() => {
      if (bubbleRef.current) bubbleRef.current.style.transition = "";
      if (replyIconRef.current) replyIconRef.current.style.transition = "";
    }, 250);
  }, [clearLongPress]);

  const handlePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }

    if (canSwipeReply && swipeOffsetRef.current >= SWIPE_REPLY_THRESHOLD && !swipeTriggeredRef.current) {
      swipeTriggeredRef.current = true;
      onSwipeReply?.(message);
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(10);
      }
    }

    resetGesture();
  }, [canSwipeReply, message, onSwipeReply, resetGesture]);

  const handleClick = () => {
    if (selectionMode && onSelect) {
      onSelect(message.id);
    }
  };

  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt));

  const isRound = settings.bubbleRadius === "round";
  const rBase = isRound ? "var(--radius-2xl)" : "var(--radius-lg)";
  const rSmall = "var(--radius-xs)";
  
  const radiusStyle = mine 
    ? {
        borderTopLeftRadius: rBase,
        borderBottomLeftRadius: rBase,
        borderTopRightRadius: isGroupStart ? rSmall : rBase,
        borderBottomRightRadius: isGroupEnd ? rBase : rSmall,
      }
    : {
        borderTopRightRadius: rBase,
        borderBottomRightRadius: rBase,
        borderTopLeftRadius: isGroupStart ? rSmall : rBase,
        borderBottomLeftRadius: isGroupEnd ? rBase : rSmall,
      };

  const bubbleStyle: React.CSSProperties = mine
    ? {
        backgroundColor: "var(--bubble-outgoing-bg)",
        color: "var(--bubble-outgoing-fg)",
        ...radiusStyle,
      }
    : {
        backgroundColor: "var(--bubble-incoming-bg)",
        color: "var(--bubble-incoming-fg)",
        border: "1px solid var(--bubble-incoming-border)",
        ...radiusStyle,
      };

  const incomingClass = settings.incomingStyle === "glass"
    ? "bg-surface-elevated"
    : settings.incomingStyle === "minimal"
      ? "bg-transparent"
      : "";

  const groupedReactions = message.reactions.reduce((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, me: false };
    acc[r.emoji].count++;
    return acc;
  }, {} as Record<string, { count: number; me: boolean }>);

  const relevantReceipts = message.receipts?.filter((receipt) => receipt.userId !== message.senderUserId) ?? [];
  const isRead = relevantReceipts.some((receipt) => Boolean(receipt.readAt));
  const isDelivered = relevantReceipts.some((receipt) => Boolean(receipt.deliveredAt));

  if (message.messageUnavailableOnThisDevice) {
    return (
      <div className="relative flex w-full justify-center px-4 py-1.5">
        <div className="max-w-[82%] rounded-full border border-border-subtle bg-surface-muted/70 px-3 py-1.5 text-center text-[11px] font-semibold text-muted">
          Сообщение недоступно на этом устройстве
        </div>
      </div>
    );
  }

  if (message.isEncrypted && !message.body && message.attachments.length === 0) {
    return (
      <div className="relative flex w-full justify-center px-4 py-1.5">
        <div className="max-w-[82%] rounded-full border border-border-subtle bg-surface-muted/70 px-3 py-1.5 text-center text-[11px] font-semibold text-muted">
          Загрузка зашифрованного сообщения…
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={rowRef}
      className={`relative flex items-center w-full mb-1 transition-colors duration-200 ${selectionMode ? "cursor-pointer" : ""} ${isSelected ? "bg-primary/5" : ""} touch-pan-y no-select`}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div className={`flex items-center gap-3 w-full px-4 ${isSelected ? "opacity-100" : selectionMode ? "opacity-60" : ""}`}>
        {selectionMode && (
          <div className={`flex shrink-0 items-center justify-center h-6 w-6 rounded-full border-2 transition-smooth ${isSelected ? "bg-primary border-primary shadow-lg shadow-primary/20 scale-110" : "border-muted/30"}`}>
            {isSelected && (
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        <div className={`flex flex-col flex-1 ${mine ? "items-end" : "items-start"}`}>
          {showDisplayName && !mine && (
            <span className="mb-1 ml-3 text-[10px] font-black uppercase tracking-widest" style={{ color: "var(--bubble-incoming-muted)" }}>
              {message.sender.profile?.displayName ?? message.sender.username}
            </span>
          )}

          <div className="relative max-w-[85%]">
            {canSwipeReply ? (
              <div 
                ref={replyIconRef}
                className="absolute right-full mr-4 flex h-9 w-9 items-center justify-center rounded-full border border-border-subtle/50 bg-surface/80 text-primary shadow-sm transition-opacity duration-150"
                style={{ opacity: 0, top: '50%', transform: 'translateY(-50%)' }}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </div>
            ) : null}

            <div
              ref={bubbleRef}
              className={`group relative px-4 py-2.5 cursor-default active:scale-[0.99] no-select ${
                isFocused ? "focused-message" : ""
              } shadow-sm ${mine ? "" : incomingClass}`}
              style={{
                ...bubbleStyle,
                willChange: "transform",
              }}
              onContextMenu={(e) => { 
                e.preventDefault(); 
              }}
            >
          {message.replyToMessage && (
            <div
              className={`mb-2 border-l-2 py-0.5 pl-2.5 text-[11px] leading-tight opacity-90 ${message.replyToMessage.deletedAt ? "" : "cursor-pointer active:opacity-80"}`}
              style={{
                borderColor: mine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)",
                color: mine ? "var(--bubble-outgoing-fg)" : "var(--bubble-incoming-fg)",
              }}
              onClick={(event) => {
                if (!message.replyToMessage || message.replyToMessage.deletedAt) {
                  return;
                }
                event.stopPropagation();
                onReplyPreviewClick?.(message.replyToMessage.id);
              }}
            >
              <p className="font-black truncate tracking-tight">{message.replyToMessage.sender.profile?.displayName || message.replyToMessage.sender.username}</p>
              <p className="truncate line-clamp-1 italic opacity-70">
                {message.replyToMessage.deletedAt ? "Исходное сообщение удалено" : (message.replyToMessage.body || "Вложение")}
              </p>
            </div>
          )}

          <>
            {message.body && (
              <p className="whitespace-pre-wrap text-[15px] leading-snug font-medium break-words mb-2 last:mb-0">
                {searchQuery ? (
                  message.body.split(new RegExp(`(${searchQuery})`, "gi")).map((part, i) =>
                    part.toLowerCase() === searchQuery.toLowerCase() ? (
                      <mark key={i} className="bg-primary/30 text-inherit rounded-sm px-0.5">
                        {part}
                      </mark>
                    ) : (
                      part
                    )
                  )
                ) : (
                  renderRichText(message.body)
                )}
              </p>
            )}
            {message.attachments?.map((att) => (
              <AttachmentPreview
                key={att.id}
                attachment={att}
                message={message}
                mine={mine}
                settings={settings}
                onMediaClick={onMediaClick}
                chatId={chatId}
                currentUserId={currentUserId}
                localDeviceId={localDeviceId}
              />
            ))}
          </>

          <div className={`mt-1 flex items-center gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
            <span
              className="text-[9px] font-black uppercase tracking-tighter"
              style={{ color: mine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)" }}
            >
              {message.editedAt && "изм. "}{time}
            </span>
            {mine && !message.deletedAt && (
              <div className="flex items-center ml-0.5">
                {isRead ? (
                  <div className="flex -space-x-1.5">
                    <svg className="h-3 w-3 animate-in fade-in" style={{ color: "var(--message-read)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    <svg className="h-3 w-3 animate-in fade-in" style={{ color: "var(--message-read)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : isDelivered ? (
                  <div className="flex -space-x-1.5">
                    <svg className="h-3 w-3" style={{ color: "var(--message-tick)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    <svg className="h-3 w-3" style={{ color: "var(--message-tick)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <svg className="h-3 w-3" style={{ color: "var(--message-tick)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            )}
          </div>
          </div>
        </div>

        {Object.keys(groupedReactions).length > 0 && !selectionMode && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "mr-1" : "ml-1"} animate-in fade-in zoom-in-95 duration-200`}>
            {Object.entries(groupedReactions).map(([emoji, info]) => (
              <button
                key={emoji}
                onClick={(e) => { e.stopPropagation(); onReaction(message.id, emoji); }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-muted border border-border-subtle text-xs font-black text-foreground/70 transition-smooth hover:bg-surface-hover active:scale-90 shadow-sm"
              >
                <span>{emoji}</span>
                <span className="text-[10px]">{info.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
  );
});
