"use client";

import Image from "next/image";
import Link from "next/link";
import { Info, PhoneIncoming, PhoneMissed, PhoneOutgoing } from "lucide-react";
import { useAudioCall } from "./CallProvider";

type CallLogRowProps = {
  chatId: string;
  partnerId: string;
  displayName: string;
  avatarUrl: string | null;
  fullAvatarUrl: string | null;
  status: string;
  isOutgoing: boolean;
  startedAt: string;
  durationSec: number | null;
};

function formatDuration(sec: number | null) {
  if (!sec) return "";
  const mins = Math.floor(sec / 60);
  const s = sec % 60;
  if (mins > 0) return `${mins}м ${s}с`;
  return `${s}с`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  }).format(new Date(value));
}

export function CallLogRow({
  chatId,
  partnerId,
  displayName,
  avatarUrl,
  fullAvatarUrl,
  status,
  isOutgoing,
  startedAt,
  durationSec,
}: CallLogRowProps) {
  const { startCall } = useAudioCall();

  let StatusIcon = PhoneIncoming;
  let statusColor = "text-foreground/70";
  let statusLabel = isOutgoing ? "Исходящий" : "Входящий";

  if (status === "missed" || status === "declined") {
    StatusIcon = PhoneMissed;
    statusColor = "text-danger";
    statusLabel = status === "missed" ? "Пропущенный" : "Отклонён";
  } else if (isOutgoing) {
    StatusIcon = PhoneOutgoing;
  }

  const startAudioCall = () => {
    void startCall(chatId, { displayName, avatarUrl }, { video: false });
  };
  const needsAttention = status === "missed";

  return (
    <div
      role="button"
      tabIndex={0}
      className={`nox-list-row group fast-tap ${needsAttention ? "bg-danger/[0.025]" : ""}`}
      onClick={startAudioCall}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          startAudioCall();
        }
      }}
      aria-label={`Позвонить: ${displayName}`}
    >
      <div className="nox-avatar">
        {fullAvatarUrl ? (
          <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {displayName[0].toUpperCase()}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="nox-row-title">{displayName}</p>
          <span className="nox-row-meta">{formatTime(startedAt)}</span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
          <p className={`nox-row-subtitle !mt-0 ${statusColor}`}>
            {statusLabel}
            {durationSec ? ` • ${formatDuration(durationSec)}` : ""}
          </p>
        </div>
      </div>

      <Link
        href={`/users/${partnerId}`}
        className="touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted/48 transition-smooth hover:bg-foreground/5 hover:text-muted active:scale-[0.96]"
        aria-label={`Профиль: ${displayName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <Info className="h-5 w-5" strokeWidth={2} />
      </Link>
    </div>
  );
}
