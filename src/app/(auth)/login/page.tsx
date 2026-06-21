"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

const LOGIN_ERROR_MESSAGE = "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0432\u043e\u0439\u0442\u0438.";

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ login, password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error || LOGIN_ERROR_MESSAGE);
        return;
      }

      router.replace("/chats");
      router.refresh();
    } catch {
      setError(LOGIN_ERROR_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="app-screen justify-center px-5 py-[calc(env(safe-area-inset-top,0px)+1.5rem)] safe-bottom transition-smooth">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground shadow-sm">
            N
          </div>
          <h1 className="text-[2.25rem] font-bold leading-none tracking-tight text-foreground">Войти в Nox</h1>
          <p className="mt-3 text-[16px] leading-6 text-muted">Введите логин и пароль, чтобы открыть чаты.</p>
        </div>

        <form className="rounded-[1.75rem] border border-border-subtle bg-surface p-3 shadow-sm" id="login-form" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <input
              className="h-12 w-full rounded-2xl border border-border-subtle bg-background px-4 text-[16px] font-medium outline-none transition-smooth placeholder:text-muted/55 focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
              aria-label="Логин"
              name="login"
              type="text"
              placeholder="Логин"
              autoComplete="username"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
            <input
              className="h-12 w-full rounded-2xl border border-border-subtle bg-background px-4 text-[16px] font-medium outline-none transition-smooth placeholder:text-muted/55 focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
              aria-label="Пароль"
              name="password"
              type="password"
              placeholder="Пароль"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="px-2 pt-3 text-sm font-semibold text-danger animate-in fade-in" id="login-error">
              {error}
            </p>
          )}

          <button 
            className="fast-tap mt-4 flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
            disabled={pending} 
            type="submit"
          >
            {pending ? "Подождите..." : "Войти"}
          </button>
        </form>

        <div className="mt-5 flex flex-col gap-3">
          <Link className="fast-tap flex h-12 items-center justify-center rounded-full border border-border-subtle bg-surface text-sm font-semibold text-primary transition-smooth active:scale-[0.96]" href="/join">
            Присоединиться по приглашению
          </Link>
          <Link className="fast-tap flex h-10 items-center justify-center text-sm font-semibold text-muted transition-smooth hover:text-primary active:scale-[0.96]" href="/forgot-password">
            Забыли пароль?
          </Link>
        </div>
      </div>
    </main>
  );
}
