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
    <main className="auth-screen app-screen justify-center px-6 py-10 safe-bottom">
      <div className="mx-auto w-full max-w-sm">
        <header className="flex flex-col items-center text-center">
          <div className="auth-wordmark" aria-hidden="true">Nox</div>
          <h1 className="mt-4 text-[1.75rem] font-bold tracking-tight text-foreground">Восстановление</h1>
          <p className="mt-2 max-w-[20rem] text-[0.9375rem] leading-6 text-muted">
            {step === "request" ? "Введите логин или email. Если аккаунт существует, мы создадим запрос на восстановление." : "Попросите владельца или администратора подтвердить запрос и назвать код. Если у вас открыто доверенное устройство Nox, запрос появится там."}
          </p>
        </header>

        <div className="auth-card mt-6 p-4">
          {step === "request" && (
            <form className="space-y-4" onSubmit={handleRequestSubmit}>
              <div className="auth-field">
              <input
                className="min-w-0 flex-1 bg-transparent px-4 text-[1rem] text-foreground outline-none placeholder:text-muted/70"
                aria-label="Логин или email"
                name="identifier"
                type="text"
                placeholder="Логин или Email"
                required
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
              </div>

              <div className="rounded-[0.875rem] bg-warning/10 px-4 py-3">
               <p className="text-[0.75rem] font-normal leading-5 text-warning">
                 Если вы сбрасываете пароль на новом устройстве,{" "}
                 <span className="font-semibold">старые зашифрованные сообщения могут стать недоступны</span>{" "}
                 без ключа восстановления или доверенного устройства.
               </p>
               <p className="mt-1 text-[0.75rem] text-warning/80">
                 Ключи восстановления пока в разработке.
               </p>
              </div>

              {error && <p role="alert" className="px-1 text-[0.8125rem] font-medium text-destructive">{error}</p>}

              <button className="auth-primary w-full text-[0.9375rem] disabled:opacity-45" disabled={pending || !identifier.trim()} type="submit">
                {pending ? "Отправка..." : "Продолжить"}
              </button>
            </form>
          )}

          {step === "verify" && (
            <form className="space-y-4" onSubmit={handleVerifySubmit}>
              <p role="status" className="rounded-[0.875rem] bg-primary/8 px-4 py-3 text-[0.8125rem] leading-5 text-primary">{message}</p>
            
              <div className="space-y-3">
                <div className="auth-field">
              <input
                className="min-w-0 flex-1 bg-transparent px-4 text-center text-[1rem] font-semibold tracking-[0.08em] text-foreground outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-muted/70"
                aria-label="Код подтверждения"
                name="publicCode"
                type="text"
                placeholder="Код подтверждения"
                required
                value={publicCode}
                onChange={(e) => setPublicCode(e.target.value)}
              />
                </div>
                <div className="auth-field">
              <input
                className="min-w-0 flex-1 bg-transparent px-4 text-[1rem] text-foreground outline-none placeholder:text-muted/70"
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
              </div>

              {error && <p role="alert" className="px-1 text-[0.8125rem] font-medium text-destructive">{error}</p>}

              <button className="auth-primary w-full text-[0.9375rem] disabled:opacity-45" disabled={pending || !publicCode.trim() || newPassword.length < 8} type="submit">
                {pending ? "Сохранение..." : "Сохранить новый пароль"}
              </button>

              <p className="px-2 text-center text-[0.75rem] leading-5 text-muted">
                Код доступен после подтверждения заявки у администратора или на доверенном устройстве Nox.
              </p>
            </form>
          )}
        </div>

        {step === "request" && (
          <div className="mt-3 text-center">
            <Link className="touch-target inline-flex items-center text-[0.9375rem] font-medium text-muted transition-colors hover:text-foreground" href="/login">
              Отмена
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
