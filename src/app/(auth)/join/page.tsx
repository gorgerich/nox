"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";

const REGISTER_ERROR_MESSAGE = "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043e\u0437\u0434\u0430\u0442\u044c \u0430\u043a\u043a\u0430\u0443\u043d\u0442.";

export default function JoinPage() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          login,
          username,
          password,
          inviteCode,
        }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? REGISTER_ERROR_MESSAGE);
        return;
      }

      router.replace("/chats");
      router.refresh();
    } catch {
      setError(REGISTER_ERROR_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="app-screen items-center justify-center px-6 safe-top safe-bottom transition-smooth">
      <div className="auth-card">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm border border-primary/20">
            <span className="text-3xl font-black">N</span>
          </div>
          <h1 className="text-3xl font-black tracking-tight text-foreground">Присоединиться</h1>
          <p className="mt-3 text-sm text-muted font-medium">Введите данные и код приглашения.</p>
        </div>

        <form className="space-y-6" id="join-form" onSubmit={handleSubmit}>
          <div className="space-y-3">
            <input
              className="input-nox h-14"
              aria-label="Логин"
              name="login"
              type="text"
              placeholder={"\u041b\u043e\u0433\u0438\u043d"}
              autoComplete="username"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
            <input
              className="input-nox h-14"
              aria-label="Username"
              name="username"
              type="text"
              placeholder="Username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="input-nox h-14"
              aria-label="Пароль"
              name="password"
              type="password"
              placeholder={"\u041f\u0430\u0440\u043e\u043b\u044c"}
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <input
              className="input-nox h-14"
              aria-label="Код приглашения"
              name="inviteCode"
              type="text"
              placeholder={"\u041a\u043e\u0434 \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f"}
              autoComplete="off"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </div>

          {error && (
            <p className="text-center text-xs font-bold text-red-400 animate-in fade-in zoom-in-95" id="join-error">
              {error}
            </p>
          )}

          <button className="btn-primary w-full h-14 rounded-[1.25rem] text-sm font-black" disabled={pending} type="submit">
            {pending ? "ПОДОЖДИТЕ..." : "СОЗДАТЬ ПРОФИЛЬ"}
          </button>
        </form>

        <div className="mt-10 text-center">
          <Link className="touch-target inline-flex items-center text-sm font-bold text-muted transition-smooth hover:text-primary active:scale-95 mx-auto" href="/login">
            {"\u0423\u0436\u0435 \u0435\u0441\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c? \u0412\u043e\u0439\u0442\u0438"}
          </Link>
        </div>
      </div>
    </main>
  );
}
