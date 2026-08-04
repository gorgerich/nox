"use client";

import { useEffect } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { createPortal } from "react-dom";

export function AvatarViewer({
  src,
  alt,
  fileName = "nox-avatar.jpg",
  onClose,
}: {
  src: string | null;
  alt: string;
  fileName?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!src) return;
    document.body.style.overflow = "hidden";
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
  }, [onClose, src]);

  if (!src || typeof document === "undefined") return null;

  const handleSave = async (event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const response = await fetch(src);
      const blob = await response.blob();

      if (typeof navigator !== "undefined" && navigator.canShare && window.File) {
        const file = new File([blob], fileName, { type: blob.type || "image/jpeg" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: alt });
          return;
        }
      }

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } catch {
      const link = document.createElement("a");
      link.href = src;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

  return createPortal(
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[1200] flex flex-col bg-black animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={`Фото профиля ${alt}`}
      onClick={onClose}
    >
      <header className="safe-top flex items-center justify-between px-4 py-4 text-white" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          className="touch-target flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/25 backdrop-blur-xl transition-smooth active:scale-[0.96]"
          aria-label="Закрыть"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>

        <button
          type="button"
          onClick={handleSave}
          className="touch-target flex h-11 w-11 items-center justify-center rounded-full border border-white/15 bg-black/25 backdrop-blur-xl transition-smooth active:scale-[0.96]"
          aria-label="Сохранить"
          title="Сохранить"
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M4 16v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1m-4-4-4 4m0 0-4-4m4 4V4" />
          </svg>
        </button>
      </header>

      <main className="flex flex-1 items-center justify-center overflow-hidden p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="max-h-full max-w-full object-contain animate-in zoom-in-95 duration-200"
          onClick={(event) => event.stopPropagation()}
        />
      </main>
    </div>,
    document.body,
  );
}
