"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type UserWithProfile = {
  id: string;
  login: string | null;
  username: string;
  profile: {
    displayName: string;
    bio: string | null;
    avatarUrl: string | null;
  } | null;
};

export function ProfileContent({ user }: { user: UserWithProfile }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.profile?.displayName || "");
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.profile?.bio || "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function handleUpdate(e?: React.FormEvent) {
    e?.preventDefault();
    setPending(true);
    setMessage("");

    try {
      const res = await fetch("/api/me/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, username, bio }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось обновить профиль.");
      }

      setMessage("Профиль обновлён.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка при обновлении.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <section className="flex flex-col items-center text-center">
        <div className="group mb-4">
          <div className="flex h-24 w-24 items-center justify-center rounded-3xl border border-border-subtle bg-surface-hover text-3xl font-bold text-primary shadow-xl transition-transform duration-300 group-hover:scale-105">
            {displayName[0]?.toUpperCase() || username[0]?.toUpperCase()}
          </div>
        </div>
        <h2 className="text-xl font-bold">{displayName || username}</h2>
        <p className="text-sm text-muted">@{username}</p>
        <p className="mt-2 text-xs text-muted">Загрузка фото профиля появится позже.</p>
      </section>

      <form onSubmit={handleUpdate} className="space-y-10 px-2">
        <section className="space-y-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted">Профиль</h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="ml-1 text-xs text-muted">Имя</label>
              <input className="input-nox h-12" maxLength={50} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="ml-1 text-xs text-muted">О себе</label>
              <textarea
                className="input-nox min-h-[80px] resize-none py-3"
                maxLength={200}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Коротко о вас..."
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted">Аккаунт</h3>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="ml-1 text-xs text-muted">Username</label>
              <input className="input-nox h-12" maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="rounded-2xl border border-border-subtle bg-surface/60 px-4 py-3 text-xs text-muted">
              Логин для входа пока не редактируется.
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted">Внешний вид</h3>
          <div className="grid grid-cols-3 gap-2">
            {["Тёмная", "Светлая", "Системная"].map((themeLabel) => (
              <button
                key={themeLabel}
                type="button"
                disabled
                className="rounded-2xl border border-border-subtle p-3 text-xs font-bold text-muted opacity-70"
              >
                {themeLabel}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted">Смена темы ещё не подключена.</p>
        </section>

        <div className="pt-4">
          {message && <p className="mb-4 text-center text-xs font-bold text-primary animate-in fade-in">{message}</p>}
          <button
            className="btn-nox w-full bg-primary py-4 text-sm font-bold text-neutral-950 shadow-xl shadow-primary/10"
            disabled={pending}
            type="submit"
          >
            {pending ? "..." : "Сохранить изменения"}
          </button>
        </div>
      </form>

      <div className="px-2">
        <form action="/api/auth/logout" method="post" className="mt-4">
          <button className="btn-nox w-full border border-border-subtle bg-surface py-4 text-sm font-bold text-red-400">
            Выйти из аккаунта
          </button>
        </form>
      </div>
    </div>
  );
}
