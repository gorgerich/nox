"use client";

import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useClientValue } from "@/lib/use-client-value";

export type ConnectionStatus = "online" | "offline" | "reconnecting" | "restored" | "error";

const COPY: Record<Exclude<ConnectionStatus, "online">, { label: string; tone: "warning" | "destructive" | "success" }> = {
  offline: { label: "Нет подключения к сети", tone: "warning" },
  reconnecting: { label: "Восстанавливаем соединение…", tone: "warning" },
  restored: { label: "Соединение восстановлено", tone: "success" },
  error: { label: "Не удалось подключиться к серверу", tone: "destructive" },
};

/**
 * Compact connection banner shown between the chat header and the history.
 * It is a strip rather than an overlay so it never covers messages or the
 * composer, and it keeps a fixed height while visible so showing/hiding it
 * doesn't shift the scroll position of the list.
 *
 * The state is conveyed by an icon and text as well as colour.
 */
/**
 * Connection state is client-only: the socket may already be connected by the
 * time React hydrates, while the server render always sees "not connected".
 * Rendering the banner from that state made the two markups disagree, so the
 * banner is absent on both sides until hydration finishes.
 */
export function InlineConnectionNotice({ status }: { status: ConnectionStatus }) {
  const hydrated = useClientValue(() => true, false);
  const [visible, setVisible] = useState(status !== "online");
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);

    if (status === "online") {
      setVisible(false);
      return;
    }

    setVisible(true);

    // "Restored" is an acknowledgement, not a persistent state — retire it
    // quickly instead of leaving a banner the user has to dismiss.
    if (status === "restored") {
      hideTimer.current = setTimeout(() => setVisible(false), 2000);
    }

    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [status]);

  // Before hydration the banner is simply absent, on both sides.
  if (!hydrated || !visible || status === "online") return null;

  const { label, tone } = COPY[status];
  const Icon = status === "restored" ? Wifi : status === "reconnecting" ? RefreshCw : CloudOff;
  const color =
    tone === "destructive" ? "var(--destructive)" : tone === "success" ? "var(--success)" : "var(--warning)";

  return (
    /*
     * A zero-height slot with the banner floating out of it, rather than a
     * block in the flex column.
     *
     * In the flow, appearing and disappearing moved the whole conversation by
     * the banner's height — measured as two layout shifts of 0.032 on a single
     * open, one when it showed and one when it went. Connection state changing
     * is not a reason for the message you are reading to move, and no native
     * client moves it. The banner overlays instead, which is also how the same
     * status reads on iOS.
     */
    <div className="relative z-20 h-0 overflow-visible">
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-0 top-0 mx-auto flex w-fit max-w-[90%] items-center justify-center gap-2 rounded-full px-3 py-1 text-[0.8125rem] font-semibold shadow-sm backdrop-blur-md"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 16%, var(--surface-elevated))`,
      }}
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${status === "reconnecting" ? "animate-spin motion-reduce:animate-none" : ""}`}
        strokeWidth={2.2}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </div>
    </div>
  );
}
