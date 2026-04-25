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
    <main className="flex min-h-[100svh] flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-10 text-center">
          <h1 className="text-3xl font-bold tracking-tighter text-foreground">{"\u041f\u0440\u0438\u0441\u043e\u0435\u0434\u0438\u043d\u0438\u0442\u044c\u0441\u044f"}</h1>
          <p className="mt-2 text-sm text-muted">{"\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0434\u043b\u044f \u0441\u043e\u0437\u0434\u0430\u043d\u0438\u044f \u043f\u0440\u043e\u0444\u0438\u043b\u044f."}</p>
        </div>

        <form className="space-y-4" id="join-form" onSubmit={handleSubmit}>
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
              name="username"
              type="text"
              placeholder="Username"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <input
              className="input-nox"
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
              className="input-nox"
              name="inviteCode"
              type="text"
              placeholder={"\u041a\u043e\u0434 \u043f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f"}
              autoComplete="off"
              required
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
            />
          </div>

          <p className="text-center text-xs text-red-400" id="join-error">
            {error}
          </p>

          <button className="btn-primary w-full" disabled={pending} type="submit">
            {pending ? "..." : "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link className="text-sm font-medium text-muted transition hover:text-primary" href="/login">
            {"\u0423\u0436\u0435 \u0435\u0441\u0442\u044c \u043f\u0440\u043e\u0444\u0438\u043b\u044c? \u0412\u043e\u0439\u0442\u0438"}
          </Link>
        </div>
      </div>
    </main>
  );
}
