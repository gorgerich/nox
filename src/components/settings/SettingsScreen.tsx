"use client";

import type { ReactNode, RefObject } from "react";

/**
 * The frame every settings sub-screen sits in.
 *
 * Before this existed the same header was copy-pasted into six screens, which
 * is why the title, the back button and the top padding all drifted apart by a
 * few pixels each. One frame means the header cannot jump between screens, and
 * the safe area and dock clearance are handled once instead of per screen.
 *
 * The focus trap stays with the caller: it is driven by which screen is open,
 * and that state does not live here.
 */
export function SettingsScreen({
  title,
  titleId,
  onBack,
  containerRef,
  action,
  children,
}: {
  title: string;
  titleId: string;
  onBack: () => void;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Optional trailing control in the header — used sparingly. */
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[1100] overflow-y-auto bg-background animate-in slide-in-from-right duration-200 safe-top"
    >
      <header className="liquid-top-chrome sticky top-0 z-50 flex min-h-14 items-center gap-1 px-1">
        <button
          type="button"
          onClick={onBack}
          className="fast-tap -ml-0.5 flex h-11 items-center gap-0.5 rounded-full pl-2 pr-3 text-[1.0625rem] text-primary transition-smooth hover:bg-primary/10"
        >
          <svg className="h-[22px] w-[22px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M15 19l-7-7 7-7" />
          </svg>
          Назад
        </button>
        {/* Centred independently of the back button, so a long Russian title
            never pushes it off-centre or wraps the header to two lines. */}
        <h1
          id={titleId}
          className="pointer-events-none absolute inset-x-0 mx-auto max-w-[55%] truncate text-center text-[1.0625rem] font-semibold tracking-tight text-foreground"
        >
          {title}
        </h1>
        <div className="ml-auto flex items-center">{action}</div>
      </header>

      <div className="pb-[calc(var(--bottom-dock-clearance)+1rem)] pt-2 animate-in fade-in duration-200">
        {children}
      </div>
    </div>
  );
}
