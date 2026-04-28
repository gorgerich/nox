"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAudioCall } from "../CallProvider";

export function IncomingCallResume({ callId }: { callId: string | null }) {
  const router = useRouter();
  const { status, error, resumePendingCall } = useAudioCall();

  useEffect(() => {
    if (!callId) return;
    resumePendingCall(callId);
  }, [callId, resumePendingCall]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="max-w-sm rounded-3xl border border-border-subtle bg-surface/80 p-6 shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-muted">Nox call</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight">
          {callId ? "Открываем входящий звонок" : "Вызов не найден"}
        </h1>
        <p className="mt-3 text-sm font-semibold text-muted">
          {error || (status === "incoming" ? "Ответьте на экране звонка." : "Подключаемся к защищённому звонку...")}
        </p>
        {!callId || error ? (
          <button
            type="button"
            onClick={() => router.push("/chats")}
            className="mt-5 rounded-2xl bg-primary px-5 py-3 text-sm font-black text-white active:scale-95"
          >
            Вернуться в чаты
          </button>
        ) : null}
      </div>
    </main>
  );
}
