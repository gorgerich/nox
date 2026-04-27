"use client";

import Link from "next/link";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernameOrEmail: identifier }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Произошла ошибка при отправке запроса.");
        return;
      }

      setMessage(data?.message || "Инструкции отправлены.");
      setIdentifier("");
    } catch {
      setError("Произошла ошибка при отправке запроса.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="app-screen items-center justify-center px-6 safe-top safe-bottom transition-smooth">
      <div className="w-full max-w-[360px] animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10 text-primary shadow-2xl shadow-primary/5 border border-primary/20">
             <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Сброс пароля</h1>
          <p className="mt-3 text-sm text-muted font-medium">Введите ваш логин или email для получения инструкций.</p>
        </div>

        {message ? (
          <div className="rounded-3xl border border-primary/20 bg-primary/10 p-6 text-center shadow-2xl animate-in zoom-in-95">
             <p className="text-sm font-bold text-primary leading-relaxed">{message}</p>
             <Link className="btn-nox mt-8 w-full bg-surface text-foreground shadow-sm uppercase tracking-widest text-xs inline-flex items-center justify-center" href="/login">
                Вернуться ко входу
             </Link>
          </div>
        ) : (
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-3">
              <input
                className="input-nox h-14"
                name="identifier"
                type="text"
                placeholder="Логин или Email"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 shadow-inner">
               <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400/90 leading-relaxed text-center">
                 Из-за сквозного шифрования Nox не хранит ключи от ваших сообщений.
                 После сброса пароля старые сообщения могут быть недоступны на новом устройстве,
                 если у вас нет recovery key или доверенного устройства.
               </p>
               <p className="text-[10px] font-black uppercase tracking-widest text-amber-600/70 dark:text-amber-400/50 mt-3 text-center">
                 (Recovery keys в разработке)
               </p>
            </div>

            {error && (
              <p className="text-center text-xs font-bold text-red-400 animate-in fade-in zoom-in-95">
                {error}
              </p>
            )}

            <button 
              className="btn-nox w-full bg-primary h-14 rounded-[1.25rem] text-sm font-black text-neutral-950 shadow-xl shadow-primary/20 transition-smooth active:scale-95 disabled:opacity-30 uppercase tracking-widest" 
              disabled={pending || !identifier.trim()} 
              type="submit"
            >
              {pending ? "Отправка..." : "Сбросить пароль"}
            </button>
          </form>
        )}

        {!message && (
          <div className="mt-8 text-center">
            <Link className="touch-target inline-flex items-center text-[11px] font-black uppercase tracking-widest text-muted transition-smooth hover:text-foreground active:scale-95" href="/login">
              Отмена
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
