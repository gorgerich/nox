"use client";

import { Download, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { decryptMediaBlob } from "@/lib/e2ee/media";
import { getLocalDeviceId, registerCurrentDevice } from "@/lib/e2ee/keys";
import { getMediaUrl, putMediaUrl, removeMediaUrl } from "@/lib/media-cache";

interface SharedAttachment {
  id: string;
  url: string;
  createdAt: string;
  mimeType?: string;
  senderUserId?: string;
  fileIv?: string | null;
  isEncrypted?: boolean;
  mediaKeyEnvelopes?: {
    recipientUserId: string;
    recipientDeviceId: string;
    senderDeviceId: string;
    encryptedMediaKey: string;
    iv: string;
    salt: string | null;
    algorithm: string;
    encryptionVersion: number;
  }[];
}

export interface SharedMediaPhoto extends SharedAttachment {
  type: "IMAGE" | "VIDEO";
}

export interface SharedMediaFile extends SharedAttachment {
  fileName: string;
  size?: number;
}

const MEDIA_TIMEOUT_MS = 12_000;

async function fetchSharedAttachment(item: SharedAttachment, chatId: string, currentUserId: string, signal: AbortSignal): Promise<Blob> {
  const device = item.isEncrypted
    ? await registerCurrentDevice(currentUserId).catch(async () => ({ deviceId: await getLocalDeviceId(currentUserId) }))
    : null;
  const envelope = item.mediaKeyEnvelopes?.find((entry) => entry.recipientDeviceId === device?.deviceId);
  if (item.isEncrypted && (!envelope || !item.fileIv || !item.senderUserId)) throw new Error("NO_MEDIA_ENVELOPE");

  const response = await fetch(item.url, { signal });
  if (!response.ok) throw new Error("DOWNLOAD_FAILED");
  const blob = await response.blob();
  if (!blob.size) throw new Error("EMPTY_FILE");
  if (!item.isEncrypted) return blob;

  const decrypted = await decryptMediaBlob({
    encryptedBlob: blob,
    fileIv: item.fileIv!,
    senderUserId: item.senderUserId!,
    senderDeviceId: envelope!.senderDeviceId,
    chatId,
    envelope: envelope!,
    mimeType: item.mimeType || "application/octet-stream",
  });
  if (!decrypted?.size) throw new Error("DECRYPT_FAILED");
  return decrypted;
}

export function SharedMediaTile({
  item,
  chatId,
  currentUserId,
}: {
  item: SharedMediaPhoto;
  chatId: string;
  currentUserId: string;
}) {
  const cachedUrl = item.isEncrypted ? getMediaUrl(item.id) : null;
  const [src, setSrc] = useState<string | null>(() => cachedUrl ?? (item.isEncrypted ? null : item.url));
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!item.isEncrypted) {
      return;
    }

    const cached = getMediaUrl(item.id);
    if (cached) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
    let cancelled = false;

    async function loadEncryptedMedia() {
      try {
        const decrypted = await fetchSharedAttachment({
          ...item,
          mimeType: item.mimeType || (item.type === "VIDEO" ? "video/mp4" : "image/jpeg"),
        }, chatId, currentUserId, controller.signal);

        const freshUrl = URL.createObjectURL(decrypted);
        const ownedUrl = putMediaUrl(item.id, freshUrl);
        if (ownedUrl !== freshUrl) URL.revokeObjectURL(freshUrl);
        if (!cancelled) setSrc(ownedUrl);
      } catch {
        if (!cancelled) setPhase("error");
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void loadEncryptedMedia();
    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [attempt, chatId, currentUserId, item]);

  useEffect(() => {
    if (phase !== "loading" || !src) return;
    const timeoutId = window.setTimeout(() => setPhase("error"), MEDIA_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [attempt, phase, src]);

  const markBroken = useCallback(() => {
    if (item.isEncrypted) removeMediaUrl(item.id);
    setSrc(null);
    setPhase("error");
  }, [item.id, item.isEncrypted]);

  const retry = useCallback(() => {
    if (item.isEncrypted) removeMediaUrl(item.id);
    setSrc(item.isEncrypted ? null : item.url);
    setPhase("loading");
    setAttempt((value) => value + 1);
  }, [item.id, item.isEncrypted, item.url]);

  return (
    <div className="relative aspect-square overflow-hidden rounded-md bg-surface-muted">
      {src && item.type === "VIDEO" ? (
        <video
          key={attempt}
          src={src}
          className="h-full w-full object-cover"
          preload="metadata"
          muted
          playsInline
          onLoadedMetadata={() => setPhase("ready")}
          onError={markBroken}
        />
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={attempt}
          src={src}
          className="h-full w-full object-cover"
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setPhase("ready")}
          onError={markBroken}
        />
      ) : null}

      {phase === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-surface-muted text-muted" aria-label="Загрузка медиа">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
        </div>
      ) : null}

      {phase === "error" ? (
        <button
          type="button"
          onClick={retry}
          className="fast-tap absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-surface-muted px-2 text-center text-[0.625rem] font-semibold text-muted"
          aria-label="Повторить загрузку медиа"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
          Повторить
        </button>
      ) : null}
    </div>
  );
}

export function SharedFileRow({ item, chatId, currentUserId }: {
  item: SharedMediaFile;
  chatId: string;
  currentUserId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const download = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    setError(false);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);
    try {
      const blob = await fetchSharedAttachment(item, chatId, currentUserId, controller.signal);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = item.fileName || "nox-file";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch {
      setError(true);
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }, [chatId, currentUserId, item, loading]);

  return (
    <button type="button" onClick={() => void download()} disabled={loading}
      aria-label={`${error ? "Повторить загрузку" : "Скачать"} ${item.fileName}`}
      className="fast-tap flex min-h-14 w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-foreground/5 disabled:opacity-60">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center text-primary" aria-hidden="true">
        {loading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <Download className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.fileName}</span>
        <span className={`block text-xs ${error ? "text-danger" : "text-muted"}`}>
          {error ? "Не удалось открыть. Повторить" : new Date(item.createdAt).toLocaleDateString()}
        </span>
      </span>
    </button>
  );
}
