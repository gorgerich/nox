"use client";

import { AppearanceSettings } from "./ChatAppearance";
import { reportClientEvent } from "@/lib/report-client-event";
import { VoicePlayer } from "./VoicePlayer";
import { FileText, Play } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { MediaItem } from "./MediaViewer";
import { decryptMediaBlob } from "@/lib/e2ee/media";
import { useFormattedTimestamp } from "@/lib/time-format";
import { getMediaUrl, putMediaUrl } from "@/lib/media-cache";
import { escapeRegExp } from "@/lib/text";
import {
  isVisualOnlyBubble,
  type AttachmentRenderMode,
} from "@/lib/message-visibility";
import { quoteLabel } from "@/lib/reply-quote";

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
        <code key={i} className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-[0.8125rem]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export type Message = {
  id: string;
  /** The id this device (or whichever device actually sent it) minted on
      creation, echoed back verbatim by the server. Used to fold a server-
      confirmed message onto its own optimistic outbox entry when the socket
      echo that would normally do this never arrives. */
  clientMessageId?: string | null;
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
    width?: number | null;
    height?: number | null;
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
type MediaKeyEnvelope = NonNullable<Attachment["mediaKeyEnvelopes"]>[number];

function AttachmentPreview({
  attachment,
  message,
  mine,
  settings,
  onMediaClick,
  chatId,
  localDeviceId,
  onUnavailable,
  onRenderMode,
}: {
  attachment: Attachment;
  message: Message;
  mine: boolean;
  settings: AppearanceSettings;
  onMediaClick: (item: MediaItem) => void;
  chatId?: string;
  currentUserId?: string;
  localDeviceId?: string | null;
  /** Fired once, the moment this attachment settles into "unavailable on this device". */
  onUnavailable?: () => void;
  /**
   * What this attachment actually put on screen. The parent needs it because
   * it decides whether the bubble is "media only" — transparent, unpadded,
   * with the timestamp floating over the picture. When the media turns out not
   * to be a picture at all, that bubble has nothing left to show behind the
   * timestamp, and a lone `18:28 ✓✓` is what the user sees.
   */
  onRenderMode?: (mode: AttachmentRenderMode) => void;
}) {
  // Seed from the RAM media cache so already-decrypted media shows instantly on
  // re-open / scroll-back (no re-download, no "Расшифровка медиа…" flash).
  const cachedMediaUrl = attachment.isEncrypted ? getMediaUrl(attachment.id) : null;
  const [decryptedUrl, setDecryptedUrl] = useState<string | null>(() => (
    attachment.isEncrypted ? cachedMediaUrl : attachment.url ?? null
  ));
  const [decryptError, setDecryptError] = useState<string | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(Boolean(attachment.isEncrypted) && !cachedMediaUrl);
  // Some stored attachments are truncated — production holds images of 70
  // bytes from an old upload fault. They decrypt to something the decoder
  // rejects, so the <img> paints nothing and the bubble reads as empty. The
  // element tells us; nothing else can.
  const [imageBroken, setImageBroken] = useState(false);
  // Playing, not expanded: the circle is the same size either way.
  const [roundPlaying, setRoundPlaying] = useState(false);
  const [roundProgress, setRoundProgress] = useState(0);
  const roundVideoRef = useRef<HTMLVideoElement>(null);

  // `localDeviceId` starts null on every cold open — it comes from an async
  // read of the local key store — and is genuinely absent, briefly, for
  // attachments that are perfectly fine. Treating that the same as "no
  // envelope was ever addressed to this device" made every media message on
  // screen at the moment of a fresh load flash to permanently hidden before
  // the real id had a chance to arrive: this component would report itself
  // unavailable, the list would blacklist the message, and by the time
  // `localDeviceId` resolved a render or two later there was no mounted
  // component left to notice. `notReady` below is exactly the missing
  // distinction — it waits rather than verdicts.
  const notReady = !chatId || !localDeviceId || !attachment.fileIv;
  const envelope = !notReady
    ? attachment.mediaKeyEnvelopes?.find((item) => item.recipientDeviceId === localDeviceId)
    : undefined;
  // True once "no envelope" has been true for a while — the media
  // equivalent of the text bubble's `settledUndecryptable`, and for the same
  // reason: an envelope that has not shown up yet (this message just arrived
  // and the history fetch that carries it is a beat behind the socket echo)
  // must not be declared permanently missing on the first render that sees it.
  // Never reset back to false: this component is keyed by attachment id (see
  // the `.map()` call site), so one instance only ever lives through one
  // envelope's story — an envelope found after settling already makes
  // `confirmedUnavailable` false via `!envelope` below, with no need to also
  // rewind this flag.
  const [envelopeSettled, setEnvelopeSettled] = useState(false);
  useEffect(() => {
    if (notReady || envelope) return;
    const timer = window.setTimeout(() => setEnvelopeSettled(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [notReady, envelope]);
  const confirmedUnavailable = !notReady && !envelope && envelopeSettled;

  const reportedUnavailableRef = useRef(false);
  useEffect(() => {
    if (!confirmedUnavailable || reportedUnavailableRef.current) return;
    reportedUnavailableRef.current = true;
    setDecryptError("Медиа недоступно на этом устройстве");
    setIsDecrypting(false);
    onUnavailable?.();
  }, [confirmedUnavailable, onUnavailable]);

  useEffect(() => {
    if (!attachment.isEncrypted) {
      return;
    }

    // Already cached this session — nothing to do, URL was seeded into state.
    if (getMediaUrl(attachment.id)) {
      return;
    }

    // Not ready yet (device id still loading) or confirmed-absent-forever —
    // either way there is nothing to attempt right now. The `notReady` case
    // re-enters this effect on its own once `localDeviceId` deps change;
    // the confirmed case is handled by the effect above, once. Re-checked
    // explicitly (rather than trusting the `notReady`/`envelope` closed-over
    // booleans) so the compiler narrows `chatId` and `attachment.fileIv` to
    // non-nullable for the async function below.
    if (!chatId || !attachment.fileIv || !envelope) {
      return;
    }
    const fileIv = attachment.fileIv;
    const activeChatId = chatId;

    let cancelled = false;

    async function decryptAttachment(envelope: MediaKeyEnvelope) {
      setIsDecrypting(true);
      setDecryptError(null);

      try {
        const response = await fetch(`/api/attachments/${attachment.id}/download`);
        if (!response.ok) throw new Error("DOWNLOAD_FAILED");
        const encryptedBlob = await response.blob();
        const decryptedBlob = await decryptMediaBlob({
          encryptedBlob,
          fileIv,
          senderUserId: message.senderUserId,
          senderDeviceId: envelope.senderDeviceId,
          chatId: activeChatId,
          envelope,
          mimeType: attachment.mimeType,
        });

        if (!decryptedBlob) throw new Error("DECRYPT_FAILED");
        const freshUrl = URL.createObjectURL(decryptedBlob);
        // Hand the URL to the cache (it owns the lifetime). If another bubble
        // already cached it, the cache returns the existing one and we drop ours.
        const ownedUrl = putMediaUrl(attachment.id, freshUrl);
        if (ownedUrl !== freshUrl) {
          try { URL.revokeObjectURL(freshUrl); } catch { /* ignore */ }
        }
        if (!cancelled) {
          setDecryptedUrl(ownedUrl);
          setIsDecrypting(false);
        }
      } catch {
        if (!cancelled) {
          setIsDecrypting(false);
          setDecryptError("Не удалось расшифровать медиа");
        }
      }
    }

    void decryptAttachment(envelope);

    // NOTE: do not revoke the object URL on unmount — the media cache owns it so
    // it can be reused instantly on re-open/scroll-back. The cache revokes on LRU
    // eviction.
    return () => {
      cancelled = true;
    };
  }, [
    notReady,
    envelope,
    attachment.id,
    attachment.isEncrypted,
    attachment.mimeType,
    attachment.url,
    chatId,
    attachment.fileIv,
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
  const roundProgressLength = 2 * Math.PI * 47;

  /**
   * The same bounded wait the text bubble uses. Media whose key envelope was
   * never addressed to this device cannot be decrypted here, and the shimmer
   * for it is permanent — a silent grey box that never becomes a photo.
   */
  useEffect(() => {
    if (!isDecrypting) return;
    const timer = window.setTimeout(() => {
      setIsDecrypting(false);
      setDecryptError((current) => current ?? "Медиа недоступно на этом устройстве");
      reportClientEvent("client.media.decrypt.failed");
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [isDecrypting]);

  // Reserve the media box from known dimensions so the bubble doesn't resize
  // (jump/jitter) when the image/video finishes decrypting or decoding.
  const ratioStyle: React.CSSProperties = attachment.width && attachment.height
    ? { aspectRatio: `${attachment.width} / ${attachment.height}` }
    : { minHeight: "12rem" };

  const toggleRoundVideo = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const video = roundVideoRef.current;
    if (!video) return;

    if (roundPlaying) {
      video.pause();
      video.muted = true;
      setRoundPlaying(false);
      setRoundProgress(0);
      return;
    }

    setRoundPlaying(true);
    setRoundProgress(0);
    video.loop = false;
    video.muted = false;
    video.currentTime = 0;
    void video.play().catch(() => {
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }, [roundPlaying]);

  // The single place that decides what this attachment is about to draw. The
  // early returns below follow it exactly, so what the parent is told and what
  // the user sees can never disagree.
  const renderMode: AttachmentRenderMode =
    isDecrypting
      // A shimmer for image/video is already the right size and shape, so the
      // bubble may stay media-shaped through it and not flicker its chrome on
      // and off around decryption. The textual one is not media.
      ? (isImage || isVideo || isRoundVideo ? "media" : "fallback")
      : imageBroken
        ? "fallback"
        : decryptError === "Медиа недоступно на этом устройстве"
          ? "hidden"
          : decryptError || !sourceUrl
            ? "fallback"
            : "media";

  useEffect(() => {
    onRenderMode?.(renderMode);
  }, [renderMode, onRenderMode]);

  if (isDecrypting) {
    // Sized shimmer that matches the final media box — keeps layout stable so
    // the conversation doesn't jump when decryption completes.
    if (isRoundVideo) {
      return <div className="mt-2 first:mt-0 mx-auto my-1 h-56 w-56 rounded-full bg-surface-muted/60 animate-pulse" />;
    }
    if (isImage || isVideo) {
      return (
        <div
          className="mt-2 first:mt-0 w-full max-w-xs rounded-xl bg-surface-muted/60 animate-pulse"
          style={ratioStyle}
        />
      );
    }
    return (
      <div className="mt-2 first:mt-0 rounded-xl border border-border-subtle bg-surface-muted/60 px-3 py-2 text-[0.75rem] font-medium text-muted">
        Расшифровка медиа…
      </div>
    );
  }

  if (imageBroken) {
    return (
      <div className="mt-2 first:mt-0 rounded-xl border border-border-subtle bg-surface-muted/60 px-3 py-2 text-[0.75rem] font-medium text-muted">
        Изображение не открывается
      </div>
    );
  }

  if (decryptError === "Медиа недоступно на этом устройстве") {
    return null;
  }

  if (decryptError || !sourceUrl) {
    return (
      <div className="mt-2 first:mt-0 rounded-xl border border-border-subtle bg-surface-muted/60 px-3 py-2 text-[0.75rem] font-medium text-muted">
        {decryptError || "Медиа недоступно на этом устройстве"}
      </div>
    );
  }

  return (
    <div className="mt-2 first:mt-0 overflow-hidden rounded-xl">
      {message.type === "VOICE" ? (
        <VoicePlayer
          src={sourceUrl}
          isMine={mine}
          cornerRadius={settings.bubbleRadius}
          // The attachment id, not the src: an encrypted voice note's src is a
          // blob URL minted fresh on every decrypt, so seeding from it would
          // redraw the waveform each time the chat is reopened.
          waveformSeed={attachment.id}
        />
      ) : isImage ? (
        <button
          type="button"
          aria-label={`Открыть изображение ${attachment.fileName}`}
          className="relative w-full max-w-xs cursor-pointer overflow-hidden rounded-xl transition-opacity active:opacity-90"
          style={{ ...ratioStyle, maxHeight: "24rem" }}
          onClick={(e) => { e.stopPropagation(); onMediaClick({ id: attachment.id, type: "IMAGE", url: sourceUrl, fileName: attachment.fileName }); }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sourceUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover transition-smooth hover:scale-[1.02]"
            loading="lazy"
            onError={() => {
              setImageBroken(true);
              reportClientEvent("client.media.broken", { detail: attachment.mimeType });
            }}
          />
        </button>
      ) : isRoundVideo ? (
        <button
          type="button"
          aria-label={roundPlaying ? "Пауза" : "Воспроизвести видеосообщение"}
          /* Sized once and scaled, rather than animating width and height.
             Those two are layout properties: every frame of the old transition
             ran layout and paint for the whole message list, on the main thread.
             transform is composited, so the same expansion costs nothing beyond
             the GPU — and scale carries the video and the rounding with it. */
          /* One size, always.
             Tapping used to scale the circle up to `min(76vw, 24rem)`, which
             on a phone is most of the screen: the bubble grew mid-conversation,
             pushed its neighbours around and read as the chat coming apart.
             Playback is a state, not a size — so it is now shown by the
             progress ring and the audio, and the geometry never moves.
             The width is viewport-relative with a cap, so a 320px phone gets a
             smaller circle without a second breakpoint, and `aspect-square`
             keeps it round whatever the video's own dimensions turn out to be. */
          className="relative mx-auto my-1 aspect-square w-[min(64vw,15rem)] cursor-pointer overflow-hidden rounded-full shadow-sm transition-opacity duration-200 active:opacity-90"
          onClick={toggleRoundVideo}
        >
          <video
            ref={roundVideoRef}
            src={sourceUrl}
            className="h-full w-full object-cover"
            autoPlay
            loop={!roundPlaying}
            muted={!roundPlaying}
            playsInline
            preload="metadata"
            onTimeUpdate={(event) => {
              const video = event.currentTarget;
              if (!roundPlaying || !video.duration || Number.isNaN(video.duration)) return;
              setRoundProgress(Math.min(1, video.currentTime / video.duration));
            }}
            onEnded={() => {
              setRoundPlaying(false);
              setRoundProgress(0);
              const video = roundVideoRef.current;
              if (video) {
                video.muted = true;
                video.currentTime = 0;
                void video.play().catch(() => undefined);
              }
            }}
          />
          {roundPlaying ? (
            <svg className="pointer-events-none absolute inset-1 -rotate-90 text-white drop-shadow" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeOpacity="0.26" strokeWidth="2.5" />
              <circle
                cx="50"
                cy="50"
                r="47"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2.5"
                strokeDasharray={`${roundProgress * roundProgressLength} ${roundProgressLength}`}
              />
            </svg>
          ) : null}
          <div className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-black/45 px-2 py-0.5 text-[0.625rem] font-bold text-white">
            <svg className="inline h-3 w-3" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
          </div>
        </button>
      ) : isVideo ? (
        <button
          type="button"
          aria-label={`Открыть видео ${attachment.fileName}`}
          className="relative flex w-full max-w-xs cursor-pointer items-center justify-center overflow-hidden rounded-xl transition-opacity active:opacity-90"
          style={{
            ...ratioStyle,
            maxHeight: "24rem",
            backgroundColor: mine
              ? "color-mix(in srgb, var(--bubble-outgoing-fg) 14%, transparent)"
              : "color-mix(in srgb, var(--bubble-incoming-fg) 8%, transparent)",
            border: "1px solid var(--bubble-incoming-border)",
          }}
          onClick={(e) => { e.stopPropagation(); onMediaClick({ id: attachment.id, type: "VIDEO", url: sourceUrl, fileName: attachment.fileName }); }}
        >
          <video src={sourceUrl} className="absolute inset-0 h-full w-full object-cover" preload="metadata" muted playsInline />
          <div className="absolute inset-0 flex items-center justify-center" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/35 text-white">
              <Play className="ml-0.5 h-6 w-6" fill="currentColor" strokeWidth={0} />
            </div>
          </div>
        </button>
      ) : (
        <button
          type="button"
          aria-label={`Скачать файл ${attachment.fileName}`}
          // w-full/min-w-0 keeps a long file name inside the bubble instead of
          // widening the chip until the text spills past the bubble edge.
          className="flex w-full min-w-0 max-w-full cursor-pointer items-center gap-3 rounded-xl p-3 text-left transition-smooth active:opacity-85"
          style={{
            backgroundColor: mine
              ? "color-mix(in srgb, var(--bubble-outgoing-fg) 14%, transparent)"
              : "color-mix(in srgb, var(--bubble-incoming-fg) 8%, transparent)",
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: mine ? "var(--bubble-outgoing-muted)" : "var(--chat-focus-ring)", color: mine ? "var(--bubble-outgoing-fg)" : "var(--bubble-incoming-fg)" }}>
            <FileText className="h-5 w-5" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{attachment.fileName}</p>
            <p className="mt-0.5 text-[0.6875rem] font-medium opacity-60">
              {(attachment.sizeBytes / 1024 / 1024).toFixed(1)} MB
            </p>
          </div>
        </button>
      )}
    </div>
  );
}

/**
 * True once a send has been in flight long enough to be worth mentioning.
 *
 * Threshold, not spinner: below it the user sees no status at all, which is
 * the honest rendering of "this is going through normally". A local send on a
 * good connection resolves well inside the window, so in ordinary use the
 * indicator never appears.
 */
function usePendingMark(pending: boolean, delayMs = 500): boolean {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setElapsed(true), delayMs);
    return () => clearTimeout(timer);
  }, [pending, delayMs]);

  // Read through `pending` rather than reset in the effect: once the message
  // is sent the mark is gone regardless of what the timer did, and there is no
  // synchronous state write on the way there.
  return pending && elapsed;
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
  isFailed = false,
  onRetry,
  onUnavailable,
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
  isFailed?: boolean;
  onRetry?: (messageId: string) => void;
  /** Fired once, the moment this message is confirmed to render nothing at
      all — every attachment unavailable, or an encrypted body that never
      settled. Lets the list drop a date separator that would otherwise stand
      over an empty message. */
  onUnavailable?: (messageId: string) => void;
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

  // Hydration-safe: the server and the first client render both use the
  // reference zone, and the viewer's own time appears in the re-render right
  // after hydration. Formatting here with the browser's zone is what produced
  // the production hydration mismatch on every message.
  const time = useFormattedTimestamp(message.createdAt, "time");

  const isRound = settings.bubbleRadius === "round";
  const rBase = isRound ? "20px" : "16px";
  const rSmall = "6px";
  
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

  /**
   * An encrypted message with no body has either not been decrypted yet or
   * never will be — and until now the two looked identical, both spinning on
   * "Загрузка зашифрованного сообщения…" indefinitely. A message sent before
   * this device existed has no envelope addressed to it and will never gain
   * one, so the spinner was permanent and read as the app being stuck.
   *
   * After a bounded wait the state becomes terminal and says so. The wait is
   * generous: decryption on a cold cache legitimately takes a few seconds.
   */
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const undecryptable = message.isEncrypted && !message.body && message.attachments.length === 0;
  const settledUndecryptable = undecryptable && settledFor === message.id;
  useEffect(() => {
    if (!undecryptable) return;
    const timer = window.setTimeout(() => {
      setSettledFor(message.id);
      reportClientEvent("client.decrypt.timeout");
    }, 12_000);
    return () => window.clearTimeout(timer);
  }, [undecryptable, message.id]);

  // Every attachment on a media-only message settling into "unavailable on
  // this device" (each one reports itself, asynchronously and on its own
  // timer) is the media equivalent of settledUndecryptable above: a message
  // that will never have anything to show.
  const [unavailableAttachmentIds, setUnavailableAttachmentIds] = useState<Set<string>>(() => new Set());
  const handleAttachmentUnavailable = useCallback((attachmentId: string) => {
    setUnavailableAttachmentIds((prev) => (prev.has(attachmentId) ? prev : new Set(prev).add(attachmentId)));
  }, []);

  // What each attachment actually drew. Reported by the attachment itself,
  // because only it knows whether the bytes turned into a picture.
  const [attachmentModes, setAttachmentModes] = useState<Record<string, AttachmentRenderMode>>({});
  const handleAttachmentRenderMode = useCallback((attachmentId: string, mode: AttachmentRenderMode) => {
    setAttachmentModes((prev) => (prev[attachmentId] === mode ? prev : { ...prev, [attachmentId]: mode }));
  }, []);
  const allAttachmentsUnavailable =
    message.attachments.length > 0
    && message.attachments.every((attachment) =>
      unavailableAttachmentIds.has(attachment.id) || attachmentModes[attachment.id] === "hidden");

  // Tell the list once this message is confirmed empty, whichever of the two
  // ways above got it there — a stale divider over nothing is the same defect
  // either way.
  const reportedMessageUnavailableRef = useRef(false);
  useEffect(() => {
    if (!settledUndecryptable && !allAttachmentsUnavailable) return;
    if (reportedMessageUnavailableRef.current) return;
    reportedMessageUnavailableRef.current = true;
    onUnavailable?.(message.id);
  }, [settledUndecryptable, allAttachmentsUnavailable, message.id, onUnavailable]);

  const relevantReceipts = message.receipts?.filter((receipt) => receipt.userId !== message.senderUserId) ?? [];
  const isRead = relevantReceipts.some((receipt) => Boolean(receipt.readAt));
  const isDelivered = relevantReceipts.some((receipt) => Boolean(receipt.deliveredAt));
  const isPendingLocal = mine && message.id.startsWith("temp-");
  // Whether to *draw* anything for that pending state.
  //
  // The bubble itself is never delayed — it is on screen the moment the user
  // taps send. What was delaying the *feeling* of having sent it was this
  // indicator: a spinner, shown from the first frame, for the whole time the
  // request was in flight. A spinner is the universal sign for "still
  // working", so a send that completed in 300ms still read as a send that had
  // not happened yet.
  //
  // A message that lands quickly now shows nothing at all in that window, and
  // goes straight from written to sent. Only a send that genuinely drags gets
  // a mark, and it is a still clock rather than a spinner: it says "waiting",
  // not "busy".
  const showPendingMark = usePendingMark(isPendingLocal);
  // A "visual only" bubble is transparent, unpadded, and puts its timestamp in
  // a floating pill *over* the picture. That is right for a photo and wrong for
  // anything that failed to become one: the pill is absolutely positioned, so
  // it survives its own container collapsing to nothing, and what is left on
  // screen is a bare `18:28 ✓✓` with no bubble under it — the orphan timestamp.
  //
  // So the mode is no longer assumed from the mime type alone. Every
  // attachment must also report that it really drew media; the moment one
  // draws a text fallback instead, the bubble takes its normal background and
  // padding back and the timestamp returns to the flow, where it always has
  // something behind it.
  const visualOnlyMessage = isVisualOnlyBubble({
    hasBody: Boolean(message.body),
    hasReply: Boolean(message.replyToMessage),
    isEncrypted: Boolean(message.isEncrypted),
    isDeleted: Boolean(message.deletedAt),
    settledUndecryptable: Boolean(settledUndecryptable),
    attachments: message.attachments,
    attachmentModes,
  });
  const isVideoNoteMessage = message.type === "VIDEO_NOTE";
  const visualOnlyStyle: React.CSSProperties = {
    backgroundColor: "transparent",
    color: mine ? "var(--bubble-outgoing-fg)" : "var(--bubble-incoming-fg)",
    border: "none",
    borderRadius: 0,
  };

  // Rendered nowhere: the list already filters these out before it ever
  // reaches this component (see ChatMessages' `visibleMessages`), so this is
  // a safety net for any path that constructs a MessageBubble directly.
  if (message.messageUnavailableOnThisDevice) {
    return null;
  }

  if (allAttachmentsUnavailable) {
    return null;
  }

  // A deleted message previously fell through to the normal bubble and rendered
  // as an empty shape with only a timestamp. Show the same centred service line
  // used by the other non-content states instead.
  if (message.deletedAt) {
    return (
      <div className="relative flex w-full justify-center px-4 py-1.5">
        <div className="max-w-[82%] rounded-full bg-surface-muted px-3 py-1.5 text-center text-[0.75rem] font-medium text-muted">
          Сообщение удалено
        </div>
      </div>
    );
  }

  if (message.isEncrypted && !message.body && message.attachments.length === 0) {
    // Once settled there is nothing left to wait for — this message will not
    // become readable on its own, so it renders nothing rather than a
    // permanent "unavailable" line. It reappears normally the moment a
    // decryptable envelope actually arrives, since that changes `message.body`
    // and this branch stops matching.
    if (settledUndecryptable) return null;
    return (
      <div className="relative flex w-full justify-center px-4 py-2">
        <div className="max-w-[82%] rounded-full bg-surface-muted/70 px-3 py-1.5 text-center text-[0.75rem] font-medium text-muted">
          Загрузка зашифрованного сообщения…
        </div>
      </div>
    );
  }

  // A message with nothing in it: no body, no attachment, not encrypted, so
  // there is nothing still to arrive. It used to render as a bubble containing
  // only its timestamp — which reads as a duplicate of the message beside it,
  // and is how a media message whose attachment never attached appears.
  if (!message.body && message.attachments.length === 0 && !message.isEncrypted && !message.deletedAt) {
    return (
      <div className="relative flex w-full justify-center px-4 py-2">
        <div className="max-w-[82%] rounded-full bg-surface-muted/70 px-3 py-1.5 text-center text-[0.75rem] font-medium text-muted">
          Вложение не загрузилось
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={rowRef}
      role={selectionMode ? "button" : undefined}
      tabIndex={selectionMode ? 0 : undefined}
      aria-pressed={selectionMode ? isSelected : undefined}
      aria-label={selectionMode ? `${isSelected ? "Снять выбор" : "Выбрать"} сообщение` : undefined}
      className={`relative ${isGroupEnd ? "mb-2" : "mb-[3px]"} flex w-full items-center transition-colors duration-200 ${selectionMode ? "cursor-pointer" : ""} ${isSelected ? "bg-primary/5" : ""} touch-pan-y no-select`}
      onClick={handleClick}
      onKeyDown={(event) => {
        if (selectionMode && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          handleClick();
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <div className={`flex w-full items-center gap-3 px-2 ${isSelected ? "opacity-100" : selectionMode ? "opacity-60" : ""}`}>
        {selectionMode && (
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-smooth ${isSelected ? "scale-110 border-primary bg-primary" : "border-muted/30"}`}>
            {isSelected && (
              <svg className="h-4 w-4 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
        )}

        {/* min-w-0 stops this column from being sized by its widest child. Without
            it, a long unbroken word blew the column past the viewport on narrow
            screens (320px), and the bubble's max-w-[78%] was then computed from
            that inflated width — producing horizontal page scroll. */}
        <div className={`flex min-w-0 flex-1 flex-col ${mine ? "items-end" : "items-start"}`}>
          {showDisplayName && !mine && (
            <span className="mb-1 ml-3 text-xs font-semibold" style={{ color: "var(--bubble-incoming-muted)" }}>
              {message.sender.profile?.displayName ?? message.sender.username}
            </span>
          )}

          {/* max-w is a percentage of the parent. In the conversation the parent
              is the full-width message row, so 78% is the intended bubble width.
              In the long-press overlay the parent is a clone box already sized
              to the measured bubble, and taking 78% of *that* squeezed the text
              into a two-or-three-character column. When focused the clone box
              is the constraint, so the bubble takes all of it. */}
          <div
            className={
              isVideoNoteMessage
                ? "relative max-w-[calc(100vw-1rem)] sm:max-w-[28rem]"
                : isFocused
                  ? "relative w-full max-w-full"
                  : "relative max-w-[78%] sm:max-w-[70%]"
            }
          >
            {canSwipeReply ? (
              <div 
                ref={replyIconRef}
                className="absolute right-full mr-3 flex h-9 w-9 items-center justify-center rounded-full bg-surface-elevated text-primary shadow-sm transition-opacity duration-150"
                style={{ opacity: 0, top: '50%', transform: 'translateY(-50%)' }}
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
              </div>
            ) : null}

            <div
              ref={bubbleRef}
              className={`group relative cursor-default active:scale-[0.96] no-select ${visualOnlyMessage ? "px-0 py-0" : "px-3 py-1.5"} ${
                isFocused ? "focused-message" : ""
              } ${!visualOnlyMessage && !mine ? incomingClass : ""}`}
              style={{
                ...(visualOnlyMessage ? visualOnlyStyle : bubbleStyle),
                willChange: "transform",
              }}
              onContextMenu={(e) => { 
                e.preventDefault(); 
              }}
            >
          {message.replyToMessage && (
            <button
              type="button"
              // block + w-full + min-w-0 so the quoted lines actually have a
              // bound to truncate against; without it the preview grew to the
              // full quoted text and stretched the bubble past its max width.
              className={`mb-1.5 block w-full min-w-0 max-w-full border-l-2 py-0.5 pl-2.5 text-left text-xs leading-tight opacity-90 ${message.replyToMessage.deletedAt ? "" : "cursor-pointer active:opacity-80"}`}
              disabled={Boolean(message.replyToMessage.deletedAt)}
              aria-label="Перейти к сообщению, на которое ответили"
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
              <p className="truncate font-semibold">{message.replyToMessage.sender.profile?.displayName || message.replyToMessage.sender.username}</p>
              <p className="truncate line-clamp-1 italic opacity-70">
                {quoteLabel(message.replyToMessage)}
              </p>
            </button>
          )}

          <>
            {message.body && (
              <p className="mb-1 whitespace-pre-wrap break-words text-[0.9375rem] font-normal leading-[1.3] last:mb-0">
                {searchQuery ? (
                  message.body.split(new RegExp(`(${escapeRegExp(searchQuery)})`, "gi")).map((part, i) =>
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
                onUnavailable={() => handleAttachmentUnavailable(att.id)}
                onRenderMode={(mode) => handleAttachmentRenderMode(att.id, mode)}
              />
            ))}
          </>

          {/* The timestamp sits at the trailing edge on both sides. Incoming
              bubbles used to left-align it, which left a wide dead area to the
              right of every short message and made the two sides of the same
              conversation read as two different components. */}
          <div className={`${visualOnlyMessage ? "absolute bottom-2 right-2 rounded-full bg-black/45 px-2 py-0.5 text-white" : "mt-0.5"} flex items-center gap-1.5 justify-end`}>
            <span
              className="text-[0.6875rem] font-medium tabular-nums"
              style={{ color: visualOnlyMessage ? "white" : mine ? "var(--bubble-outgoing-muted)" : "var(--bubble-incoming-muted)" }}
            >
              {message.editedAt && "изм. "}
              <time dateTime={new Date(message.createdAt).toISOString()}>{time}</time>
            </span>
            {mine && !message.deletedAt && (
              <div className="flex items-center ml-0.5">
                {/* Tick colours come from the chat-appearance tokens, which are
                    matched to whatever outgoing bubble colour the user picked.
                    They used to be hardcoded white, which vanished on light
                    custom bubbles. */}
                {isFailed ? (
                  <svg className="h-3 w-3" style={{ color: "var(--destructive)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Не отправлено" role="img">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : isPendingLocal ? (
                  showPendingMark ? (
                    <svg
                      className="h-2.5 w-2.5 animate-in fade-in duration-200"
                      style={{ color: "var(--message-tick)" }}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      aria-label="Отправляется"
                      role="img"
                    >
                      <circle cx="12" cy="12" r="9" strokeWidth={2.4} />
                      <path strokeLinecap="round" strokeWidth={2.4} d="M12 7.5V12l3 1.8" />
                    </svg>
                  ) : (
                    // Nothing yet — and the space is held so the ticks do not
                    // shift the timestamp sideways when they arrive.
                    <span className="h-2.5 w-2.5" aria-hidden="true" />
                  )
                ) : isRead ? (
                  <div className="flex -space-x-1" aria-label="Прочитано" role="img">
                    <svg className="h-2.5 w-2.5 animate-in fade-in" style={{ color: "var(--message-read)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    <svg className="h-2.5 w-2.5 animate-in fade-in" style={{ color: "var(--message-read)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : isDelivered ? (
                  <div className="flex -space-x-1" aria-label="Доставлено" role="img">
                    <svg className="h-2.5 w-2.5" style={{ color: "var(--message-tick)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                    <svg className="h-2.5 w-2.5" style={{ color: "var(--message-tick)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                ) : (
                  <svg className="h-2.5 w-2.5" style={{ color: "var(--message-tick)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-label="Отправлено" role="img">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </div>
            )}
          </div>
          </div>
        </div>

        {isFailed && (
          <div className="mt-1 flex items-center justify-end gap-2 pr-1">
            <span className="text-[0.6875rem] font-semibold text-destructive">Не отправлено</span>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onRetry?.(message.id); }}
              aria-label="Повторить отправку сообщения"
              className="touch-target -my-2 flex min-h-11 items-center rounded-full px-2 text-[0.6875rem] font-semibold text-primary transition-smooth active:scale-[0.96]"
            >
              Повторить
            </button>
          </div>
        )}

        {Object.keys(groupedReactions).length > 0 && !selectionMode && (
          <div className={`mt-1 flex flex-wrap gap-1 ${mine ? "mr-1" : "ml-1"} animate-in fade-in zoom-in-95 duration-200`}>
            {Object.entries(groupedReactions).map(([emoji, info]) => (
              <button
                key={emoji}
                onClick={(e) => { e.stopPropagation(); onReaction(message.id, emoji); }}
                className="flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-muted px-2.5 py-1 text-xs font-semibold text-foreground/70 transition-smooth hover:bg-surface-hover active:scale-[0.96]"
              >
                <span>{emoji}</span>
                <span className="text-[0.625rem]">{info.count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
  );
});
