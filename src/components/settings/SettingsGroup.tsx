"use client";

import { Children, type ReactNode } from "react";

/**
 * One grouped block of settings rows.
 *
 * The visual rules the whole settings area obeys live here and nowhere else:
 * a quiet section label above, one surface behind the rows, hairline
 * separators between them, and an optional footnote below. Screens describe
 * what they contain; they do not decide what a group looks like.
 *
 * Separators are inserted between children rather than drawn by each row, so a
 * group never ends with a dangling line and rows stay ignorant of their
 * position.
 */
export function SettingsGroup({
  label,
  footer,
  children,
  className = "",
}: {
  label?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const rows = Children.toArray(children).filter(Boolean);

  return (
    <section className={`px-4 ${className}`}>
      {label ? (
        <h2 className="px-1 pb-2 text-[13px] font-medium uppercase tracking-[0.04em] text-muted">
          {label}
        </h2>
      ) : null}
      <div className="overflow-hidden rounded-2xl bg-surface">
        {rows.map((row, index) => (
          <div key={index}>
            {index > 0 ? <div className="ml-4 h-px bg-border-subtle" /> : null}
            {row}
          </div>
        ))}
      </div>
      {footer ? (
        <p className="px-1 pt-2 text-[13px] leading-snug text-muted">{footer}</p>
      ) : null}
    </section>
  );
}

/**
 * A block that is not a list of rows — a segmented control, swatches, a chart.
 * Same label, footnote and horizontal rhythm as a group, without the surface,
 * so a screen can mix the two without the spacing drifting.
 */
export function SettingsBlock({
  label,
  footer,
  children,
  className = "",
}: {
  label?: string;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`px-4 ${className}`}>
      {label ? (
        <h2 className="px-1 pb-2 text-[13px] font-medium uppercase tracking-[0.04em] text-muted">
          {label}
        </h2>
      ) : null}
      {children}
      {footer ? (
        <p className="px-1 pt-2 text-[13px] leading-snug text-muted">{footer}</p>
      ) : null}
    </section>
  );
}

/** Vertical rhythm between groups on a settings screen. */
export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className="space-y-8">{children}</div>;
}
