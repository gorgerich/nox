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
  const [inviteCode, setInviteCode] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("code") ?? "";
  });
  const [step, setStep] = useState<"account" | "username">("account");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function handleAccountStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setStep("username");
  }

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
    <main className="app-screen justify-center px-5 py-[calc(env(safe-area-inset-top,0px)+1.5rem)] safe-bottom transition-smooth">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary text-2xl font-bold text-primary-foreground shadow-sm">
            N
          </div>
          <h1 className="text-[2.15rem] font-bold leading-none tracking-tight text-foreground">Создать профиль</h1>
          <p className="mt-3 text-[16px] leading-6 text-muted">
            {step === "account" ? "Сначала логин, пароль и код приглашения." : "Теперь выберите публичный username."}
          </p>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-full bg-surface p-1">
          <div className={`h-2 rounded-full transition-smooth ${step === "account" ? "bg-primary" : "bg-primary/35"}`} />
          <div className={`h-2 rounded-full transition-smooth ${step === "username" ? "bg-primary" : "bg-foreground/10"}`} />
        </div>

        {step === "account" ? (
          <form className="rounded-[1.75rem] border border-border-subtle bg-surface p-3 shadow-sm" id="join-account-form" onSubmit={handleAccountStep}>
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
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <input
                className="h-12 w-full rounded-2xl border border-border-subtle bg-background px-4 text-[16px] font-medium outline-none transition-smooth placeholder:text-muted/55 focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
                aria-label="Код приглашения"
                name="inviteCode"
                type="text"
                placeholder="Код приглашения"
                autoComplete="off"
                required
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
              />
            </div>

            {error && (
              <p className="px-2 pt-3 text-sm font-semibold text-danger animate-in fade-in" id="join-error">
                {error}
              </p>
            )}

            <button
              className="fast-tap mt-4 flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
              disabled={!login.trim() || !password.trim() || !inviteCode.trim()}
              type="submit"
            >
              Далее
            </button>
          </form>
        ) : (
          <form className="rounded-[1.75rem] border border-border-subtle bg-surface p-3 shadow-sm" id="join-form" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <input
                className="h-12 w-full rounded-2xl border border-border-subtle bg-background px-4 text-[16px] font-medium outline-none transition-smooth placeholder:text-muted/55 focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
                aria-label="Username"
                name="username"
                type="text"
                placeholder="Username, можно на русском"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <p className="px-1 text-[13px] leading-5 text-muted">Username видят другие пользователи. Разрешены буквы, цифры и нижнее подчёркивание.</p>
            </div>

            {error && (
              <p className="px-2 pt-3 text-sm font-semibold text-danger animate-in fade-in" id="join-error">
                {error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                className="fast-tap flex h-12 flex-1 items-center justify-center rounded-full border border-border-subtle bg-background text-sm font-semibold text-foreground transition-smooth active:scale-[0.96]"
                type="button"
                onClick={() => {
                  setError("");
                  setStep("account");
                }}
              >
                Назад
              </button>
              <button className="fast-tap flex h-12 flex-1 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45" disabled={pending} type="submit">
                {pending ? "Подождите..." : "Создать"}
              </button>
            </div>
          </form>
        )}

        <div className="mt-5 text-center">
          <Link className="fast-tap inline-flex h-10 items-center justify-center px-3 text-sm font-medium text-muted transition-smooth active:scale-[0.96]" href="/login">
            Уже есть профиль?&nbsp;<span className="font-semibold text-primary">Войти</span>
          </Link>
        </div>
      </div>
    </main>
  );
}
