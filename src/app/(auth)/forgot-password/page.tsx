"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const [step, setStep] = useState<"request" | "verify">("request");
  const [publicCode, setPublicCode] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function handleRequestSubmit(e: React.FormEvent<HTMLFormElement>) {
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

      setMessage(data?.message || "Если аккаунт существует, мы создали запрос. Его может подтвердить активное устройство или администратор.");
      setStep("verify");
    } catch {
      setError("Произошла ошибка при отправке запроса.");
    } finally {
      setPending(false);
    }
  }

  async function handleVerifySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setPending(true);

    try {
      const response = await fetch("/api/auth/reset-password-with-approved-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicCode, newPassword }),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        setError(data?.error || "Произошла ошибка при сбросе пароля.");
        return;
      }

      setMessage("Пароль успешно изменён. Пожалуйста, войдите с новым паролем.");
      setTimeout(() => {
        router.push("/login");
      }, 3000);
    } catch {
      setError("Произошла ошибка при отправке запроса.");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="app-screen items-center justify-center px-6 safe-top safe-bottom transition-smooth">
      <div className="auth-card">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-6 flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-sm border border-primary/20">
             <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" /></svg>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Восстановление доступа</h1>
          <p className="mt-3 text-sm text-muted font-medium">
            {step === "request" ? "Введите логин или email. Если аккаунт существует, мы создадим запрос на восстановление." : "Попросите владельца или администратора подтвердить запрос и назвать код. Если у вас открыто доверенное устройство Nox, запрос появится там."}
          </p>
        </div>

        {step === "request" && (
          <form className="space-y-6" onSubmit={handleRequestSubmit}>
            <div className="space-y-3">
              <input
                className="input-nox h-14"
                aria-label="Логин или email"
                name="identifier"
                type="text"
                placeholder="Логин или Email"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>

            <div className="rounded-2xl border border-warning/20 bg-warning/10 p-4 shadow-inner">
               {/* A warning has to be read, not shouted. Four lines of centred
                   bold at 11px is the least readable way to say something that
                   matters; the weight now marks the one clause that carries the
                   consequence, and the block reads left-aligned like prose. */}
               <p className="text-xs font-normal leading-relaxed text-warning">
                 Если вы сбрасываете пароль на новом устройстве,{" "}
                 <span className="font-semibold">старые зашифрованные сообщения могут стать недоступны</span>{" "}
                 без ключа восстановления или доверенного устройства.
               </p>
               <p className="mt-2 text-xs font-medium text-warning/80">
                 Ключи восстановления пока в разработке.
               </p>
            </div>

            {error && (
              <p className="text-center text-xs font-bold text-destructive animate-in fade-in zoom-in-95">
                {error}
              </p>
            )}

            <button 
              className="btn-primary h-12 w-full rounded-full text-sm font-semibold disabled:opacity-45"
              disabled={pending || !identifier.trim()} 
              type="submit"
            >
              {pending ? "Отправка..." : "Продолжить"}
            </button>
          </form>
        )}

        {step === "verify" && (
          <form className="space-y-6 animate-in fade-in zoom-in-95" onSubmit={handleVerifySubmit}>
            <div className="mb-6 rounded-2xl border border-primary/20 bg-primary/10 p-5 text-center">
               <p className="text-xs font-bold text-primary leading-relaxed">{message}</p>
            </div>
            
            <div className="space-y-3">
              <input
                className="input-nox h-14 text-center font-semibold tracking-[0.12em]"
                aria-label="Код подтверждения"
                name="publicCode"
                type="text"
                placeholder="Код подтверждения"
                required
                value={publicCode}
                onChange={(e) => setPublicCode(e.target.value)}
              />
              <input
                className="input-nox h-14"
                aria-label="Новый пароль"
                name="newPassword"
                type="password"
                placeholder="Новый пароль (минимум 8 символов)"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            {error && (
              <p className="text-center text-xs font-bold text-destructive animate-in fade-in zoom-in-95">
                {error}
              </p>
            )}

            <button 
              className="btn-primary h-12 w-full rounded-full text-sm font-semibold disabled:opacity-45"
              disabled={pending || !publicCode.trim() || newPassword.length < 8} 
              type="submit"
            >
              {pending ? "Сохранение..." : "Сохранить новый пароль"}
            </button>

            <p className="text-center text-[10px] font-bold text-muted mt-6 px-4">
              Код можно получить у администратора после подтверждения заявки или на доверенном устройстве Nox.
            </p>
          </form>
        )}

        {step === "request" && (
          <div className="mt-8 text-center">
            <Link className="touch-target inline-flex items-center text-sm font-semibold text-muted transition-smooth hover:text-foreground active:scale-[0.96]" href="/login">
              Отмена
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
