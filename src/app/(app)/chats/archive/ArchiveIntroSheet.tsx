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
    if (!seen) setIsOpen(true);
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
      className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/32 backdrop-blur-md animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-intro-title"
      onClick={dismiss}
    >
      <div
        className="w-full max-w-md rounded-t-[2rem] bg-surface px-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-8 shadow-[0_-8px_40px_rgba(15,23,42,0.18)] animate-in slide-in-from-bottom duration-300 ease-out"
        onClick={(event) => event.stopPropagation()}
      >
        {/* Every other bottom sheet in the app has a grabber. Without one this
            reads as a page that appeared rather than a sheet that can be
            dismissed. */}
        <div aria-hidden="true" className="mx-auto mb-5 h-1.5 w-12 rounded-full bg-border" />
        <div className="flex flex-col items-center text-center">
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-b from-sky-400 to-primary text-white shadow-lg">
            <Archive className="h-9 w-9" strokeWidth={2.1} />
          </span>
          <h2 id="archive-intro-title" className="mt-5 text-[22px] font-bold tracking-tight text-foreground">
            Это ваш архив
          </h2>
          <p className="mt-2 text-[15px] leading-6 text-muted">
            Здесь лежат чаты, которые вы скрыли из основного списка.
          </p>
        </div>

        <ul className="mt-7 space-y-5">
          {POINTS.map((point) => {
            const Icon = point.icon;

  return (
              <li key={point.title} className="flex gap-4">
                <Icon className="mt-0.5 h-[1.4rem] w-[1.4rem] shrink-0 text-primary" strokeWidth={2} />
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-foreground">{point.title}</p>
                  <p className="mt-0.5 text-[14px] leading-5 text-muted">{point.copy}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          onClick={dismiss}
          className="fast-tap mt-8 flex h-13 w-full items-center justify-center rounded-full bg-primary py-3.5 text-[16px] font-semibold text-primary-foreground transition-smooth active:scale-[0.97]"
        >
          Понятно
        </button>
      </div>
    </div>,
    document.body,
  );
}
