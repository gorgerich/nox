"use client";

import { avatarTint } from "@/lib/avatar-tint";
import { useFocusTrap } from "@/lib/use-focus-trap";
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
import type { BuiltInFolderItem, ChatFolderItem } from "@/lib/chat-list";
import { ChatWallpaperControls, useGlobalChatAppearance } from "../chats/[chatId]/ChatAppearance";

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

type FolderChatOption = {
  id: string;
  title: string;
  subtitle: string;
};

export function ProfileContent({
  user,
  initialChatFolders,
  initialBuiltInFolders,
  folderChats,
}: {
  user: UserWithProfile;
  initialChatFolders: ChatFolderItem[];
  initialBuiltInFolders: BuiltInFolderItem[];
  folderChats: FolderChatOption[];
}) {
  const router = useRouter();

  const [activeScreen, setActiveScreen] = useState<"main" | "profile" | "devices" | "appearance" | "security" | "folders" | "data">("main");
  // Each sub-screen is a full-viewport overlay, but the profile page stays
  // mounted underneath it: without this, Tab walks straight out of the open
  // screen into the page behind it, and a screen reader reads both.
  // Escape closes back to the list, which is what the back button does.
  const profileScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "profile", () => setActiveScreen("main"));
  const devicesScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "devices", () => setActiveScreen("main"));
  const appearanceScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "appearance", () => setActiveScreen("main"));
  const securityScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "security", () => setActiveScreen("main"));
  const foldersScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "folders", () => setActiveScreen("main"));
  const dataScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "data", () => setActiveScreen("main"));

  const [displayName, setDisplayName] = useState(user.profile?.displayName || "");
  const [username, setUsername] = useState(user.username);
  const [bio, setBio] = useState(user.profile?.bio || "");
  const [avatarUrl, setAvatarUrl] = useState(user.profile?.avatarUrl || null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [chatFolders, setChatFolders] = useState(initialChatFolders);
  const [builtInFolders, setBuiltInFolders] = useState(initialBuiltInFolders);
  const [folderName, setFolderName] = useState("");
  const [folderChatIds, setFolderChatIds] = useState<Set<string>>(new Set());
  const [folderPending, setFolderPending] = useState(false);
  const [folderMessage, setFolderMessage] = useState("");
  const [showFullscreenAvatar, setShowFullscreenAvatar] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const { status: pushStatus, error: pushError, isSubscribed, subscribe, unsubscribe } = usePushNotifications();
  const { theme, setTheme, accent, setAccent } = useTheme();
  const {
    settings: globalChatAppearance,
    updateSettings: updateGlobalChatAppearance,
    resetSettings: resetGlobalChatAppearance,
  } = useGlobalChatAppearance();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);

  const [showTrustedReset, setShowTrustedReset] = useState(false);
  const trustedResetRef = useFocusTrap<HTMLDivElement>(showTrustedReset, () => setShowTrustedReset(false));
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

  const orderedBuiltInFolders = [...builtInFolders].sort((left, right) => left.order - right.order);

  async function saveFolders(nextFolders: ChatFolderItem[], nextBuiltIns: BuiltInFolderItem[], successMessage: string) {
    setFolderPending(true);
    setFolderMessage("");
    try {
      const res = await fetch("/api/chat-folders", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ folders: nextFolders, builtIns: nextBuiltIns }),
      });
      const data = (await res.json().catch(() => null)) as { folders?: ChatFolderItem[]; builtIns?: BuiltInFolderItem[]; error?: string } | null;
      if (!res.ok || !data?.folders || !data.builtIns) {
        throw new Error(data?.error || "Не удалось сохранить папки.");
      }
      setChatFolders(data.folders);
      setBuiltInFolders(data.builtIns);
      setFolderMessage(successMessage);
      router.refresh();
    } catch (error) {
      setFolderMessage(error instanceof Error ? error.message : "Не удалось сохранить папки.");
    } finally {
      setFolderPending(false);
    }
  }

  async function createFolder() {
    const name = folderName.trim();
    if (!name || folderChatIds.size === 0 || folderPending) return;

    const nextFolder: ChatFolderItem = {
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      name,
      chatIds: Array.from(folderChatIds),
      createdAt: new Date().toISOString(),
    };

    await saveFolders([...chatFolders, nextFolder], builtInFolders, "Папка создана.");
    setFolderName("");
    setFolderChatIds(new Set());
  }

  async function deleteFolder(folderId: string) {
    if (folderPending) return;
    await saveFolders(chatFolders.filter((folder) => folder.id !== folderId), builtInFolders, "Папка удалена.");
  }

  async function toggleBuiltInFolder(folderKey: BuiltInFolderItem["key"]) {
    if (folderPending) return;
    const nextBuiltIns = builtInFolders.map((folder) =>
      folder.key === folderKey ? { ...folder, visible: !folder.visible } : folder,
    );
    await saveFolders(chatFolders, nextBuiltIns, "Папки обновлены.");
  }

  async function moveBuiltInFolder(folderKey: BuiltInFolderItem["key"], direction: -1 | 1) {
    if (folderPending) return;
    const nextBuiltIns = [...orderedBuiltInFolders];
    const index = nextBuiltIns.findIndex((folder) => folder.key === folderKey);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= nextBuiltIns.length) return;
    [nextBuiltIns[index], nextBuiltIns[targetIndex]] = [nextBuiltIns[targetIndex], nextBuiltIns[index]];
    await saveFolders(
      chatFolders,
      nextBuiltIns.map((folder, nextIndex) => ({ ...folder, order: nextIndex })),
      "Порядок обновлён.",
    );
  }

  async function moveCustomFolder(folderId: string, direction: -1 | 1) {
    if (folderPending) return;
    const nextFolders = [...chatFolders];
    const index = nextFolders.findIndex((folder) => folder.id === folderId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= nextFolders.length) return;
    [nextFolders[index], nextFolders[targetIndex]] = [nextFolders[targetIndex], nextFolders[index]];
    await saveFolders(nextFolders, builtInFolders, "Порядок обновлён.");
  }

  function toggleFolderChat(chatId: string) {
    setFolderChatIds((current) => {
      const next = new Set(current);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }

  return (
    <>
      {activeScreen === "main" && (
        <div className="pb-[var(--bottom-dock-clearance)] animate-in fade-in slide-in-from-bottom-4 duration-180 safe-top">
          <section className="mt-4 flex flex-col items-center text-center">
            <div className="group relative mb-5">
              <button
                type="button"
                aria-label={fullAvatarUrl ? "Открыть фото профиля" : "Добавить фото профиля"}
                onClick={() => {
                  if (fullAvatarUrl) setShowFullscreenAvatar(true);
                  else fileInputRef.current?.click();
                }}
                disabled={pending}
                /* The same name-derived tint every other avatar uses. A plain
                   surface-muted disc was invisible against the surface behind
                   it, so the initial read as floating type. */
                className="nox-avatar-tint relative flex h-32 w-32 items-center justify-center overflow-hidden rounded-full transition-smooth active:scale-[0.96]"
                data-avatar-tint={avatarTint(displayName || username)}
              >
                {fullAvatarUrl ? (
                  <Image src={fullAvatarUrl} alt={displayName} fill className="object-cover" />
                ) : (
                  <span className="text-4xl font-semibold">
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
                type="button"
                aria-label="Изменить фото профиля"
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
                  type="button"
                  aria-label="Удалить фото профиля"
                  onClick={handleAvatarDelete}
                  className="absolute bottom-0 right-0 flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface text-destructive transition-smooth active:scale-[0.96]"
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
                label="Папки чатов"
                subtitle={`${orderedBuiltInFolders.filter((folder) => folder.visible).length + chatFolders.length} активных`}
                onClick={() => setActiveScreen("folders")}
                icon={<FoldersIcon />}
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
                   {(pushError || pushStatus === "unsupported" || pushStatus === "denied") && (
                     <p className="text-xs leading-snug text-muted">
                       {pushError
                         || (pushStatus === "unsupported"
                           ? "Недоступно в этой среде. Откройте сайт в браузере или установите приложение с экрана «Домой»."
                           : "Уведомления заблокированы в настройках браузера.")}
                     </p>
                   )}
                 </div>
                 <button
                   onClick={isSubscribed ? unsubscribe : subscribe}
                   disabled={pushStatus === "unsupported"}
                   className={`h-10 shrink-0 rounded-full px-4 text-sm font-semibold transition-smooth active:scale-[0.96] disabled:opacity-40 ${
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
        <div
          ref={profileScreenRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-screen-profile"
          className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-[var(--bottom-dock-clearance)] animate-in slide-in-from-right duration-200 safe-top"
        >
          <header className="liquid-top-chrome sticky top-0 z-50 flex min-h-14 items-center justify-between px-3 py-2">
             <button type="button" aria-label="Назад" onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 id="profile-screen-profile" className="text-base font-semibold tracking-tight">Мой профиль</h1>
             <div className="w-10" />
          </header>

          <form onSubmit={handleUpdate} className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-200">
             <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="profile-display-name" className="ml-4 text-sm font-medium text-muted">Имя</label>
                  <input
                    id="profile-display-name"
                    name="displayName"
                    autoComplete="name"
                    className="input-nox h-14"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Ваше имя"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="profile-username" className="ml-4 text-sm font-medium text-muted">Username</label>
                  <input
                    id="profile-username"
                    name="username"
                    autoComplete="username"
                    className="input-nox h-14"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="username"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="profile-bio" className="ml-4 text-sm font-medium text-muted">О себе</label>
                  <textarea
                    id="profile-bio"
                    name="bio"
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
        <div
          ref={devicesScreenRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-screen-devices"
          className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-[var(--bottom-dock-clearance)] animate-in slide-in-from-right duration-200 safe-top"
        >
          <header className="liquid-top-chrome sticky top-0 z-50 flex min-h-14 items-center justify-between px-3 py-2">
             <button type="button" aria-label="Назад" onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 id="profile-screen-devices" className="text-base font-semibold tracking-tight">Устройства</h1>
             <div className="w-10" />
          </header>

          <div className="animate-in fade-in zoom-in-95 duration-200">
            <E2EEDevicesPanel userId={user.id} />
          </div>
        </div>
      )}

      {activeScreen === "appearance" && (
        <div
          ref={appearanceScreenRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-screen-appearance"
          className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-[var(--bottom-dock-clearance)] animate-in slide-in-from-right duration-200 safe-top"
        >
          <header className="liquid-top-chrome sticky top-0 z-50 flex min-h-14 items-center justify-between px-3 py-2">
             <button type="button" aria-label="Назад" onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 id="profile-screen-appearance" className="text-base font-semibold tracking-tight">Оформление</h1>
             <div className="w-10" />
          </header>

          <div className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-200">
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
                    className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-smooth active:scale-[0.96] ${
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

            <section className="space-y-3">
              <div className="flex items-start justify-between gap-4 px-1">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Фон чатов</h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted">Настройка применяется ко всем чатам по умолчанию.</p>
                </div>
                <button
                  type="button"
                  onClick={resetGlobalChatAppearance}
                  className="fluid-hit shrink-0 rounded-full px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10"
                >
                  Сбросить
                </button>
              </div>
              <ChatWallpaperControls settings={globalChatAppearance} onUpdate={updateGlobalChatAppearance} />
            </section>
          </div>
        </div>
      )}

      {activeScreen === "security" && (
        <div
          ref={securityScreenRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-screen-security"
          className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-[var(--bottom-dock-clearance)] animate-in slide-in-from-right duration-200 safe-top"
        >
          <header className="liquid-top-chrome sticky top-0 z-50 flex min-h-14 items-center justify-between px-3 py-2">
             <button type="button" aria-label="Назад" onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 id="profile-screen-security" className="text-base font-semibold tracking-tight">Безопасность</h1>
             <div className="w-10" />
          </header>

          <div className="p-6 space-y-8 animate-in fade-in zoom-in-95 duration-200">
            <form onSubmit={handlePasswordChange} className="space-y-6">
               <div className="space-y-4">
                  <div className="space-y-2">
                    <label htmlFor="profile-current-password" className="ml-4 text-sm font-medium text-muted">Текущий пароль</label>
                    <input
                      id="profile-current-password"
                      name="currentPassword"
                      autoComplete="current-password"
                      className="input-nox h-14"
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Введите текущий пароль"
                    />
                  </div>

                  <div className="space-y-2">
                    <label htmlFor="profile-new-password" className="ml-4 text-sm font-medium text-muted">Новый пароль</label>
                    <input
                      id="profile-new-password"
                      name="newPassword"
                      autoComplete="new-password"
                      className="input-nox h-14"
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Новый пароль (минимум 8 символов)"
                    />
                  </div>
               </div>

               {passwordError && <p className="py-1 text-center text-sm font-semibold text-destructive">{passwordError}</p>}
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

            <div className="mt-12 rounded-2xl border border-warning/20 bg-warning/10 p-5">
               <p className="mb-4 text-center text-sm font-medium leading-relaxed text-warning">
                 Nox не хранит ключи от ваших сообщений. После сброса пароля на новом устройстве старые сообщения могут быть недоступны без доверенного устройства.
               </p>
               <Link href="/forgot-password" className="flex h-12 w-full items-center justify-center rounded-full bg-warning text-sm font-semibold text-neutral-950 transition-smooth active:scale-[0.96]">
                 Сбросить пароль полностью
               </Link>
            </div>
          </div>
        </div>
      )}

      {activeScreen === "folders" && (
        <div
          ref={foldersScreenRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-screen-folders"
          className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-[var(--bottom-dock-clearance)] animate-in slide-in-from-right duration-200 safe-top"
        >
          <header className="liquid-top-chrome sticky top-0 z-50 flex min-h-14 items-center justify-between px-3 py-2">
             <button type="button" aria-label="Назад" onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 id="profile-screen-folders" className="text-base font-semibold tracking-tight">Папки чатов</h1>
             <div className="w-10" />
          </header>

          <div className="space-y-7 p-6 animate-in fade-in zoom-in-95 duration-200">
            <section className="rounded-2xl border border-border-subtle bg-surface p-4">
              <h2 className="text-base font-semibold tracking-tight text-foreground">Новая папка</h2>
              <p className="mt-1 text-sm font-medium leading-relaxed text-muted">
                Папка появится рядом с системными разделами в выбранном вами порядке.
              </p>

              <div className="mt-4 space-y-3">
                <input
                  className="input-nox h-12 rounded-full"
                  value={folderName}
                  onChange={(event) => setFolderName(event.target.value)}
                  placeholder="Название папки"
                  aria-label="Название папки"
                  maxLength={28}
                />

                <div className="max-h-72 overflow-y-auto rounded-2xl border border-border-subtle/60 bg-background/50">
                  {folderChats.length > 0 ? folderChats.map((chat) => {
                    const selected = folderChatIds.has(chat.id);
                    return (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => toggleFolderChat(chat.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-smooth hover:bg-foreground/5 active:scale-[0.96]"
                      >
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-smooth ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border-subtle"}`}>
                          {selected ? (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                          ) : null}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-foreground">{chat.title}</span>
                          <span className="mt-0.5 block truncate text-xs font-medium text-muted">{chat.subtitle}</span>
                        </span>
                      </button>
                    );
                  }) : (
                    <p className="px-4 py-5 text-sm font-semibold text-muted">Сначала создайте чат.</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => void createFolder()}
                  disabled={folderPending || !folderName.trim() || folderChatIds.size === 0 || chatFolders.length >= 12}
                  className="h-12 w-full rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
                >
                  {folderPending ? "Сохранение..." : "Создать папку"}
                </button>
              </div>
            </section>

            <section className="space-y-3">
              <div className="px-1">
                <h2 className="text-sm font-semibold text-muted">Системные папки</h2>
              </div>

              <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
                {orderedBuiltInFolders.map((folder, index) => (
                  <div key={folder.key}>
                    {index > 0 ? <div className="mx-4 h-px bg-border-subtle/40" /> : null}
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${folder.visible ? "bg-primary/10 text-primary" : "bg-foreground/5 text-muted"}`}>
                        <FoldersIcon />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{folder.label}</p>
                        <p className="mt-0.5 truncate text-xs font-medium text-muted">
                          {folder.visible ? "Показывается в чатах" : "Скрыта из списка чатов"}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void moveBuiltInFolder(folder.key, -1)}
                          disabled={folderPending || index === 0}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-muted transition-smooth active:scale-[0.96] disabled:opacity-35"
                          aria-label="Выше"
                        >
                          <ArrowUpIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveBuiltInFolder(folder.key, 1)}
                          disabled={folderPending || index === orderedBuiltInFolders.length - 1}
                          className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-muted transition-smooth active:scale-[0.96] disabled:opacity-35"
                          aria-label="Ниже"
                        >
                          <ArrowDownIcon />
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleBuiltInFolder(folder.key)}
                        disabled={folderPending}
                        className={`rounded-full px-3 py-2 text-xs font-semibold transition-smooth active:scale-[0.96] disabled:opacity-45 ${
                          folder.visible ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"
                        }`}
                      >
                        {folder.visible ? "Скрыть" : "Вернуть"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <div className="px-1">
                <h2 className="text-sm font-semibold text-muted">Мои папки</h2>
              </div>

              {chatFolders.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
                  {chatFolders.map((folder, index) => (
                    <div key={folder.id}>
                      {index > 0 ? <div className="mx-4 h-px bg-border-subtle/40" /> : null}
                      <div className="flex items-center gap-3 px-4 py-3.5">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <FoldersIcon />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">{folder.name}</p>
                          <p className="mt-0.5 truncate text-xs font-medium text-muted">
                            {folder.chatIds.length} {folder.chatIds.length === 1 ? "чат" : folder.chatIds.length > 1 && folder.chatIds.length < 5 ? "чата" : "чатов"}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void moveCustomFolder(folder.id, -1)}
                            disabled={folderPending || index === 0}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-muted transition-smooth active:scale-[0.96] disabled:opacity-35"
                            aria-label="Выше"
                          >
                            <ArrowUpIcon />
                          </button>
                          <button
                            type="button"
                            onClick={() => void moveCustomFolder(folder.id, 1)}
                            disabled={folderPending || index === chatFolders.length - 1}
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-muted text-muted transition-smooth active:scale-[0.96] disabled:opacity-35"
                            aria-label="Ниже"
                          >
                            <ArrowDownIcon />
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deleteFolder(folder.id)}
                          disabled={folderPending}
                          className="rounded-full bg-danger/10 px-3 py-2 text-xs font-semibold text-danger transition-smooth active:scale-[0.96] disabled:opacity-45"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-border-subtle bg-surface p-5 text-sm font-semibold text-muted">
                  Папок пока нет.
                </div>
              )}

              {folderMessage ? (
                <p className="px-1 text-center text-sm font-semibold text-primary">{folderMessage}</p>
              ) : null}
            </section>
          </div>
        </div>
      )}

      {activeScreen === "data" && (
        <div
          ref={dataScreenRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-screen-data"
          className="fixed inset-0 z-[1100] bg-background overflow-y-auto pb-[var(--bottom-dock-clearance)] animate-in slide-in-from-right duration-200 safe-top"
        >
          <header className="liquid-top-chrome sticky top-0 z-50 flex min-h-14 items-center justify-between px-3 py-2">
             <button type="button" aria-label="Назад" onClick={() => setActiveScreen("main")} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]">
               <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
             </button>
             <h1 id="profile-screen-data" className="text-base font-semibold tracking-tight">Данные и кэш</h1>
             <div className="w-10" />
          </header>

          <div className="p-6 animate-in fade-in zoom-in-95 duration-200">
            <CacheSettings />
          </div>
        </div>
      )}

      {/* Trusted Reset Modal */}
      {showTrustedReset && (
        <div
          ref={trustedResetRef}
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/55 p-6 animate-in fade-in duration-200"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trusted-reset-title"
          onClick={() => setShowTrustedReset(false)}
        >
          <div
            className="premium-glass relative w-full max-w-sm rounded-[1.75rem] p-5"
            onClick={e => e.stopPropagation()}
          >
            <h2 id="trusted-reset-title" className="mb-2 text-center text-xl font-semibold">Сброс пароля</h2>
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
                aria-label="Новый пароль"
                required
                minLength={8}
              />

              {trustedError && <p className="text-center text-sm font-semibold text-destructive">{trustedError}</p>}
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
function FoldersIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M3 7.5A2.5 2.5 0 015.5 5h4.2c.55 0 1.08.22 1.47.61l1.22 1.22c.39.39.92.61 1.47.61h4.64A2.5 2.5 0 0121 9.94V16.5A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9Z" /></svg>; }
function DataIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3Zm0 0v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" /></svg>; }
function ArrowUpIcon() { return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="m6 15 6-6 6 6" /></svg>; }
function ArrowDownIcon() { return <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="m6 9 6 6 6-6" /></svg>; }

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
      {error ? <p className="rounded-2xl bg-destructive/10 px-4 py-3 text-xs font-bold text-destructive text-center">{error}</p> : null}

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
          className="w-full rounded-2xl border border-danger/15 bg-danger/10 px-5 py-4 text-left transition-smooth active:scale-[0.96] disabled:opacity-45"
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
