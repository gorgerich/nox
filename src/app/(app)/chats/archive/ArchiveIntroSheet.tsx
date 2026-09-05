"use client";

import { useEffect, useState } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { createPortal } from "react-dom";
import { Archive, EyeOff, Undo2 } from "lucide-react";

// First-visit explainer for the Archive, shown once per device. Dismissal is
// remembered in localStorage; if storage is unavailable we simply never show
// the sheet again for that session rather than nagging on every visit.
const SEEN_KEY = "nox:archive-intro-seen";

const POINTS = [
  {
    icon: Archive,
    title: "Архив чатов",
    copy: "Проведите по чату влево или вправо, чтобы убрать его в архив.",
  },
  {
    icon: Undo2,
    title: "Вернуть обратно",
    copy: "Свайп по архивному чату возвращает его в основной список.",
  },
  {
    icon: EyeOff,
    title: "Не мешает",
    copy: "Архивные чаты не показываются на главном экране, но уведомления приходят.",
  },
];

export function ArchiveIntroSheet() {
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useFocusTrap<HTMLDivElement>(isOpen);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = true; // storage blocked — don't nag on every visit
    }
    if (!seen) {
      const id = window.setTimeout(() => setIsOpen(true), 0);
      return () => window.clearTimeout(id);
    }
  }, []);

  const dismiss = () => {
    setIsOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // ignore unavailable storage
    }
  };

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <div
      // The blur matches the message overlay, which is the app's other scrim.
      // A flat wash reads as a grey page rather than as something behind glass.
      ref={dialogRef}
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/32 backdrop-blur-sm animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-intro-title"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md rounded-t-[1.5rem] bg-surface px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-4 shadow-[0_-3px_16px_rgba(15,23,42,0.10)] animate-in slide-in-from-bottom duration-200 ease-out"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Every other bottom sheet in the app has a grabber. Without one this
            reads as a page that appeared rather than a sheet that can be
            dismissed. */}
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-9 rounded-full bg-border" />
        <div className="flex flex-col items-center text-center">
          <Archive className="h-8 w-8 text-primary" strokeWidth={1.9} aria-hidden="true" />
          <h2 id="archive-intro-title" className="mt-3 text-[1.25rem] font-semibold text-foreground">
            Это ваш архив
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-6 text-muted">
            Здесь лежат чаты, которые вы скрыли из основного списка.
          </p>
        </div>

        <ul className="mt-5 space-y-4">
          {POINTS.map((point) => {
            const Icon = point.icon;

  return (
              <li key={point.title} className="flex gap-3">
                <Icon className="mt-0.5 h-[1.4rem] w-[1.4rem] shrink-0 text-primary" strokeWidth={2} />
                <div className="min-w-0">
                  <p className="text-[0.9375rem] font-semibold text-foreground">{point.title}</p>
                  <p className="mt-0.5 text-[0.875rem] leading-5 text-muted">{point.copy}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={dismiss}
          className="fast-tap mt-6 flex h-12 w-full items-center justify-center rounded-[0.875rem] bg-primary py-3 text-[1rem] font-semibold text-primary-foreground transition-colors"
        >
          Понятно
        </button>
      </div>
    </div>,
    document.body,
  );
}
