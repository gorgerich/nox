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
    const t = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(t);
  }, [callId, resumePendingCall]);

  const stuck = timedOut && (status === "idle" || status === "connecting") && !error;

  return (
    <main className="safe-top safe-bottom flex min-h-[100dvh] flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <div className="w-full max-w-xs">
        <p className="text-[0.8125rem] font-semibold text-primary">Nox Call</p>
        <h1 className="mt-2 text-[1.5rem] font-semibold leading-tight">
          {!callId ? "Вызов не найден" : stuck ? "Не удалось открыть вызов" : "Открываем входящий звонок"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {error
            || (stuck ? "Проверьте соединение и попробуйте ещё раз."
              : status === "incoming" ? "Ответьте на экране звонка."
              : "Восстанавливаем соединение...")}
        </p>
        {callId && stuck ? (
          <button
            type="button"
            onClick={() => { setTimedOut(false); resumePendingCall(callId); }}
            className="mt-5 min-h-11 w-full rounded-[0.875rem] bg-primary px-5 py-3 text-sm font-semibold text-white transition-smooth active:scale-[0.98]"
          >
            Повторить
          </button>
        ) : null}
        {!callId || error || stuck ? (
          <button
            type="button"
            onClick={() => router.push("/chats")}
            className="mt-2 min-h-11 w-full rounded-[0.875rem] bg-foreground/[0.06] px-5 py-3 text-sm font-semibold text-foreground transition-smooth active:scale-[0.98]"
          >
            Вернуться в чаты
          </button>
        ) : null}
      </div>
    </main>
  );
}
