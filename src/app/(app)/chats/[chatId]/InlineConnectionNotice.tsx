"use client";

import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
export function InlineConnectionNotice({ status }: { status: ConnectionStatus }) {
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

  if (!visible || status === "online") return null;

  const { label, tone } = COPY[status];
  const Icon = status === "restored" ? Wifi : status === "reconnecting" ? RefreshCw : CloudOff;
  const color =
    tone === "destructive" ? "var(--destructive)" : tone === "success" ? "var(--success)" : "var(--warning)";

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-[13px] font-semibold"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      <Icon
        className={`h-4 w-4 shrink-0 ${status === "reconnecting" ? "animate-spin motion-reduce:animate-none" : ""}`}
        strokeWidth={2.2}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </div>
  );
}
