"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function JoinPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        login: formData.get("login"),
        username: formData.get("username"),
        password: formData.get("password"),
        inviteCode: formData.get("inviteCode"),
      }),
    });

    setPending(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не удалось создать аккаунт.");
      return;
    }

    router.push("/chats");
    router.refresh();
  }

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tighter text-foreground">Присоединиться</h1>
          <p className="mt-2 text-sm text-muted">Введите данные для создания профиля.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <input
              className="input-nox"
              name="login"
              placeholder="Логин"
              autoComplete="username"
              required
            />
            <input
              className="input-nox"
              name="username"
              placeholder="Username"
              autoComplete="username"
              required
            />
            <input
              className="input-nox"
              name="password"
              type="password"
              placeholder="Пароль"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <input
              className="input-nox"
              name="inviteCode"
              placeholder="Код приглашения"
              autoComplete="off"
              required
            />
          </div>

          {error ? <p className="text-center text-xs text-red-400">{error}</p> : null}

          <button
            className="btn-primary w-full"
            disabled={pending}
            type="submit"
          >
            {pending ? "..." : "Создать профиль"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link className="text-sm font-medium text-muted transition hover:text-primary" href="/login">
            Уже есть профиль? Войти
          </Link>
        </div>
      </div>
    </main>
  );
}
