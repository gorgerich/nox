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
    <main className="app-screen items-center justify-center px-6 safe-top safe-bottom transition-smooth">
      <div className="w-full max-w-[360px] animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10 text-primary shadow-2xl shadow-primary/5 border border-primary/20">
            <span className="text-3xl font-black">N</span>
          </div>
          <h1 className="text-4xl font-black tracking-tight text-foreground">Вход</h1>
          <p className="mt-3 text-base text-muted font-medium">Введите ваши учетные данные Nox.</p>
        </div>

        <form className="space-y-6" id="login-form" onSubmit={handleSubmit}>
          <div className="space-y-3">
            <input
              className="input-nox h-14"
              name="login"
              type="text"
              placeholder="Логин"
              autoComplete="username"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
            <input
              className="input-nox h-14"
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
            <p className="text-center text-xs font-bold text-red-400 animate-in fade-in zoom-in-95" id="login-error">
              {error}
            </p>
          )}

          <button 
            className="btn-nox w-full bg-primary h-14 rounded-[1.25rem] text-sm font-black text-neutral-950 shadow-xl shadow-primary/20 transition-smooth active:scale-95 disabled:opacity-30" 
            disabled={pending} 
            type="submit"
          >
            {pending ? "ПОДОЖДИТЕ..." : "ВОЙТИ В NOX"}
          </button>
        </form>

        <div className="mt-10 text-center">
          <Link className="touch-target inline-flex items-center text-sm font-bold text-muted transition-smooth hover:text-primary active:scale-95" href="/join">
            Присоединиться по приглашению
          </Link>
        </div>
      </div>
    </main>
  );
}
