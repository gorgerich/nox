// Pure grouping rules for the message list.
//
// Extracted from ChatMessages so the behaviour is testable on its own and so
// the date-boundary rule can't drift from the date separators that the list
// renders: a message that starts a new calendar day always starts a new group,
// otherwise a separator could appear *inside* a visually continuous group.

/** How long a pause between two messages breaks a group. */
export const GROUP_GAP_MS = 5 * 60 * 1000;

export type GroupPosition = "single" | "first" | "middle" | "last";

export type GroupableMessage = {
  id: string;
  senderUserId: string;
  createdAt: string;
  /** System/service entries never join a neighbouring author group. */
  type?: string;
};

function isSystem(message: GroupableMessage) {
  return message.type === "SYSTEM";
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

function gap(later: string, earlier: string) {
  return new Date(later).getTime() - new Date(earlier).getTime();
}

/** True when `message` opens a new visual group relative to `prev`. */
export function startsGroup(message: GroupableMessage, prev: GroupableMessage | undefined): boolean {
  if (!prev) return true;
  if (isSystem(message) || isSystem(prev)) return true;
  if (prev.senderUserId !== message.senderUserId) return true;
  // A date separator is rendered between these two, so they must not read as
  // one group even if they are only seconds apart across midnight.
  if (!sameDay(message.createdAt, prev.createdAt)) return true;
  return gap(message.createdAt, prev.createdAt) > GROUP_GAP_MS;
}

/** True when `message` closes its visual group relative to `next`. */
export function endsGroup(message: GroupableMessage, next: GroupableMessage | undefined): boolean {
  if (!next) return true;
  if (isSystem(message) || isSystem(next)) return true;
  if (next.senderUserId !== message.senderUserId) return true;
  if (!sameDay(next.createdAt, message.createdAt)) return true;
  return gap(next.createdAt, message.createdAt) > GROUP_GAP_MS;
}

export function groupPosition(
  message: GroupableMessage,
  prev: GroupableMessage | undefined,
  next: GroupableMessage | undefined,
): GroupPosition {
  const first = startsGroup(message, prev);
  const last = endsGroup(message, next);
  if (first && last) return "single";
  if (first) return "first";
  if (last) return "last";
  return "middle";
}

/** True when a date separator belongs above `message`. */
export function needsDateSeparator(message: GroupableMessage, prev: GroupableMessage | undefined): boolean {
  if (!prev) return true;
  return !sameDay(message.createdAt, prev.createdAt);
}

/** Russian day label used by the date separator. */
export function formatDateLabel(date: Date, now: Date = new Date()): string {
  if (date.toDateString() === now.toDateString()) return "Сегодня";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Вчера";
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(date);
}
