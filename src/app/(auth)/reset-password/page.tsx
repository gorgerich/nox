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
        <p role="alert" className="mb-4 text-[0.8125rem] font-medium text-destructive">Токен восстановления не найден.</p>
        <Link className="auth-secondary inline-flex w-full items-center justify-center text-[0.9375rem]" href="/forgot-password">
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
      <div className="text-center">
         <p role="status" className="text-[0.9375rem] font-semibold leading-6 text-primary">{message}</p>
         <p className="mt-2 text-[0.8125rem] text-muted">Переходим на страницу входа...</p>
         <Link className="auth-secondary mt-5 inline-flex w-full items-center justify-center text-[0.9375rem]" href="/login">
            Войти сейчас
         </Link>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <div className="auth-field">
        <input
          className="min-w-0 flex-1 bg-transparent px-4 text-[1rem] text-foreground outline-none placeholder:text-muted/70"
          aria-label="Новый пароль"
          name="password"
          type="password"
          placeholder="Новый пароль (минимум 8 символов)"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <div className="rounded-[0.875rem] bg-warning/10 px-4 py-3">
         <p className="text-[0.75rem] leading-5 text-warning">
           Из-за сквозного шифрования Nox не хранит ключи от ваших сообщений.
           После сброса пароля старые сообщения могут быть недоступны на новом устройстве,
           если у вас нет ключа восстановления или доверенного устройства.
         </p>
      </div>

      {error && <p role="alert" className="px-1 text-[0.8125rem] font-medium text-destructive">{error}</p>}

      <button 
        className="auth-primary w-full text-[0.9375rem] disabled:opacity-45"
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
    <main className="auth-screen app-screen justify-center px-6 py-10 safe-bottom">
      <div className="mx-auto w-full max-w-sm">
        <header className="flex flex-col items-center text-center">
          <div className="auth-wordmark" aria-hidden="true">Nox</div>
          <h1 className="mt-4 text-[1.75rem] font-bold tracking-tight text-foreground">Новый пароль</h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-muted">Создайте новый пароль для аккаунта.</p>
        </header>

        <div className="auth-card mt-6 p-4">
          <Suspense fallback={<div className="py-3 text-center text-[0.875rem] text-muted">Загрузка...</div>}>
            <ResetPasswordForm />
          </Suspense>
        </div>

        <div className="mt-3 text-center">
          <Link className="touch-target inline-flex items-center text-[0.9375rem] font-medium text-muted transition-colors hover:text-foreground" href="/login">
            Отмена
          </Link>
        </div>
      </div>
    </main>
  );
}
