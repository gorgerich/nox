"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAudioCall } from "../CallProvider";

export function IncomingCallResume({ callId }: { callId: string | null }) {
  const router = useRouter();
  const { status, error, resumePendingCall } = useAudioCall();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!callId) return;
    resumePendingCall(callId);
    // Safety net: never hang on "Подключаемся" forever. If the call never
    // surfaces (cold socket never connected, etc.) show a retry path.
    const t = setTimeout(() => setTimedOut(true), 15000);
    return () => clearTimeout(t);
  }, [callId, resumePendingCall]);

  const stuck = timedOut && (status === "idle" || status === "connecting") && !error;

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="max-w-sm rounded-3xl border border-border-subtle bg-surface/80 p-6 shadow-xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-muted">Nox call</p>
        <h1 className="mt-3 text-2xl font-black tracking-tight">
          {!callId ? "Вызов не найден" : stuck ? "Не удалось открыть вызов" : "Открываем входящий звонок"}
        </h1>
        <p className="mt-3 text-sm font-semibold text-muted">
          {error
            || (stuck ? "Проверьте соединение и попробуйте ещё раз."
              : status === "incoming" ? "Ответьте на экране звонка."
              : "Подключаемся к защищённому звонку...")}
        </p>
        {callId && stuck ? (
          <button
            type="button"
            onClick={() => { setTimedOut(false); resumePendingCall(callId); }}
            className="mt-5 rounded-2xl bg-primary px-5 py-3 text-sm font-black text-white active:scale-[0.96]"
          >
            Повторить
          </button>
        ) : null}
        {!callId || error || stuck ? (
          <button
            type="button"
            onClick={() => router.push("/chats")}
            className="mt-3 rounded-2xl bg-foreground/5 px-5 py-3 text-sm font-black text-foreground active:scale-[0.96]"
          >
            Вернуться в чаты
          </button>
        ) : null}
      </div>
    </main>
  );
}
