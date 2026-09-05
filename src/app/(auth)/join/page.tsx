"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useState } from "react";
import { Eye, EyeOff, KeyRound, Lock, UserRound } from "lucide-react";

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
  const [passwordVisible, setPasswordVisible] = useState(false);
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
    <main className="auth-screen app-screen justify-center px-6 py-[calc(env(safe-area-inset-top,0px)+1.5rem)] safe-bottom">
      <div className="mx-auto w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="auth-wordmark" aria-hidden="true">Nox</div>
          <h1 className="mt-4 text-[1.75rem] font-bold leading-tight text-foreground">Создать профиль</h1>
          <p className="mt-2 max-w-[17rem] text-[0.9375rem] leading-6 text-muted">
            {step === "account" ? "Сначала логин, пароль и код приглашения." : "Теперь выберите публичный username."}
          </p>
        </div>

        <div className="mx-auto mb-4 mt-5 grid w-28 grid-cols-2 gap-2" aria-label={`Шаг ${step === "account" ? 1 : 2} из 2`}>
          <div className={`h-1 rounded-full transition-smooth ${step === "account" ? "bg-primary" : "bg-primary/35"}`} />
          <div className={`h-1 rounded-full transition-smooth ${step === "username" ? "bg-primary" : "bg-foreground/10"}`} />
        </div>

        {step === "account" ? (
          <form className="auth-card p-4" id="join-account-form" onSubmit={handleAccountStep}>
            <div className="space-y-3">
              <div className="auth-field px-4">
                <UserRound className="mr-3 h-5 w-5 shrink-0 text-primary" strokeWidth={2.2} aria-hidden="true" />
                <input
                  aria-label="Логин"
                  name="login"
                  type="text"
                  placeholder="Логин"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                />
              </div>
              <div className="auth-field px-4">
                <Lock className="mr-3 h-5 w-5 shrink-0 text-primary" strokeWidth={2.2} aria-hidden="true" />
                <input
                  aria-label="Пароль"
                  name="password"
                  type={passwordVisible ? "text" : "password"}
                  placeholder="Пароль"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="fast-tap -mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted transition-smooth active:scale-[0.96]"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={passwordVisible ? "Скрыть пароль" : "Показать пароль"}
                  aria-pressed={passwordVisible}
                >
                  {passwordVisible ? <EyeOff className="h-5 w-5" strokeWidth={2.1} /> : <Eye className="h-5 w-5" strokeWidth={2.1} />}
                </button>
              </div>
              <div className="auth-field px-4">
                <KeyRound className="mr-3 h-5 w-5 shrink-0 text-primary" strokeWidth={2.2} aria-hidden="true" />
                <input
                  aria-label="Код приглашения"
                  name="inviteCode"
                  type="text"
                  placeholder="Код приглашения"
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="px-2 pt-3 text-sm font-semibold text-danger animate-in fade-in" id="join-error">
                {error}
              </p>
            )}

            <button
              className="auth-primary-button mt-4"
              disabled={!login.trim() || !password.trim() || !inviteCode.trim()}
              type="submit"
            >
              Далее
            </button>
          </form>
        ) : (
          <form className="auth-card p-4" id="join-form" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <div className="auth-field px-4">
                <UserRound className="mr-3 h-5 w-5 shrink-0 text-primary" strokeWidth={2.2} aria-hidden="true" />
                <input
                  aria-label="Username"
                  name="username"
                  type="text"
                  placeholder="Username, можно на русском"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <p className="px-1 text-[0.8125rem] leading-5 text-muted">Username видят другие пользователи. Разрешены буквы, цифры и нижнее подчёркивание.</p>
            </div>

            {error && (
              <p className="px-2 pt-3 text-sm font-semibold text-danger animate-in fade-in" id="join-error">
                {error}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <button
                className="fast-tap flex h-12 flex-1 items-center justify-center rounded-[14px] bg-surface-secondary text-sm font-semibold text-foreground transition-smooth active:scale-[0.96]"
                type="button"
                onClick={() => {
                  setError("");
                  setStep("account");
                }}
              >
                Назад
              </button>
              <button className="fast-tap flex h-12 flex-1 items-center justify-center rounded-[14px] bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45" disabled={pending || !username.trim()} type="submit">
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
