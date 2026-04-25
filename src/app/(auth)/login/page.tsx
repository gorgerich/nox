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
        setError(LOGIN_ERROR_MESSAGE);
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
    <main className="flex min-h-[100svh] flex-col items-center justify-center bg-background px-6">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tighter text-foreground">{"\u0412\u0445\u043e\u0434"}</h1>
          <p className="mt-2 text-sm text-muted">{"\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0439 \u043b\u043e\u0433\u0438\u043d."}</p>
        </div>

        <form className="space-y-4" id="login-form" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <input
              className="input-nox"
              name="login"
              type="text"
              placeholder={"\u041b\u043e\u0433\u0438\u043d"}
              autoComplete="username"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
            <input
              className="input-nox"
              name="password"
              type="password"
              placeholder={"\u041f\u0430\u0440\u043e\u043b\u044c"}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <p className="text-center text-xs text-red-400" id="login-error">
            {error}
          </p>

          <button className="btn-primary w-full" disabled={pending} type="submit">
            {pending ? "..." : "\u0412\u043e\u0439\u0442\u0438"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link className="text-sm font-medium text-muted transition hover:text-primary" href="/join">
            {"\u041f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d\u0438\u0442\u044c\u0441\u044f \u043f\u043e \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044e"}
          </Link>
        </div>
      </div>
    </main>
  );
}
