import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { emitEvent } from "@/lib/observability";

/**
 * Where the client reports what only the client can see.
 *
 * A decryption that never completes, an image whose bytes the decoder rejects,
 * a send that stays pending — none of these reach the server as an error,
 * because on the server nothing failed. Every one of them was found this month
 * by a user sending a screenshot. This is the channel that replaces the
 * screenshot.
 *
 * Accepts a small, closed set of event names. An open endpoint that logs
 * whatever it is handed is a way to fill the log with someone else's text.
 */
const ALLOWED = new Set([
  "client.decrypt.failed",
  "client.decrypt.timeout",
  "client.media.broken",
  "client.media.decrypt.failed",
  "client.send.stuck",
  "client.recovery.restore.failed",
  "client.unhandled.error",
]);

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  // A client loop must not be able to flood the log.
  const limit = checkRateLimit(request, `telemetry:${user.id}`, { limit: 60, windowMs: 60_000 });
  if (!limit.allowed) return NextResponse.json({ ok: true, dropped: true });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  const payload = body as { event?: unknown; chatId?: unknown; detail?: unknown };
  if (typeof payload.event !== "string" || !ALLOWED.has(payload.event)) {
    return NextResponse.json({ error: "Неизвестное событие." }, { status: 400 });
  }

  emitEvent(
    payload.event,
    {
      userId: user.id,
      chatId: typeof payload.chatId === "string" ? payload.chatId : undefined,
      // Free text is the one field a client controls, so it is bounded here
      // and sanitised again by the emitter.
      detail: typeof payload.detail === "string" ? payload.detail.slice(0, 200) : undefined,
      source: "client",
    },
    "warn",
  );

  return NextResponse.json({ ok: true });
}
