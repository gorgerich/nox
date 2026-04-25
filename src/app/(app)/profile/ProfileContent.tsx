"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type UserWithProfile = {
  id: string;
  login: string | null;
  username: string;
  role: string;
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

  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";

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
    <div className="space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700 transition-smooth">
      <section className="flex flex-col items-center text-center">
        <div className="group mb-4">
          <div className="flex h-24 w-24 items-center justify-center rounded-[2rem] border-2 border-border-subtle bg-surface-hover text-3xl font-black text-primary shadow-2xl transition-smooth group-hover:scale-105 active:scale-95 shadow-primary/5">
            {displayName[0]?.toUpperCase() || username[0]?.toUpperCase()}
          </div>
        </div>
        <h2 className="text-2xl font-bold tracking-tight">{displayName || username}</h2>
        <p className="text-sm font-medium text-muted/60 tracking-wider">@{username}</p>
        <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted/40">Фото профиля появится скоро</p>
      </section>

      <div className="space-y-10 px-1">
        {isAdmin && (
          <section className="space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted/60 ml-1">Управление</h3>
            <div className="space-y-4">
              <Link 
                href="/admin" 
                className="flex items-center justify-between w-full bg-surface-hover/30 border-2 border-border-subtle p-5 rounded-2xl transition-smooth active:scale-[0.98] active:bg-surface-hover/50 group"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary transition-smooth group-hover:scale-110">
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <div className="text-left">
                    <p className="text-sm font-black uppercase tracking-widest text-white">Панель управления</p>
                    <p className="text-[10px] font-medium text-muted/60">Инвайты, пользователи и система</p>
                  </div>
                </div>
                <svg className="h-5 w-5 text-muted/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          </section>
        )}

        <form onSubmit={handleUpdate} className="space-y-10">
          <section className="space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted/60 ml-1">Личные данные</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-muted/50">Ваше имя</label>
                <input className="input-nox h-14 font-medium" maxLength={50} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Как вас называть?" />
              </div>
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-muted/50">О себе</label>
                <textarea
                  className="input-nox min-h-[100px] resize-none py-4 font-medium"
                  maxLength={200}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  placeholder="Расскажите немного о себе..."
                />
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted/60 ml-1">Безопасность</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="ml-1 text-[10px] font-bold uppercase tracking-widest text-muted/50">Никнейм</label>
                <input className="input-nox h-14 font-medium" maxLength={32} value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div className="rounded-2xl border border-border-subtle bg-surface-hover/30 px-5 py-4 text-[11px] font-medium text-muted/70 leading-relaxed">
                Логин для входа (ID) привязан к вашей учетной записи и не может быть изменен.
              </div>
            </div>
          </section>

          <div className="pt-6">
            {message && <p className="mb-6 text-center text-xs font-black text-primary animate-in fade-in zoom-in-95">{message}</p>}
            <button
              className="btn-nox w-full bg-primary h-14 rounded-[1.25rem] text-sm font-black text-neutral-950 shadow-xl shadow-primary/20 transition-smooth active:scale-95 disabled:grayscale"
              disabled={pending}
              type="submit"
            >
              {pending ? "Сохранение..." : "СОХРАНИТЬ ИЗМЕНЕНИЯ"}
            </button>
          </div>
        </form>

        <div className="pb-10">
          <form action="/api/auth/logout" method="post">
            <button className="btn-nox w-full border-2 border-border-subtle bg-surface-hover/30 h-14 rounded-[1.25rem] text-sm font-bold text-red-400 transition-smooth active:scale-95 active:bg-red-500/5">
              Выйти из аккаунта
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
