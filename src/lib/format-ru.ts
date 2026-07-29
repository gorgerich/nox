/**
 * Formatting for a Russian interface.
 *
 * Two problems this fixes at once.
 *
 * `toLocaleDateString()` with no locale follows whatever the runtime happens to
 * be set to. On a Russian screen that printed `7/29/2026`. It is also a
 * hydration hazard: the server's locale and the browser's need not agree, and
 * when they disagree React throws the server tree away.
 *
 * Role enums were rendered raw — `OWNER`, `MEMBER` — which is both untranslated
 * and shouted in Latin capitals in the middle of Cyrillic text.
 */

const MONTHS = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];

/** `29 июля 2026`. Written out rather than dotted: this is prose, not a table. */
export function formatCalendarDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Владелец",
  ADMIN: "Админ",
  MEMBER: "Участник",
};

/** Falls back to the raw value: an unknown role should be visible, not blank. */
export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}
