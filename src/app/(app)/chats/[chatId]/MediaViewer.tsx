"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    if (item) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [item, onClose]);

  if (!item || typeof document === "undefined") return null;

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const response = await fetch(item.url);
      const blob = await response.blob();
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
          console.error("Share failed:", shareError);
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
      URL.revokeObjectURL(objectUrl);
    } catch (error) {
      console.error("Download failed:", error);
      // Fallback to direct link if fetch fails
      const link = document.createElement("a");
      link.href = `${item.url}?download=1`;
      link.download = item.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex flex-col bg-black/95 transition-opacity animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`Просмотр файла ${item.fileName}`}
      onClick={onClose}
    >
      {/* Header */}
      <header
        className="safe-top flex items-center justify-between px-4 py-4 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Закрыть просмотр"
          onClick={onClose}
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
          className="touch-target flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/25 backdrop-blur-xl transition-transform active:scale-[0.96]"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
        </button>
      </header>

      {/* Content */}
      <main className="flex flex-1 items-center justify-center overflow-hidden p-2">
        {item.type === "IMAGE" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={item.fileName}
            className="max-h-full max-w-full object-contain animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <video 
            src={item.url} 
            controls 
            autoPlay
            className="max-h-full max-w-full animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </main>

      <div className="safe-bottom h-4 shrink-0" aria-hidden="true" />
    </div>,
    document.body
  );
}
