"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Camera, FileText, Image as ImageIcon, Video, X } from "lucide-react";

export type AttachmentAction = "media" | "file" | "camera" | "videoNote";

type ActionSpec = {
  id: AttachmentAction;
  label: string;
  description: string;
  icon: typeof ImageIcon;
};

/**
 * Only actions the composer actually supports are listed here — each one maps
 * to an existing capability (a file input with a matching `accept`/`capture`,
 * or the existing round-video recorder). Nothing decorative.
 */
const ACTIONS: ActionSpec[] = [
  { id: "media", label: "Фото или видео", description: "Из галереи устройства", icon: ImageIcon },
  { id: "file", label: "Файл", description: "Документ или архив", icon: FileText },
  { id: "camera", label: "Камера", description: "Снять фото", icon: Camera },
  { id: "videoNote", label: "Видеосообщение", description: "Круглое видео", icon: Video },
];

export function AttachmentSheet({
  isOpen,
  onClose,
  onSelect,
  available,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (action: AttachmentAction) => void;
  /** Actions the host currently supports; anything omitted is hidden, not faked. */
  available?: AttachmentAction[];
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLButtonElement>("button")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      // Simple focus trap across the sheet's own controls.
      const focusables = panel.querySelectorAll<HTMLElement>("button");
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === "undefined") return null;

  const actions = available ? ACTIONS.filter((a) => available.includes(a.id)) : ACTIONS;

  return createPortal(
    <div
      className="fixed inset-0 z-[1300] flex items-end justify-center bg-overlay animate-in fade-in duration-200 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Прикрепить"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(event) => event.stopPropagation()}
        className="nox-sheet w-full max-w-md rounded-t-[1.75rem] pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] animate-in slide-in-from-bottom duration-300 sm:rounded-[1.5rem] sm:pb-3 motion-reduce:animate-none"
      >
        <div className="flex items-center justify-between px-5 pb-1 pt-3">
          <span className="mx-auto h-1 w-9 rounded-full bg-separator-strong sm:hidden" aria-hidden="true" />
        </div>

        <div className="flex items-center justify-between px-5 pb-2 pt-1">
          <h2 className="text-[17px] font-semibold text-foreground">Прикрепить</h2>
          <button
            type="button"
            aria-label="Закрыть"
            onClick={onClose}
            className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-muted transition-smooth hover:bg-surface-pressed active:scale-[0.96]"
          >
            <X className="h-5 w-5" strokeWidth={2.1} />
          </button>
        </div>

        <div className="px-2 pb-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.id}
                type="button"
                onClick={() => {
                  onSelect(action.id);
                  onClose();
                }}
                className="flex min-h-[56px] w-full items-center gap-3.5 rounded-2xl px-3 text-left transition-smooth hover:bg-surface-pressed active:scale-[0.99]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-muted text-primary">
                  <Icon className="h-5 w-5" strokeWidth={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-semibold text-foreground">{action.label}</span>
                  <span className="block truncate text-[13px] text-muted">{action.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
