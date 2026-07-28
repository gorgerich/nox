"use client";

/**
 * One hydration-safe way to render a timestamp.
 *
 * The bug this exists to prevent: the server formats a timestamp in the
 * server's timezone (UTC on Railway) and the browser formats the same
 * timestamp in the viewer's, so the server HTML and the first client render
 * disagree. React reports a hydration mismatch and throws away that subtree —
 * production was doing exactly this on every message time.
 *
 * The rule that fixes it: **the first client render must produce the same text
 * the server produced.** So both render the timestamp in a fixed reference zone,
 * and the viewer's local time is applied in the re-render immediately after
 * hydration. `useClientValue` is the single mechanism for that — the same one
 * the connection banner and the header's call buttons use.
 *
 * `suppressHydrationWarning` is deliberately not used. It hides the report
 * without making the markups agree, which leaves the next mismatch invisible.
 */
import { useClientValue } from "./use-client-value";

/** The zone both sides agree on before hydration. UTC is stable everywhere. */
export const REFERENCE_TIME_ZONE = "UTC";
const LOCALE = "ru-RU";

export type TimeKind =
  /** HH:MM — message bubbles, call rows. */
  | "time"
  /** Today → HH:MM, this week → weekday, older → day + month. Chat list rows. */
  | "chatListStamp"
  /** Сегодня / Вчера / a date. Date separators in a conversation. */
  | "daySeparator"
  /** A plain date. */
  | "date"
  /** A date and a time together. */
  | "dateTime";

function zoned(options: Intl.DateTimeFormatOptions, timeZone: string | undefined) {
  return new Intl.DateTimeFormat(LOCALE, timeZone ? { ...options, timeZone } : options);
}

/**
 * Formats a timestamp in an explicit zone. Passing `undefined` means "the
 * viewer's own zone" and is only correct after hydration.
 */
export function formatTimestamp(value: string | number | Date, kind: TimeKind, timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  switch (kind) {
    case "time":
      return zoned({ hour: "2-digit", minute: "2-digit" }, timeZone).format(date);

    case "chatListStamp": {
      // The comparison has to happen in the same zone as the output, or a
      // message sent late in the evening is "yesterday" by one clock and
      // "today" by the other.
      const now = new Date();
      const dayKey = (input: Date) => zoned({ year: "numeric", month: "2-digit", day: "2-digit" }, timeZone).format(input);
      const week = 1000 * 60 * 60 * 24 * 7;
      if (dayKey(date) === dayKey(now)) {
        return zoned({ hour: "2-digit", minute: "2-digit" }, timeZone).format(date);
      }
      if (now.getTime() - date.getTime() < week && now.getTime() >= date.getTime()) {
        return zoned({ weekday: "short" }, timeZone).format(date);
      }
      return zoned({ day: "numeric", month: "short" }, timeZone).format(date);
    }

    case "daySeparator": {
      const now = new Date();
      const dayKey = (input: Date) => zoned({ year: "numeric", month: "2-digit", day: "2-digit" }, timeZone).format(input);
      if (dayKey(date) === dayKey(now)) return "Сегодня";
      const yesterday = new Date(now.getTime() - 1000 * 60 * 60 * 24);
      if (dayKey(date) === dayKey(yesterday)) return "Вчера";
      const sameYear =
        zoned({ year: "numeric" }, timeZone).format(date) === zoned({ year: "numeric" }, timeZone).format(now);
      return zoned({ day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) }, timeZone).format(date);
    }

    case "date":
      return zoned({ day: "2-digit", month: "2-digit", year: "numeric" }, timeZone).format(date);

    case "dateTime":
      return zoned(
        { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
        timeZone,
      ).format(date);
  }
}

/**
 * The viewer's own rendering of a timestamp, safe to call during render.
 *
 * Before hydration it returns the reference-zone text — identical to what the
 * server produced. Afterwards it returns the viewer's local text. Reading
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` directly in render would
 * reintroduce the mismatch, which is why it is only ever reached through here.
 */
export function useFormattedTimestamp(value: string | number | Date | null | undefined, kind: TimeKind): string {
  const iso = value instanceof Date ? value.toISOString() : value ?? "";
  return useClientValue(
    () => (iso ? formatTimestamp(iso, kind) : ""),
    iso ? formatTimestamp(iso, kind, REFERENCE_TIME_ZONE) : "",
  );
}

/**
 * A timestamp element.
 *
 * Renders a `<time>` with a machine-readable `dateTime`, so assistive
 * technology and anything parsing the page gets the canonical instant rather
 * than a localised string. Digits are tabular so the text does not change width
 * when it switches from the reference zone to the viewer's.
 */
export function LocalTime({
  value,
  kind = "time",
  className,
  title,
}: {
  value: string | number | Date | null | undefined;
  kind?: TimeKind;
  className?: string;
  title?: string;
}) {
  const text = useFormattedTimestamp(value, kind);
  if (!value || !text) return null;

  const iso = value instanceof Date ? value.toISOString() : new Date(value).toISOString();
  return (
    <time dateTime={iso} className={className} title={title} style={{ fontVariantNumeric: "tabular-nums" }}>
      {text}
    </time>
  );
}
