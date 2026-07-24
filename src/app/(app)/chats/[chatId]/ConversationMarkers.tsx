"use client";

import { formatDateLabel } from "@/lib/message-grouping";

// Presentation-only markers shared by the real conversation and the dev
// harness. They previously existed twice — inline in ChatMessages and again as
// local copies in the preview — so the two could drift apart.
// No API or store access: everything arrives as props.

export function DateSeparator({ date }: { date: Date }) {
  return (
    <div className="my-3 flex justify-center">
      <time
        dateTime={date.toISOString()}
        className="rounded-full px-3 py-1 text-[12px] font-semibold"
        style={{ background: "var(--chat-date-bg)", color: "var(--chat-date-fg)" }}
      >
        {formatDateLabel(date)}
      </time>
    </div>
  );
}

/**
 * Thin accent rule with a label — deliberately not a heavy full-width bar.
 * The count is exposed to assistive tech rather than being implied by colour.
 */
export function UnreadSeparator({ count }: { count?: number }) {
  const label = typeof count === "number" && count > 0 ? `Непрочитанных сообщений: ${count}` : "Новые сообщения";

  return (
    <div className="my-3 flex items-center gap-3 px-1" role="separator" aria-label={label}>
      <span className="h-px flex-1" style={{ background: "var(--accent-muted)" }} aria-hidden="true" />
      <span className="text-[12px] font-semibold" style={{ color: "var(--accent)" }}>
        Новые сообщения
      </span>
      <span className="h-px flex-1" style={{ background: "var(--accent-muted)" }} aria-hidden="true" />
    </div>
  );
}

function typingLabel(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} печатает…`;
  if (names.length === 2) return `${names[0]} и ${names[1]} печатают…`;
  return `${names[0]}, ${names[1]} и ещё ${names.length - 2} печатают…`;
}

/**
 * Renders nothing when nobody is typing, so no vertical space is reserved.
 * The dots animation is dropped under prefers-reduced-motion.
 */
export function TypingIndicator({ names }: { names: string[] }) {
  if (names.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-2 py-2" role="status" aria-live="polite">
      <span className="flex gap-1" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="h-1.5 w-1.5 animate-pulse rounded-full motion-reduce:animate-none"
            style={{ background: "var(--text-tertiary)", animationDelay: `${index * 150}ms` }}
          />
        ))}
      </span>
      <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
        {typingLabel(names)}
      </span>
    </div>
  );
}
