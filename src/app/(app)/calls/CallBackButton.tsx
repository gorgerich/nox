"use client";

import { Phone } from "lucide-react";
import { useAudioCall } from "./CallProvider";

// One-tap "call back" for a call-log row. Reuses the existing startCall flow
// (same path the in-chat call button uses) — no WebRTC logic is touched here,
// this is only a UI entry point.
export function CallBackButton({
  chatId,
  displayName,
  avatarUrl,
}: {
  chatId: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  const { startCall } = useAudioCall();

  return (
    <button
      type="button"
      onClick={() => void startCall(chatId, { displayName, avatarUrl }, { video: false })}
      className="touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-smooth hover:bg-primary/15 active:scale-95"
      aria-label={`Перезвонить: ${displayName}`}
    >
      <Phone className="h-5 w-5" strokeWidth={2.1} />
    </button>
  );
}
