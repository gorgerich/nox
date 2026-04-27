"use client";

import Link from "next/link";
import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <div className="text-center">
        <p className="text-sm font-bold text-red-400 mb-6">Токен восстановления не найден.</p>
        <Link className="btn-nox w-full bg-surface text-foreground shadow-sm uppercase tracking-widest text-xs inline-flex items-center justify-center" href="/forgot-password">
          Запросить новый
        </Link>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Произошла ошибка при сбросе пароля.");
        return;
      }

      setMessage(data?.message || "Пароль успешно изменен.");
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch {
      setError("Произошла ошибка при отправке запроса.");
    } finally {
      setPending(false);
    }
  }

  if (message) {
    return (
      <div className="rounded-3xl border border-primary/20 bg-primary/10 p-6 text-center shadow-2xl animate-in zoom-in-95">
         <p className="text-sm font-bold text-primary leading-relaxed">{message}</p>
         <p className="text-xs text-muted mt-4">Перенаправление на страницу входа...</p>
         <Link className="btn-nox mt-8 w-full bg-surface text-foreground shadow-sm uppercase tracking-widest text-xs inline-flex items-center justify-center" href="/login">
            Войти сейчас
         </Link>
      </div>
    );
  }

  return (
    <form className="space-y-6" onSubmit={handleSubmit}>
      <div className="space-y-3">
        <input
          className="input-nox h-14"
          name="password"
          type="password"
          placeholder="Новый пароль (минимум 8 символов)"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 shadow-inner">
         <p className="text-[11px] font-bold text-amber-600 dark:text-amber-400/90 leading-relaxed text-center">
           Из-за сквозного шифрования Nox не хранит ключи от ваших сообщений.
           После сброса пароля старые сообщения могут быть недоступны на новом устройстве,
           если у вас нет recovery key или доверенного устройства.
         </p>
      </div>

      {error && (
        <p className="text-center text-xs font-bold text-red-400 animate-in fade-in zoom-in-95">
          {error}
        </p>
      )}

      <button 
        className="btn-nox w-full bg-primary h-14 rounded-[1.25rem] text-sm font-black text-neutral-950 shadow-xl shadow-primary/20 transition-smooth active:scale-95 disabled:opacity-30 uppercase tracking-widest" 
        disabled={pending || password.length < 8} 
        type="submit"
      >
        {pending ? "Сохранение..." : "Сохранить новый пароль"}
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="app-screen items-center justify-center px-6 safe-top safe-bottom transition-smooth">
      <div className="w-full max-w-[360px] animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10 text-primary shadow-2xl shadow-primary/5 border border-primary/20">
             <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Новый пароль</h1>
          <p className="mt-3 text-sm text-muted font-medium">Создайте новый пароль для вашего аккаунта.</p>
        </div>

        <Suspense fallback={<div className="text-center text-muted">Загрузка...</div>}>
          <ResetPasswordForm />
        </Suspense>

        <div className="mt-8 text-center">
          <Link className="touch-target inline-flex items-center text-[11px] font-black uppercase tracking-widest text-muted transition-smooth hover:text-foreground active:scale-95" href="/login">
            Отмена
          </Link>
        </div>
      </div>
    </main>
  );
}
