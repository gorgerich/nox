/**
 * Structured events, so a failure is something the system says rather than
 * something a user reports.
 *
 * Every defect fixed this month was found by hand: writing a script, querying
 * production, counting rows. That works once and does not scale past the
 * person willing to do it. What follows is the smallest thing that changes
 * that — one line per event, valid JSON, a stable prefix to grep for.
 *
 * Deliberately no vendor and no new table. The logs already ship to Railway,
 * `railway logs | grep nox-event` already works, and a sink that needs neither
 * a migration nor an account can land today. When there is a reason to keep
 * events longer than the log retention, the emitter is the only thing that
 * changes.
 *
 * Rules the payload has to obey, because these events are read by whoever is
 * on call and stored wherever logs go:
 *
 *   - never a message body, a ciphertext, a client id or a passphrase;
 *   - user and chat ids only as identifiers, never names;
 *   - a stable `event` name, so counting is possible without parsing prose.
 */

export type EventLevel = "info" | "warn" | "error";

/** Values safe to appear in a log line. Anything else must be summarised first. */
type Scalar = string | number | boolean | null | undefined;

const PREFIX = "nox-event";

/**
 * Keys that must never carry content, whatever the caller intended. Cheap
 * insurance: an event added in a hurry six months from now cannot leak a
 * message body through a field named `body`.
 */
const FORBIDDEN = new Set([
  "body",
  "text",
  "message",
  "content",
  "ciphertext",
  "plaintext",
  "passphrase",
  "password",
  "token",
  "clientMessageId",
]);

function sanitise(fields: Record<string, Scalar>): Record<string, Scalar> {
  const safe: Record<string, Scalar> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (FORBIDDEN.has(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    // Long strings are the shape content takes when it slips through under an
    // innocent name. Truncated rather than dropped, so a stack trace survives.
    safe[key] = typeof value === "string" && value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  return safe;
}

export function emitEvent(
  event: string,
  fields: Record<string, Scalar> = {},
  level: EventLevel = "info",
): void {
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    event,
    ...sanitise(fields),
  });
  // stderr for problems so they survive log levels that drop stdout.
  const write = level === "error" || level === "warn" ? console.error : console.log;
  write(`${PREFIX} ${line}`);
}

/**
 * Times an operation and emits its outcome either way.
 *
 * The duration matters as much as the failure: "sends are succeeding" and
 * "sends are succeeding in four seconds" are different states, and only the
 * second explains a user saying the app feels stuck.
 */
export async function observe<T>(
  event: string,
  fields: Record<string, Scalar>,
  run: () => Promise<T>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await run();
    emitEvent(event, { ...fields, ok: true, ms: Date.now() - started });
    return result;
  } catch (error) {
    emitEvent(
      event,
      {
        ...fields,
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.name : "unknown",
        detail: error instanceof Error ? error.message : String(error),
      },
      "error",
    );
    throw error;
  }
}
