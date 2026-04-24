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
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-4 py-8 text-neutral-100 sm:px-6 sm:py-12">
      <section className="w-full max-w-md rounded-lg border border-neutral-800 bg-neutral-900 p-5 shadow-2xl sm:p-6">
        <div className="mb-8">
          <p className="text-sm font-medium text-emerald-400">Закрытый мессенджер</p>
          <h1 className="mt-2 text-2xl font-semibold">Войти</h1>
          <p className="mt-2 text-sm text-neutral-400">Используйте приватный логин.</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm font-medium">
            Логин
            <input
              className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
              name="login"
              autoComplete="username"
              required
            />
          </label>

          <label className="block text-sm font-medium">
            Пароль
            <input
              className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {error ? <p className="text-sm text-red-300">{error}</p> : null}

          <button
            className="h-11 w-full rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? "Входим..." : "Войти"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-400">
          Есть приглашение?{" "}
          <Link className="font-medium text-emerald-300 hover:text-emerald-200" href="/join">
            Присоединиться
          </Link>
        </p>
      </section>
    </main>
  );
}
