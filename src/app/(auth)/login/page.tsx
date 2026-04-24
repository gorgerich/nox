"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        login: formData.get("login"),
        password: formData.get("password"),
      }),
    });

    setPending(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не удалось войти.");
      return;
    }

    router.push("/chats");
    router.refresh();
  }

  return (
    <main className="flex min-h-[100svh] flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tighter text-foreground">Вход</h1>
          <p className="mt-2 text-sm text-muted">Введите приватный логин.</p>
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
              name="password"
              type="password"
              placeholder="Пароль"
              autoComplete="current-password"
              required
            />
          </div>

          {error ? <p className="text-center text-xs text-red-400">{error}</p> : null}

          <button
            className="btn-primary w-full"
            disabled={pending}
            type="submit"
          >
            {pending ? "..." : "Войти"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link className="text-sm font-medium text-muted transition hover:text-primary" href="/join">
            Присоединиться по приглашению
          </Link>
        </div>
      </div>
    </main>
  );
}
