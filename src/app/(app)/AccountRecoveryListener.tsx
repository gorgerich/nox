"use client";

import { useEffect, useState } from "react";
import { useSocket } from "@/hooks/useSocket";

type RecoveryRequest = {
  requestId: string;
  publicCode: string;
  requesterUserAgent: string | null;
  expiresAt: string;
};

export function AccountRecoveryListener() {
  const { socket } = useSocket();
  const [request, setRequest] = useState<RecoveryRequest | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleRequested = (data: RecoveryRequest) => {
      // Only show if not expired
      if (new Date(data.expiresAt).getTime() > Date.now()) {
        setRequest(data);
        setMessage(null);
        setError(null);
      }
    };

    socket.on("account-recovery:requested", handleRequested);
    return () => {
      socket.off("account-recovery:requested", handleRequested);
    };
  }, [socket]);

  if (!request) return null;

  async function handleApprove() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/recovery-requests/${request!.requestId}/approve`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Не удалось разрешить запрос");
      setMessage("Запрос на сброс пароля разрешен. Продолжите на втором устройстве.");
      setTimeout(() => setRequest(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  async function handleDeny() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/recovery-requests/${request!.requestId}/deny`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Не удалось отклонить запрос");
      setMessage("Запрос на сброс пароля отклонен.");
      setTimeout(() => setRequest(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/80 backdrop-blur-xl animate-in fade-in p-6">
      <div className="w-full max-w-sm rounded-[2.5rem] bg-surface p-6 shadow-2xl">
        <div className="mb-4 flex justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-500">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
        </div>
        <h3 className="text-xl font-black mb-2 text-center text-foreground">Сброс пароля</h3>
        <p className="text-sm text-center text-muted mb-4 font-bold leading-relaxed">
          На другом устройстве был запрошен сброс пароля для вашего аккаунта.
        </p>

        <div className="rounded-2xl border border-border-subtle bg-foreground/5 p-4 mb-6 text-center">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-1">Код подтверждения</p>
          <p className="text-3xl font-black tracking-[0.2em] text-primary">{request.publicCode}</p>
        </div>

        {request.requesterUserAgent && (
          <p className="text-[10px] text-center text-muted/60 uppercase tracking-widest mb-6">
            Устройство: {request.requesterUserAgent.substring(0, 30)}...
          </p>
        )}

        {error && <p className="text-center text-xs font-bold text-red-400 mb-4">{error}</p>}
        {message && <p className="text-center text-xs font-bold text-primary mb-4">{message}</p>}

        {!message && (
          <div className="flex gap-4">
            <button 
              onClick={handleDeny} 
              disabled={pending}
              className="flex-1 py-4 font-black uppercase tracking-widest text-xs rounded-xl bg-danger/10 text-danger transition-smooth active:scale-[0.96] disabled:opacity-50"
            >
              Отклонить
            </button>
            <button 
              onClick={handleApprove} 
              disabled={pending}
              className="flex-1 py-4 font-black uppercase tracking-widest text-xs rounded-xl bg-primary text-primary-foreground shadow-xl shadow-primary/20 transition-smooth active:scale-[0.96] disabled:opacity-50"
            >
              Разрешить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
