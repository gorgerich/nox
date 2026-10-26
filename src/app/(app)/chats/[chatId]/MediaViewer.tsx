"use client";

import { useCallback, useEffect, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { createPortal } from "react-dom";

export type MediaItem = {
  id: string;
  type: "IMAGE" | "VIDEO";
  url: string;
  fileName: string;
};

export function MediaViewer({
  item,
  onClose,
}: {
  item: MediaItem | null;
  onClose: () => void;
}) {
  const [failedMediaKey, setFailedMediaKey] = useState<string | null>(null);
  const [failedDownloadKey, setFailedDownloadKey] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const mediaKey = item ? `${item.id}:${item.url}` : null;
  const mediaError = mediaKey !== null && failedMediaKey === mediaKey;
  const downloadError = mediaKey !== null && failedDownloadKey === mediaKey;
  const close = useCallback(() => {
    setFailedMediaKey(null);
    setFailedDownloadKey(null);
    onClose();
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    if (item) {
      document.body.style.overflow = "hidden";
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [item, close]);

  // Escape is already handled above; the trap owns focus and inert. It has to
  // sit above the early return so its call order never changes.
  const dialogRef = useFocusTrap<HTMLDivElement>(Boolean(item));

  if (!item || typeof document === "undefined") return null;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    setFailedDownloadKey(null);
    try {
      const response = await fetch(item.url);
      if (!response.ok) throw new Error("DOWNLOAD_FAILED");
      const blob = await response.blob();
      if (!blob.size) throw new Error("EMPTY_FILE");
      const fileName = item.fileName || "nox-file";
      
      // Prefer Web Share API with files when supported (better for mobile PWA)
      if (typeof navigator !== "undefined" && navigator.canShare && window.File) {
        try {
          const file = new File([blob], fileName, { type: blob.type });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: fileName });
            return;
          }
        } catch (shareError) {
          if (shareError instanceof DOMException && shareError.name === "AbortError") return;
        }
      }

      // Fallback browser download
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    } catch {
      setFailedDownloadKey(mediaKey);
    } finally {
      setDownloading(false);
    }
  };


  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[200] flex flex-col bg-black/95 transition-opacity animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`Просмотр файла ${item.fileName}`}
      onClick={close}
    >
      {/* Header */}
      <header
        className="safe-top flex items-center justify-between px-4 py-4 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Закрыть просмотр"
          onClick={close}
          className="touch-target flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/25 backdrop-blur-xl transition-transform active:scale-[0.96]"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        
        <div className="min-w-0 flex-1 px-4 text-center">
          <p className="truncate text-sm font-medium text-white/82">{item.fileName}</p>
        </div>

        <button
          type="button"
          aria-label="Сохранить файл"
          onClick={handleDownload}
          disabled={downloading}
          className="touch-target flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/25 backdrop-blur-xl transition-transform active:scale-[0.96] disabled:opacity-50"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </header>

      {/* Content */}
      <main className="flex flex-1 flex-col items-center justify-center overflow-hidden p-2">
        {mediaError ? (
          <div className="max-w-xs px-4 text-center text-white" role="alert">
            <p className="text-base font-semibold">Не удалось открыть медиа</p>
            <p className="mt-2 text-sm text-white/70">Вернитесь в чат и повторите загрузку.</p>
          </div>
        ) : item.type === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={item.fileName}
            className="max-h-full max-w-full object-contain"
            onError={() => setFailedMediaKey(mediaKey)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <video 
            src={item.url} 
            controls 
            autoPlay
            className="max-h-full max-w-full"
            onError={() => setFailedMediaKey(mediaKey)}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {downloadError ? <p className="mt-4 text-sm text-white" role="alert">Не удалось сохранить файл. Повторите попытку.</p> : null}
      </main>

      <div className="safe-bottom h-4 shrink-0" aria-hidden="true" />
    </div>,
    document.body
  );
}
