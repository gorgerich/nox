"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useTheme } from "@/components/ThemeProvider";
import Image from "next/image";

type UserWithProfile = {
  id: string;
  username: string;
  role: string;
  profile: {
    displayName: string;
    avatarUrl: string | null;
    bio: string | null;
    showOnline: boolean;
    showReadReceipts: boolean;
  } | null;
};

export function ProfileContent({ user }: { user: UserWithProfile }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.profile?.displayName || "");
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.profile?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user.profile?.avatarUrl || null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const { isSubscribed, subscribe, unsubscribe } = usePushNotifications();
  const { theme, setTheme } = useTheme();

  const fullAvatarUrl = avatarUrl 
    ? (avatarUrl.startsWith('http') ? avatarUrl : `/api/avatars/${avatarUrl}`)
    : null;

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setPending(true);
    setMessage("");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/me/avatar", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Не удалось загрузить фото");

      setAvatarUrl(data.avatarUrl);
      setMessage("Фото профиля обновлено");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка загрузки");
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleAvatarDelete() {
    if (!confirm("Удалить фото профиля?")) return;
    setPending(true);
    try {
      const res = await fetch("/api/me/avatar", { method: "DELETE" });
      if (res.ok) {
        setAvatarUrl(null);
        setMessage("Фото профиля удалено");
        router.refresh();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setPending(false);
    }
  }

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
    <div className="pb-20 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <section className="flex flex-col items-center text-center mt-4">
        <div className="group relative mb-6">
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={pending}
            className="flex h-32 w-32 items-center justify-center rounded-[2.5rem] border-4 border-surface shadow-2xl transition-smooth group-hover:scale-105 active:scale-95 overflow-hidden bg-surface-muted relative"
          >
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt={displayName} fill className="object-cover" />
            ) : (
              <span className="text-4xl font-black text-primary">
                {displayName[0]?.toUpperCase() || username[0]?.toUpperCase()}
              </span>
            )}
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
          </button>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleAvatarUpload} 
            accept="image/*" 
            className="hidden" 
          />
          
          {avatarUrl && (
            <button 
              onClick={handleAvatarDelete}
              className="absolute -bottom-2 -right-2 h-10 w-10 bg-surface border border-border-subtle rounded-2xl flex items-center justify-center text-red-400 shadow-xl active:scale-90 transition-smooth"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
        
        <h2 className="text-3xl font-black tracking-tight text-foreground">{displayName || username}</h2>
        <p className="text-sm font-bold text-primary tracking-widest uppercase mt-1">@{username}</p>
      </section>

      <div className="space-y-10 px-1 mt-12">


        {/* Appearance Section */}
        <section className="space-y-6">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 ml-1">Оформление</h3>
          <div className="flex bg-surface-muted p-1 rounded-2xl border border-border-subtle/50">
            {(["light", "dark", "system"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTheme(t)}
                className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-xl transition-smooth ${
                  theme === t ? "bg-surface text-primary shadow-sm" : "text-muted hover:text-foreground"
                }`}
              >
                {t === "light" ? "Светлая" : t === "dark" ? "Тёмная" : "Система"}
              </button>
            ))}
          </div>
        </section>

        {/* Notifications Section */}
        <section className="space-y-6">
          <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 ml-1">Уведомления</h3>
          <div className="card-premium p-6 flex items-center justify-between gap-4">
             <div className="min-w-0">
               <p className="text-sm font-bold text-foreground mb-1">Push-уведомления</p>
               <p className="text-xs text-muted leading-relaxed">Получать уведомления о новых сообщениях и звонках.</p>
             </div>
             <button 
               onClick={isSubscribed ? unsubscribe : subscribe}
               className={`h-10 px-4 rounded-xl text-[10px] font-black uppercase tracking-widest transition-smooth active:scale-95 ${
                 isSubscribed ? "bg-primary/10 text-primary border border-primary/20" : "bg-primary text-white shadow-lg shadow-primary/20"
               }`}
             >
               {isSubscribed ? "Отключить" : "Включить"}
             </button>
          </div>
        </section>

        {/* Account Settings */}
        <form onSubmit={handleUpdate} className="space-y-8">
          <div className="space-y-6">
             <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-muted/60 ml-1">Настройки профиля</h3>
             
             <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted/80 ml-4">Имя</label>
                  <input
                    className="input-nox"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ваше имя"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted/80 ml-4">Username</label>
                  <input
                    className="input-nox"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-muted/80 ml-4">О себе</label>
                  <textarea
                    className="input-nox min-h-[100px] resize-none"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Расскажите о себе..."
                  />
                </div>
             </div>
          </div>

          <div className="space-y-4 pt-4">
            {message && <p className="text-center text-xs font-bold text-primary animate-in fade-in py-2">{message}</p>}
            
            <button
              type="submit"
              disabled={pending}
              className="btn-nox w-full bg-primary text-white shadow-xl shadow-primary/10 uppercase tracking-widest text-xs"
            >
              {pending ? "Сохранение..." : "Сохранить изменения"}
            </button>

            {isAdmin && (
              <Link
                href="/admin"
                className="btn-nox w-full bg-surface-muted text-muted hover:text-foreground border border-border-subtle/50 uppercase tracking-widest text-xs"
              >
                Админ-панель
              </Link>
            )}

            <button
              type="button"
              onClick={() => router.push("/api/auth/logout")}
              className="btn-nox w-full bg-surface-hover/30 text-red-400 border border-red-500/10 active:bg-red-500/5 uppercase tracking-widest text-xs mt-8"
            >
              Выйти из аккаунта
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
