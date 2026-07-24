"use client";

import { KeyRound } from "lucide-react";
import Link from "next/link";

/**
 * Shown above the history when messages exist on the server but were sealed to
 * a device key this install no longer has (typically after a reinstall).
 *
 * Deliberately avoids implementation vocabulary, and — until an encrypted
 * backup feature exists — does not offer a "restore" action or suggest that
 * support can recover anything, because neither is true.
 */
export function HistoryUnavailableNotice({
  scope,
  onDismiss,
  hasOtherDevices = false,
}: {
  /** "all" when nothing of the past conversation can be read here. */
  scope: "all" | "partial";
  onDismiss?: () => void;
  /** Only offer the devices link when there really is another active install. */
  hasOtherDevices?: boolean;
}) {
  return (
    <section
      role="note"
      aria-labelledby="history-unavailable-title"
      className="mx-auto my-4 w-full max-w-md rounded-2xl border border-border-subtle bg-surface-elevated px-4 py-4 text-center"
    >
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-accent-muted text-primary">
        <KeyRound className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
      </span>

      <h2 id="history-unavailable-title" className="text-[16px] font-semibold text-foreground">
        История недоступна на этом устройстве
      </h2>

      <p className="mt-1.5 text-[14px] leading-5 text-muted">
        {scope === "all"
          ? "Эти сообщения были зашифрованы для предыдущей установки приложения. Ключ от неё больше недоступен, поэтому расшифровать старую историю на этом устройстве невозможно."
          : "Часть сообщений была зашифрована для предыдущей установки приложения. Ключ от неё больше недоступен, поэтому эти сообщения не открываются здесь."}
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {onDismiss ? (
          <button
            type="button"
            onClick={onDismiss}
            className="fast-tap flex min-h-11 w-full items-center justify-center rounded-full bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-smooth active:scale-[0.97]"
          >
            Продолжить с новой историей
          </button>
        ) : null}

        {hasOtherDevices ? (
          <Link
            href="/profile"
            className="fast-tap flex min-h-11 w-full items-center justify-center rounded-full border border-border-subtle px-4 text-[15px] font-semibold text-foreground transition-smooth active:scale-[0.97]"
          >
            Мои устройства
          </Link>
        ) : null}
      </div>
    </section>
  );
}
