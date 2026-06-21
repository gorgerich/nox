"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { ACCENT_OPTIONS, useTheme } from "@/components/ThemeProvider";
import Image from "next/image";
import { AvatarCropModal } from "./AvatarCropModal";
import { AvatarViewer } from "./AvatarViewer";
import { CacheSettings } from "./CacheSettings";
import { getLocalDeviceId, registerCurrentDevice } from "@/lib/e2ee/keys";
import { normalizeAvatarUrl } from "@/lib/media-url";

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

  const [activeScreen, setActiveScreen] = useState<"main" | "profile" | "devices" | "appearance" | "security" | "data">("main");

  const [displayName, setDisplayName] = useState(user.profile?.displayName || "");
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.profile?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user.profile?.avatarUrl || null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [showFullscreenAvatar, setShowFullscreenAvatar] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const { isSubscribed, subscribe, unsubscribe } = usePushNotifications();
  const { theme, setTheme, accent, setAccent } = useTheme();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);

  const [showTrustedReset, setShowTrustedReset] = useState(false);
  const [trustedNewPassword, setTrustedNewPassword] = useState("");
  const [trustedPending, setTrustedPending] = useState(false);
  const [trustedError, setTrustedError] = useState("");
  const [trustedMessage, setTrustedMessage] = useState("");

  const fullAvatarUrl = normalizeAvatarUrl(avatarUrl);

  async function handleTrustedReset(e: React.FormEvent) {
    e.preventDefault();
    setTrustedPending(true);
    setTrustedError("");
    setTrustedMessage("");

    try {
      const res = await fetch("/api/auth/reset-password-from-trusted-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: trustedNewPassword }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось изменить пароль.");
      }

      setTrustedMessage("Пароль успешно изменён.");
      setTrustedNewPassword("");
      setTimeout(() => setShowTrustedReset(false), 2000);
    } catch (error) {
      setTrustedError(error instanceof Error ? error.message : "Ошибка при изменении пароля.");
    } finally {
      setTrustedPending(false);
    }
  }

  async function handlePasswordChange(e: React.FormEvent) {
    e.preventDefault();
    setPasswordPending(true);
    setPasswordMessage("");
    setPasswordError("");

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || "Не удалось изменить пароль.");
      }

      setPasswordMessage("Пароль успешно изменён.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "Ошибка при изменении пароля.");
    } finally {
      setPasswordPending(false);
    }
  }

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => setCropImage(reader.result as string);
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const uploadCroppedAvatar = useCallback(async (blob: Blob) => {
    setPending(true);
    setMessage("");
    setCropImage(null);

    const formData = new FormData();
    formData.append("file", blob, "avatar.jpg");

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
    }
  }, [router]);

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
      setTimeout(() => {
        setMessage("");
        setActiveScreen("main");
      }, 1000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ошибка при обновлении.");
    } finally {
      setPending(false);
    }
  }

  async function handleLogout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed", error);
      setPending(false);
    }
  }

  return (
    <>
      {activeScreen === "main" && (
        <div className="pb-32 animate-in fade-in slide-in-from-bottom-4 duration-300 safe-top">
          <section className="mt-4 flex flex-col items-center text-center">
            <div className="group relative mb-5">
              <button
                onClick={() => {
                  if (fullAvatarUrl) setShowFullscreenAvatar(true);
                  else fileInputRef.current?.click();
                }}
                disabled={pending}
                className="relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-surface-muted transition-smooth active:scale-[0.96]"
              >
                {fullAvatarUrl ? (
                  <Image src={fullAvatarUrl} alt={displayName} fill className="object-cover" />
                ) : (
                  <span className="text-4xl font-semibold text-primary">
                    {displayName[0]?.toUpperCase() || username[0]?.toUpperCase()}
                  </span>
                )}
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
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

              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 left-0 z-10 flex h-10 w-10 items-center justify-center rounded-full border-4 border-surface bg-primary text-primary-foreground transition-smooth active:scale-[0.96]"
                title="Изменить фото"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
              </button>

              {avatarUrl && (
                <button
                  onClick={handleAvatarDelete}
                  className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface text-red-400 transition-smooth active:scale-[0.96]"
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>

            <h2 className="text-3xl font-semibold tracking-tight text-foreground">{displayName || username}</h2>
            <p className="mt-1 text-sm font-medium text-primary">@{username}</p>
          </section>

          <div className="mt-8 space-y-6 px-4">
            <section className="flex flex-col overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              <SettingsMenuButton
                label="Мой профиль"
                subtitle="Имя и username"
                onClick={() => setActiveScreen("profile")}
                icon={<ProfileIcon />}
              />
              <div className="h-px bg-border-subtle/30 mx-4" />
              <SettingsMenuButton
                label="Устройства"
                subtitle="Активные сеансы"
                onClick={() => setActiveScreen("devices")}
                icon={<DevicesIcon />}
              />
              <div className="h-px bg-border-subtle/30 mx-4" />
              <SettingsMenuButton
                label="Оформление"
                subtitle="Тема и акцент"
                onClick={() => setActiveScreen("appearance")}
                icon={<AppearanceIcon />}
              />
              <div className="h-px bg-border-subtle/30 mx-4" />
              <SettingsMenuButton
                label="Безопасность"
                subtitle="Пароль и восстановление"
                onClick={() => setActiveScreen("security")}
                icon={<SecurityIcon />}
              />
              <div className="h-px bg-border-subtle/30 mx-4" />
              <SettingsMenuButton
                label="Данные и кэш"
                subtitle="Хранилище и кэш"
                onClick={() => setActiveScreen("data")}
                icon={<DataIcon />}
              />
            </section>

            <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
              <div className="flex items-center justify-between gap-4 p-4">
                 <div className="min-w-0">
                   <p className="mb-1 text-sm font-semibold text-foreground">Push-уведомления</p>
                 </div>
                 <button
                   onClick={isSubscribed ? unsubscribe : subscribe}
                   className={`h-10 rounded-full px-4 text-sm font-semibold transition-smooth active:scale-[0.96] ${
                     isSubscribed ? "border border-primary/20 bg-primary/10 text-primary" : "bg-primary text-primary-foreground"
                   }`}
                 >
                   {isSubscribed ? "Отключить" : "Включить"}
                 </button>
              </div>
            </section>

            {isAdmin && (
              <Link
                href="/admin"
                className="flex h-12 w-full items-center justify-center rounded-full border border-border-subtle bg-surface-muted text-sm font-semibold text-muted transition-smooth hover:text-foreground active:scale-[0.96]"
              >
                Админ-панель
              </Link>
            )}

            <button
              type="button"
              onClick={handleLogout}
              disabled={pending}
              className="h-12 w-full rounded-full border border-danger/20 bg-danger/10 text-sm font-semibold text-danger transition-smooth hover:bg-danger/20 active:scale-[0.96] disabled:opacity-50"
            >
              {pending ? "Выход..." : "Выйти из аккаунта"}
            </button>
          </div>
        </div>
      )}

      {activeScreen === "profile" && (
        <div className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-32 animate-in slide-in-from-right duration-300 safe-top">
          <header className="sticky top-0 z-50 flex min-h-14 items-center justify-between border-b border-border-subtle bg-background px-3 py-2">
             <button onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 className="text-base font-semibold tracking-tight">Мой профиль</h1>
             <div className="w-10" />
          </header>

          <form onSubmit={handleUpdate} className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-500">
             <div className="space-y-4">
                <div className="space-y-2">
                  <label className="ml-4 text-sm font-medium text-muted">Имя</label>
                  <input
                    className="input-nox h-14"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ваше имя"
                  />
                </div>

                <div className="space-y-2">
                  <label className="ml-4 text-sm font-medium text-muted">Username</label>
                  <input
                    className="input-nox h-14"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                  />
                </div>

                <div className="space-y-2">
                  <label className="ml-4 text-sm font-medium text-muted">О себе</label>
                  <textarea
                    className="input-nox min-h-[120px] resize-none py-4"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    placeholder="Расскажите о себе..."
                  />
                </div>
             </div>

             <div className="pt-4">
               {message && <p className="mb-4 py-2 text-center text-sm font-semibold text-primary animate-in fade-in">{message}</p>}
               <button
                 type="submit"
                 disabled={pending}
                 className="h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-50"
               >
                 {pending ? "Сохранение..." : "Сохранить изменения"}
               </button>
             </div>
          </form>
        </div>
      )}

      {activeScreen === "devices" && (
        <div className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-32 animate-in slide-in-from-right duration-300 safe-top">
          <header className="sticky top-0 z-50 flex min-h-14 items-center justify-between border-b border-border-subtle bg-background px-3 py-2">
             <button onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 className="text-base font-semibold tracking-tight">Устройства</h1>
             <div className="w-10" />
          </header>

          <div className="animate-in fade-in zoom-in-95 duration-500">
            <E2EEDevicesPanel userId={user.id} />
          </div>
        </div>
      )}

      {activeScreen === "appearance" && (
        <div className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-32 animate-in slide-in-from-right duration-300 safe-top">
          <header className="sticky top-0 z-50 flex min-h-14 items-center justify-between border-b border-border-subtle bg-background px-3 py-2">
             <button onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 className="text-base font-semibold tracking-tight">Оформление</h1>
             <div className="w-10" />
          </header>

          <div className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-500">
            <section className="space-y-3">
              <div className="px-1">
                <h2 className="text-sm font-semibold text-muted">Тема приложения</h2>
                <p className="mt-2 text-sm font-medium text-muted leading-relaxed">Базовые поверхности остаются нейтральными, акцент применяется только к выбранным действиям и состояниям.</p>
              </div>
              <div className="grid grid-cols-3 gap-1 rounded-2xl border border-border-subtle bg-surface p-1">
                {(["light", "dark", "system"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`rounded-xl px-3 py-3 text-sm font-semibold transition-smooth active:scale-[0.96] ${
                      theme === t ? "bg-primary text-primary-foreground" : "text-muted hover:bg-foreground/5 hover:text-foreground"
                    }`}
                  >
                    {t === "light" ? "Светлая" : t === "dark" ? "Тёмная" : "Системная"}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="px-1">
                <h2 className="text-sm font-semibold text-muted">Акцентный цвет</h2>
                <p className="mt-2 text-sm font-medium text-muted leading-relaxed">Акцент меняет активную вкладку, кнопки действия, selected state и бейджи. Фон и карточки остаются чёрно-бело-серыми.</p>
              </div>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-border-subtle bg-surface p-2">
                {ACCENT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setAccent(option.value)}
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-smooth active:scale-[0.98] ${
                      accent === option.value ? "bg-primary/10 ring-1 ring-primary/25" : "hover:bg-foreground/5"
                    }`}
                  >
                    <span className="h-8 w-8 rounded-full border border-black/10 shadow-inner" style={{ backgroundColor: option.swatch }} />
                    <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{option.label}</span>
                    {accent === option.value ? (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}

      {activeScreen === "security" && (
        <div className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-32 animate-in slide-in-from-right duration-300 safe-top">
          <header className="sticky top-0 z-50 flex min-h-14 items-center justify-between border-b border-border-subtle bg-background px-3 py-2">
             <button onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 className="text-base font-semibold tracking-tight">Безопасность</h1>
             <div className="w-10" />
          </header>

          <div className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-500">
            <form onSubmit={handlePasswordChange} className="space-y-6">
               <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="ml-4 text-sm font-medium text-muted">Текущий пароль</label>
                    <input
                      className="input-nox h-14"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Введите текущий пароль"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="ml-4 text-sm font-medium text-muted">Новый пароль</label>
                    <input
                      className="input-nox h-14"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Новый пароль (минимум 8 символов)"
                    />
                  </div>
               </div>

               {passwordError && <p className="py-1 text-center text-sm font-semibold text-red-400">{passwordError}</p>}
               {passwordMessage && <p className="py-1 text-center text-sm font-semibold text-primary">{passwordMessage}</p>}

               <button
                 type="submit"
                 disabled={passwordPending || !currentPassword || newPassword.length < 8}
                 className="h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-50"
               >
                 {passwordPending ? "Сохранение..." : "Изменить пароль"}
               </button>

               <button
                 type="button"
                 onClick={() => setShowTrustedReset(true)}
                 className="h-12 w-full rounded-full bg-transparent text-sm font-semibold text-primary transition-smooth hover:bg-primary/5 active:scale-[0.96]"
               >
                 Не помню текущий пароль
               </button>
            </form>

            <div className="mt-12 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
               <p className="mb-4 text-center text-sm font-medium leading-relaxed text-amber-600 dark:text-amber-400/90">
                 Nox не хранит ключи от ваших сообщений. После сброса пароля на новом устройстве старые сообщения могут быть недоступны без доверенного устройства.
               </p>
               <Link href="/forgot-password" className="flex h-12 w-full items-center justify-center rounded-full bg-amber-500 text-sm font-semibold text-neutral-950 transition-smooth active:scale-[0.96]">
                 Сбросить пароль полностью
               </Link>
            </div>
          </div>
        </div>
      )}

      {activeScreen === "data" && (
        <div className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-32 animate-in slide-in-from-right duration-300 safe-top">
          <header className="sticky top-0 z-50 flex min-h-14 items-center justify-between border-b border-border-subtle bg-background px-3 py-2">
             <button onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 className="text-base font-semibold tracking-tight">Данные и кэш</h1>
             <div className="w-10" />
          </header>

          <div className="p-6 animate-in fade-in zoom-in-95 duration-500">
            <CacheSettings />
          </div>
        </div>
      )}

      {/* Trusted Reset Modal */}
      {showTrustedReset && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 p-6 animate-in fade-in duration-200"
          onClick={() => setShowTrustedReset(false)}
        >
          <div
            className="relative w-full max-w-sm rounded-2xl bg-surface p-5 shadow-lg"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="mb-2 text-center text-xl font-semibold">Сброс пароля</h3>
            <p className="text-xs text-muted text-center mb-6 leading-relaxed">
              Это устройство уже авторизовано. После смены пароля ваши сообщения на этом устройстве останутся доступны.
            </p>

            <form onSubmit={handleTrustedReset} className="space-y-6">
              <input
                className="input-nox h-14"
                type="password"
                value={trustedNewPassword}
                onChange={(e) => setTrustedNewPassword(e.target.value)}
                placeholder="Новый пароль (минимум 8 символов)"
                required
                minLength={8}
              />

              {trustedError && <p className="text-center text-sm font-semibold text-red-400">{trustedError}</p>}
              {trustedMessage && <p className="text-center text-sm font-semibold text-primary">{trustedMessage}</p>}

              <div className="flex gap-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowTrustedReset(false)}
                  className="flex-1 py-3 text-sm font-semibold text-muted transition-smooth active:scale-[0.96]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={trustedPending || trustedNewPassword.length < 8}
                  className="flex-1 py-3 text-sm font-semibold text-primary transition-smooth active:scale-[0.96] disabled:opacity-50"
                >
                  {trustedPending ? "..." : "Сохранить"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <AvatarViewer
        src={showFullscreenAvatar ? fullAvatarUrl : null}
        alt={displayName || username}
        fileName={`${username || "profile"}-avatar.jpg`}
        onClose={() => setShowFullscreenAvatar(false)}
      />

      {cropImage && (
        <AvatarCropModal
          imageSrc={cropImage}
          onCrop={uploadCroppedAvatar}
          onCancel={() => setCropImage(null)}
        />
      )}
    </>
  );
}

function SettingsMenuButton({ label, subtitle, icon, onClick }: { label: string, subtitle: string, icon: React.ReactNode, onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex w-full items-center gap-4 px-4 py-3.5 transition-smooth hover:bg-foreground/5 active:bg-foreground/10">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-transform">
        {icon}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 truncate text-xs font-normal text-muted">{subtitle}</p>
      </div>
      <div className="shrink-0 text-muted opacity-50 group-hover:opacity-100 transition-opacity">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
      </div>
    </button>
  );
}

function ProfileIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>; }
function DevicesIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>; }
function AppearanceIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364-2.121 2.121M7.757 16.243l-2.121 2.121m12.728 0-2.121-2.121M7.757 7.757 5.636 5.636M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
function SecurityIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>; }
function DataIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3Zm0 0v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" /></svg>; }

type E2EEDevice = {
  deviceId: string;
  name: string | null;
  platform: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  isCurrentDevice: boolean;
  fingerprintShort: string | null;
};

function getBrowserName(userAgent: string | null) {
  if (!userAgent) return "браузер не определён";
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/CriOS|Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)) return "Chrome";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent) && !/CriOS/.test(userAgent)) return "Safari";
  return "Web";
}

function getDeviceName(device: E2EEDevice) {
  const source = `${device.platform || ""} ${device.userAgent || ""}`;
  if (/iPhone/i.test(source)) return "iPhone";
  if (/iPad/i.test(source)) return "iPad";
  if (/Android/i.test(source)) return "Android";
  if (/Mac/i.test(source)) return "Mac";
  if (/Windows/i.test(source)) return "Windows PC";
  if (/Linux/i.test(source)) return "Linux";
  return device.name || "Nox Web";
}

function getPlatformName(device: E2EEDevice) {
  const source = `${device.platform || ""} ${device.userAgent || ""}`;
  const browser = getBrowserName(device.userAgent);
  let os = device.platform || "Web";
  if (/iPhone|iPad|iPod/i.test(source)) os = "iOS";
  else if (/Android/i.test(source)) os = "Android";
  else if (/Mac/i.test(source)) os = "macOS";
  else if (/Windows/i.test(source)) os = "Windows";
  else if (/Linux/i.test(source)) os = "Linux";
  return `${os} / ${browser}`;
}

function formatDeviceActivity(device: E2EEDevice) {
  if (device.isCurrentDevice) return "Это устройство";
  if (device.revokedAt) return `отозвано ${new Date(device.revokedAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`;
  if (!device.lastSeenAt) return "активность неизвестна";

  const date = new Date(device.lastSeenAt);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) return `сегодня в ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `вчера в ${time}`;
  return date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

function E2EEDevicesPanel({ userId }: { userId: string }) {
  const [devices, setDevices] = useState<E2EEDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [revokeAllPending, setRevokeAllPending] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let deviceId: string | null = null;
      try {
        const current = await registerCurrentDevice(userId);
        deviceId = current.deviceId;
      } catch {
        deviceId = await getLocalDeviceId(userId).catch(() => null);
      }
      setCurrentDeviceId(deviceId);
      const res = await fetch(`/api/e2ee/devices/me${deviceId ? `?currentDeviceId=${encodeURIComponent(deviceId)}` : ""}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Не удалось загрузить устройства");
      setDevices(Array.isArray(data?.devices) ? data.devices : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить устройства");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    queueMicrotask(() => void loadDevices());
  }, [loadDevices]);

  const revokeDevice = async (device: E2EEDevice) => {
    if (device.isCurrentDevice || device.deviceId === currentDeviceId) return;
    if (!confirm("Отозвать это устройство? Оно больше не сможет получать новые зашифрованные сообщения.")) return;
    setError("");
    setPendingDeviceId(device.deviceId);
    const previous = devices;
    const now = new Date().toISOString();
    setDevices((current) => current.map((item) => item.deviceId === device.deviceId ? { ...item, revokedAt: now } : item));
    const res = await fetch(`/api/e2ee/devices/${encodeURIComponent(device.deviceId)}/revoke`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(currentDeviceId ? { "x-nox-device-id": currentDeviceId } : {}) },
      body: JSON.stringify({ currentDeviceId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDevices(previous);
      setError(data?.error || "Не удалось отозвать устройство");
      setPendingDeviceId(null);
      return;
    }
    setPendingDeviceId(null);
    await loadDevices();
  };

  const revokeOtherDevices = async () => {
    if (!currentDeviceId) {
      setError("Не удалось определить текущее устройство");
      return;
    }
    const activeOthers = devices.filter((device) => !device.isCurrentDevice && device.deviceId !== currentDeviceId && !device.revokedAt);
    if (activeOthers.length === 0) return;
    if (!confirm("Завершить все остальные сеансы? Они больше не смогут получать новые зашифрованные сообщения.")) return;

    setError("");
    setRevokeAllPending(true);
    const previous = devices;
    const now = new Date().toISOString();
    setDevices((current) => current.map((device) => (
      device.isCurrentDevice || device.deviceId === currentDeviceId || device.revokedAt
        ? device
        : { ...device, revokedAt: now }
    )));

    const res = await fetch("/api/e2ee/devices/revoke-others", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nox-device-id": currentDeviceId },
      body: JSON.stringify({ currentDeviceId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDevices(previous);
      setError(data?.error || "Не удалось завершить остальные сеансы");
      setRevokeAllPending(false);
      return;
    }

    setRevokeAllPending(false);
    await loadDevices();
  };

  const currentDevice = devices.find((device) => device.isCurrentDevice || device.deviceId === currentDeviceId) ?? null;
  const activeOtherDevices = devices.filter((device) => device.deviceId !== currentDevice?.deviceId && !device.revokedAt);
  const revokedDevices = devices.filter((device) => device.deviceId !== currentDevice?.deviceId && device.revokedAt);

  return (
    <div className="space-y-8 px-6 py-6">
      {loading ? <p className="py-4 text-sm font-bold text-muted text-center">Загрузка...</p> : null}
      {error ? <p className="rounded-2xl bg-red-500/10 px-4 py-3 text-xs font-bold text-red-500 text-center">{error}</p> : null}

      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-sm font-semibold text-muted">Это устройство</h2>
        </div>
        {currentDevice ? (
          <DeviceSessionCard device={currentDevice} current />
        ) : !loading ? (
          <div className="rounded-2xl border border-border-subtle bg-surface p-5 text-sm font-semibold text-muted">
            Текущее устройство пока не определено.
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void revokeOtherDevices()}
          disabled={revokeAllPending || activeOtherDevices.length === 0}
          className="w-full rounded-2xl border border-danger/15 bg-danger/10 px-5 py-4 text-left transition-smooth active:scale-[0.98] disabled:opacity-45"
        >
          <span className="block text-sm font-black text-danger">Завершить все остальные сеансы</span>
          <span className="mt-1 block text-xs font-semibold text-danger/70">
            {activeOtherDevices.length > 0 ? "Отозвать ключи всех устройств, кроме текущего." : "Других активных сеансов нет."}
          </span>
        </button>
      </section>

      <section className="space-y-3">
        <div className="px-1">
          <h2 className="text-sm font-semibold text-muted">Активные сеансы</h2>
        </div>
        {activeOtherDevices.length > 0 ? (
          <div className="space-y-3">
            {activeOtherDevices.map((device) => (
              <DeviceSessionCard
                key={device.deviceId}
                device={device}
                action={
                  <button
                    onClick={() => void revokeDevice(device)}
                    disabled={pendingDeviceId === device.deviceId}
                    className="shrink-0 rounded-full bg-danger/10 px-4 py-2.5 text-xs font-semibold text-danger transition-smooth active:scale-[0.96] disabled:opacity-50"
                  >
                    {pendingDeviceId === device.deviceId ? "..." : "Завершить"}
                  </button>
                }
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-border-subtle bg-surface p-5 text-sm font-semibold text-muted">
            Других активных сеансов нет.
          </div>
        )}
      </section>

      {revokedDevices.length > 0 ? (
        <section className="space-y-3">
          <div className="px-1">
            <h2 className="text-sm font-semibold text-muted">Отозванные</h2>
          </div>
          <div className="space-y-3 opacity-75">
            {revokedDevices.map((device) => (
              <DeviceSessionCard key={device.deviceId} device={device} revoked />
            ))}
          </div>
        </section>
      ) : null}

      <p className="px-1 text-[11px] font-semibold leading-relaxed text-muted/70">
        Геолокация сеанса не отображается: сервер сейчас не хранит город или страну устройства. Nox показывает только реальные данные устройства, платформы, браузера и последней активности.
      </p>
    </div>
  );
}

function DeviceSessionCard({
  device,
  current = false,
  revoked = false,
  action,
}: {
  device: E2EEDevice;
  current?: boolean;
  revoked?: boolean;
  action?: React.ReactNode;
}) {
  const isRevoked = revoked || Boolean(device.revokedAt);
  return (
    <div className={`rounded-2xl border p-4 transition-smooth ${current ? "border-primary/25 bg-primary/10" : "border-border-subtle bg-surface"}`}>
      <div className="flex items-start gap-4">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${current ? "bg-primary text-primary-foreground" : isRevoked ? "bg-danger/10 text-danger" : "bg-foreground/5 text-foreground"}`}>
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.3} d="M9.75 17 9 20l-1 1h8l-1-1-.75-3M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-foreground">{getDeviceName(device)}</p>
            {current ? <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-[10px] font-semibold text-primary">Это устройство</span> : null}
            {isRevoked ? <span className="rounded-full bg-danger/10 px-2.5 py-0.5 text-[10px] font-semibold text-danger">Отозвано</span> : null}
          </div>
          <p className="mt-1 text-xs font-bold text-muted">{getPlatformName(device)}</p>
          <p className="mt-1 text-xs font-semibold text-muted/80">{formatDeviceActivity(device)}</p>
          <p className="mt-1 text-xs font-semibold text-muted/70">Местоположение недоступно</p>
          {device.fingerprintShort ? <p className="mt-2 break-all font-mono text-[10px] text-muted/45">{device.fingerprintShort}</p> : null}
        </div>
        {action}
      </div>
    </div>
  );
}
