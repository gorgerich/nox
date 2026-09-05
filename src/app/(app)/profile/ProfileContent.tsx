"use client";

import { avatarTint } from "@/lib/avatar-tint";
import { RecoveryKeyPanel } from "./RecoveryKeyPanel";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { ACCENT_OPTIONS, useTheme } from "@/components/ThemeProvider";
import Image from "next/image";
import Link from "next/link";
import { AvatarCropModal } from "./AvatarCropModal";
import { AvatarViewer } from "./AvatarViewer";
import { CacheSettings } from "./CacheSettings";
import { DevicesPanel } from "./DevicesPanel";
import { FoldersPanel, type FolderChatOption } from "./FoldersPanel";
import { NotificationsPanel } from "./NotificationsPanel";
import { normalizeAvatarUrl } from "@/lib/media-url";
import type { BuiltInFolderItem, ChatFolderItem } from "@/lib/chat-list";
import { CHAT_WALLPAPERS, ChatWallpaperControls, useGlobalChatAppearance } from "../chats/[chatId]/ChatAppearance";
import { SettingsScreen } from "@/components/settings/SettingsScreen";
import { UiScaleSlider } from "@/components/settings/UiScaleSlider";
import { SettingsBlock, SettingsGroup, SettingsStack } from "@/components/settings/SettingsGroup";
import {
  SettingsActionRow,
  SettingsInputRow,
  SettingsNavRow,
  SettingsNote,
  SettingsPrimaryButton,
  SettingsSegmented,
} from "@/components/settings/SettingsRow";
import { ConfirmSheet } from "@/components/settings/ConfirmSheet";

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

type Screen =
  | "main"
  | "profile"
  | "notifications"
  | "devices"
  | "appearance"
  | "appearance-wallpaper"
  | "security"
  | "security-password"
  | "security-recovery"
  | "folders"
  | "data";

const THEME_OPTIONS = [
  { value: "system", label: "Системная" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
] as const;

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

  const [activeScreen, setActiveScreen] = useState<Screen>("main");
  // Each sub-screen is a full-viewport overlay, but the profile page stays
  // mounted underneath it: without this, Tab walks straight out of the open
  // screen into the page behind it, and a screen reader reads both.
  // Escape closes back to the list, which is what the back button does.
  const profileScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "profile", () => setActiveScreen("main"));
  const notificationsScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "notifications", () => setActiveScreen("main"));
  const devicesScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "devices", () => setActiveScreen("main"));
  const appearanceScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "appearance", () => setActiveScreen("main"));
  const wallpaperScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "appearance-wallpaper", () => setActiveScreen("appearance"));
  const securityScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "security", () => setActiveScreen("main"));
  const passwordScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "security-password", () => setActiveScreen("security"));
  const recoveryScreenRef = useFocusTrap<HTMLDivElement>(activeScreen === "security-recovery", () => setActiveScreen("security"));
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
  const [folderPending, setFolderPending] = useState(false);
  const [folderMessage, setFolderMessage] = useState("");
  const [showFullscreenAvatar, setShowFullscreenAvatar] = useState(false);
  const [cropImage, setCropImage] = useState<string | null>(null);
  const [confirmAvatarDelete, setConfirmAvatarDelete] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";
  const { status: pushStatus, error: pushError, isSubscribed, subscribe, unsubscribe } = usePushNotifications();
  const { theme, setTheme, accent, setAccent, uiScale, setUiScale } = useTheme();
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

  const profileDirty =
    displayName !== (user.profile?.displayName || "") ||
    username !== user.username ||
    bio !== (user.profile?.bio || "");

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

      setTrustedMessage("Пароль изменён.");
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

      setPasswordMessage("Пароль изменён.");
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
    setConfirmAvatarDelete(false);
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
    setConfirmLogout(false);
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch (error) {
      console.error("Logout failed", error);
      setPending(false);
    }
  }

  const saveFolders = useCallback(
    async (nextFolders: ChatFolderItem[], nextBuiltIns: BuiltInFolderItem[], successMessage: string) => {
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
    },
    [router],
  );

  const currentWallpaperLabel =
    (CHAT_WALLPAPERS.find((item) => item.id === globalChatAppearance.wallpaper) ?? CHAT_WALLPAPERS[0]).label;

  const visibleFolderCount =
    builtInFolders.filter((folder) => folder.visible).length + chatFolders.length;

  const pushValue =
    pushStatus === "unsupported"
      ? "Недоступно"
      : pushStatus === "denied"
        ? "Запрещены"
        : isSubscribed
          ? "Вкл."
          : "Выкл.";

  return (
    <>
      {activeScreen === "main" && (
        <div className="pb-[var(--bottom-dock-clearance)] safe-top">
          <section className="mt-1 flex flex-col items-center text-center">
            <div className="group relative mb-3">
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
                className="nox-avatar-tint relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full transition-smooth active:scale-[0.96]"
                data-avatar-tint={avatarTint(displayName || username)}
              >
                {fullAvatarUrl ? (
                  <Image src={fullAvatarUrl} alt={displayName} fill className="object-cover" />
                ) : (
                  <span className="text-3xl font-semibold">
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
                className="absolute bottom-0 right-0 z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 border-background bg-surface-secondary text-primary transition-smooth active:scale-[0.96]"
                title="Изменить фото"
              >
                <svg className="h-[19px] w-[19px]" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M9.4 4h5.2l1.2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.2l1.2-2Zm2.6 5.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
                </svg>
              </button>

            </div>

            <h2 className="max-w-[22rem] truncate px-4 text-2xl font-semibold tracking-tight text-foreground">{displayName || username}</h2>
            <p className="mt-0.5 text-sm text-primary">@{username}</p>
          </section>

          {/* The main list keeps its original presentation: one bordered card,
              icon + label + subtitle rows, hairline dividers, and the same
              pressed state. Only the destinations changed — Уведомления is now
              a screen of its own rather than an inline toggle. */}
          <div className="mt-4 space-y-3 px-4">
            <section className="flex flex-col overflow-hidden rounded-[0.875rem] bg-surface">
              <SettingsMenuButton
                label="Мой профиль"
                subtitle="Имя, username, о себе"
                onClick={() => setActiveScreen("profile")}
                icon={<ProfileIcon />}
              />
              <div className="ml-[60px] h-px bg-border-subtle/70" />
              <SettingsMenuButton
                label="Уведомления"
                subtitle={pushValue}
                onClick={() => setActiveScreen("notifications")}
                icon={<BellIcon />}
              />
              <div className="ml-[60px] h-px bg-border-subtle/70" />
              <SettingsMenuButton
                label="Устройства"
                subtitle="Активные сеансы"
                onClick={() => setActiveScreen("devices")}
                icon={<DevicesIcon />}
              />
              <div className="ml-[60px] h-px bg-border-subtle/70" />
              <SettingsMenuButton
                label="Оформление"
                subtitle="Тема и акцент"
                onClick={() => setActiveScreen("appearance")}
                icon={<AppearanceIcon />}
              />
              <div className="ml-[60px] h-px bg-border-subtle/70" />
              <SettingsMenuButton
                label="Безопасность"
                subtitle="Пароль и восстановление"
                onClick={() => setActiveScreen("security")}
                icon={<SecurityIcon />}
              />
              <div className="ml-[60px] h-px bg-border-subtle/70" />
              <SettingsMenuButton
                label="Папки чатов"
                subtitle={`${visibleFolderCount} активных`}
                onClick={() => setActiveScreen("folders")}
                icon={<FoldersIcon />}
              />
              <div className="ml-[60px] h-px bg-border-subtle/70" />
              <SettingsMenuButton
                label="Данные и кэш"
                subtitle="Хранилище и кэш"
                onClick={() => setActiveScreen("data")}
                icon={<DataIcon />}
              />
            </section>

            {isAdmin && (
              <section className="overflow-hidden rounded-[0.875rem] bg-surface">
                <Link
                  href="/admin"
                  className="group flex min-h-[52px] w-full items-center gap-3 px-4 py-2 transition-colors hover:bg-foreground/5 active:bg-foreground/10"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center text-primary">
                    <ShieldIcon />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground">Админ-панель</span>
                  <span className="shrink-0 text-muted opacity-50 transition-opacity group-hover:opacity-100">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
                  </span>
                </Link>
              </section>
            )}

            <section className="overflow-hidden rounded-[0.875rem] bg-surface">
              <button
                type="button"
                onClick={() => setConfirmLogout(true)}
                disabled={pending}
                className="flex min-h-[52px] w-full items-center gap-3 px-4 py-2 transition-colors hover:bg-danger/5 active:bg-danger/10 disabled:opacity-50"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center text-danger">
                  <LogoutIcon />
                </span>
                <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-danger">
                  {pending ? "Выход..." : "Выйти из аккаунта"}
                </span>
              </button>
            </section>
          </div>
        </div>
      )}

      {activeScreen === "profile" && (
        <SettingsScreen
          title="Мой профиль"
          titleId="profile-screen-profile"
          onBack={() => setActiveScreen("main")}
          containerRef={profileScreenRef}
        >
          <form onSubmit={handleUpdate}>
            <SettingsStack>
              <SettingsGroup label="Аккаунт" footer="Username виден собеседникам и используется для поиска.">
                <SettingsInputRow
                  id="profile-display-name"
                  label="Имя"
                  autoComplete="name"
                  value={displayName}
                  onChange={setDisplayName}
                  placeholder="Ваше имя"
                  maxLength={50}
                />
                <SettingsInputRow
                  id="profile-username"
                  label="Username"
                  autoComplete="username"
                  value={username}
                  onChange={setUsername}
                  placeholder="username"
                  maxLength={32}
                  prefix="@"
                />
              </SettingsGroup>

              <SettingsGroup label="О себе" footer={bio.length > 150 ? `${bio.length} / 200` : undefined}>
                <SettingsInputRow
                  id="profile-bio"
                  label="О себе"
                  hideLabel
                  value={bio}
                  onChange={setBio}
                  placeholder="Пара слов о вас"
                  maxLength={200}
                  multiline
                />
              </SettingsGroup>

              {/* The one primary action on this screen, and only once there is
                  something to save. */}
              {profileDirty || pending ? (
                <SettingsBlock>
                  <SettingsPrimaryButton type="submit" disabled={pending}>
                    {pending ? "Сохранение…" : "Сохранить"}
                  </SettingsPrimaryButton>
                </SettingsBlock>
              ) : null}

              {avatarUrl ? (
                <SettingsGroup>
                  <SettingsActionRow
                    title="Удалить фото профиля"
                    tone="danger"
                    disabled={pending}
                    onClick={() => setConfirmAvatarDelete(true)}
                  />
                </SettingsGroup>
              ) : null}

              {message ? (
                <p role="status" className="px-5 text-center text-[0.8125rem] text-primary">{message}</p>
              ) : null}
            </SettingsStack>
          </form>
        </SettingsScreen>
      )}

      {activeScreen === "notifications" && (
        <SettingsScreen
          title="Уведомления"
          titleId="profile-screen-notifications"
          onBack={() => setActiveScreen("main")}
          containerRef={notificationsScreenRef}
        >
          <NotificationsPanel
            status={pushStatus}
            error={pushError}
            isSubscribed={isSubscribed}
            onSubscribe={subscribe}
            onUnsubscribe={unsubscribe}
          />
        </SettingsScreen>
      )}

      {activeScreen === "devices" && (
        <SettingsScreen
          title="Устройства"
          titleId="profile-screen-devices"
          onBack={() => setActiveScreen("main")}
          containerRef={devicesScreenRef}
        >
          <DevicesPanel userId={user.id} />
        </SettingsScreen>
      )}

      {activeScreen === "appearance" && (
        <SettingsScreen
          title="Оформление"
          titleId="profile-screen-appearance"
          onBack={() => setActiveScreen("main")}
          containerRef={appearanceScreenRef}
        >
          <SettingsStack>
            <SettingsBlock label="Тема" footer="Системная тема следует настройке вашего телефона.">
              <SettingsSegmented
                label="Тема приложения"
                value={theme}
                options={THEME_OPTIONS}
                onChange={setTheme}
              />
            </SettingsBlock>

            <SettingsBlock label="Акцент" footer="Акцент красит активные состояния и главные действия. Фон и карточки остаются нейтральными.">
              <div role="radiogroup" aria-label="Акцентный цвет" className="flex flex-wrap gap-3 rounded-2xl bg-surface px-4 py-4">
                {ACCENT_OPTIONS.map((option) => {
                  const selected = accent === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-label={option.label}
                      title={option.label}
                      onClick={() => setAccent(option.value)}
                      className={`fast-tap flex h-11 w-11 items-center justify-center rounded-full transition-smooth ${
                        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-surface" : ""
                      }`}
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-full outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
                        style={{ backgroundColor: option.swatch }}
                      >
                        {selected ? (
                          <svg className="h-4 w-4 text-white drop-shadow" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </SettingsBlock>

            <SettingsBlock
              label="Размер интерфейса"
              footer="Изменяет размер текста, значков и элементов интерфейса."
            >
              <UiScaleSlider value={uiScale} onChange={setUiScale} />
            </SettingsBlock>

            {/* The wallpaper editor is a configurator — preview, four swatches
                and three sliders. It belongs behind a row, not in front of the
                two settings most people came here to change. */}
            <SettingsGroup label="Чаты" footer="Применяется ко всем чатам по умолчанию.">
              <SettingsNavRow
                title="Фон чатов"
                value={currentWallpaperLabel}
                onClick={() => setActiveScreen("appearance-wallpaper")}
              />
            </SettingsGroup>
          </SettingsStack>
        </SettingsScreen>
      )}

      {activeScreen === "appearance-wallpaper" && (
        <SettingsScreen
          title="Фон чатов"
          titleId="profile-screen-wallpaper"
          onBack={() => setActiveScreen("appearance")}
          containerRef={wallpaperScreenRef}
        >
          <SettingsStack>
            <SettingsBlock>
              <ChatWallpaperControls
                settings={globalChatAppearance}
                onUpdate={updateGlobalChatAppearance}
                hideWallpaperHeading
              />
            </SettingsBlock>

            <SettingsGroup>
              <SettingsActionRow title="Вернуть оформление по умолчанию" onClick={resetGlobalChatAppearance} />
            </SettingsGroup>
          </SettingsStack>
        </SettingsScreen>
      )}

      {activeScreen === "security" && (
        <SettingsScreen
          title="Безопасность"
          titleId="profile-screen-security"
          onBack={() => setActiveScreen("main")}
          containerRef={securityScreenRef}
        >
          <SettingsStack>
            <SettingsGroup label="Защита аккаунта">
              <SettingsNavRow
                title="Пароль"
                value="Установлен"
                onClick={() => setActiveScreen("security-password")}
              />
              <SettingsNavRow
                title="Ключ восстановления"
                onClick={() => setActiveScreen("security-recovery")}
              />
            </SettingsGroup>

            <SettingsGroup label="Шифрование" footer="Ключи хранятся только на ваших устройствах. Сервер не может прочитать переписку.">
              <SettingsNavRow
                title="Устройства и ключи"
                subtitle="Активные сеансы этого аккаунта"
                onClick={() => setActiveScreen("devices")}
              />
            </SettingsGroup>

            <SettingsGroup
              label="Опасные действия"
              footer={
                <SettingsNote tone="warning">
                  На новом устройстве старая переписка откроется только по ключу восстановления.
                </SettingsNote>
              }
            >
              <SettingsActionRow
                title="Сбросить пароль полностью"
                tone="danger"
                onClick={() => router.push("/forgot-password")}
              />
            </SettingsGroup>
          </SettingsStack>
        </SettingsScreen>
      )}

      {activeScreen === "security-password" && (
        <SettingsScreen
          title="Пароль"
          titleId="profile-screen-password"
          onBack={() => setActiveScreen("security")}
          containerRef={passwordScreenRef}
        >
          <form onSubmit={handlePasswordChange}>
            <SettingsStack>
              <SettingsGroup label="Смена пароля" footer="Не короче 8 символов.">
                <SettingsInputRow
                  id="profile-current-password"
                  label="Текущий"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={setCurrentPassword}
                  placeholder="Текущий пароль"
                />
                <SettingsInputRow
                  id="profile-new-password"
                  label="Новый"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={setNewPassword}
                  placeholder="Новый пароль"
                />
              </SettingsGroup>

              <SettingsBlock>
                <SettingsPrimaryButton
                  type="submit"
                  disabled={passwordPending || !currentPassword || newPassword.length < 8}
                >
                  {passwordPending ? "Сохранение…" : "Изменить пароль"}
                </SettingsPrimaryButton>
              </SettingsBlock>

              {passwordError ? (
                <p role="alert" className="px-5 text-center text-[0.8125rem] text-danger">{passwordError}</p>
              ) : null}
              {passwordMessage ? (
                <p role="status" className="px-5 text-center text-[0.8125rem] text-success">{passwordMessage}</p>
              ) : null}

              <SettingsGroup footer="Это устройство уже авторизовано, поэтому пароль можно сменить без старого — переписка на нём останется доступна.">
                <SettingsActionRow
                  title="Не помню текущий пароль"
                  onClick={() => setShowTrustedReset(true)}
                />
              </SettingsGroup>
            </SettingsStack>
          </form>
        </SettingsScreen>
      )}

      {activeScreen === "security-recovery" && (
        <SettingsScreen
          title="Восстановление"
          titleId="profile-screen-recovery"
          onBack={() => setActiveScreen("security")}
          containerRef={recoveryScreenRef}
        >
          <RecoveryKeyPanel userId={user.id} />
        </SettingsScreen>
      )}

      {activeScreen === "folders" && (
        <SettingsScreen
          title="Папки чатов"
          titleId="profile-screen-folders"
          onBack={() => setActiveScreen("main")}
          containerRef={foldersScreenRef}
        >
          <FoldersPanel
            chatFolders={chatFolders}
            builtInFolders={builtInFolders}
            folderChats={folderChats}
            pending={folderPending}
            message={folderMessage}
            onSave={saveFolders}
          />
        </SettingsScreen>
      )}

      {activeScreen === "data" && (
        <SettingsScreen
          title="Данные и кэш"
          titleId="profile-screen-data"
          onBack={() => setActiveScreen("main")}
          containerRef={dataScreenRef}
        >
          <CacheSettings />
        </SettingsScreen>
      )}

      {showTrustedReset && (
        <div
          className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/45 p-3 animate-in fade-in duration-150"
          onClick={() => setShowTrustedReset(false)}
        >
          <div
            ref={trustedResetRef}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-surface-elevated pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom-4 duration-200"
            role="dialog"
            aria-modal="true"
            aria-labelledby="trusted-reset-title"
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleTrustedReset}>
              <div className="px-5 pb-4 pt-5 text-center">
                <h2 id="trusted-reset-title" className="text-[1.0625rem] font-semibold text-foreground">
                  Новый пароль
                </h2>
                <p className="mt-1 text-[0.8125rem] leading-snug text-muted">
                  Это устройство авторизовано, поэтому переписка на нём останется доступна.
                </p>
              </div>
              <div className="h-px bg-border-subtle" />
              <div className="px-4 py-2">
                <input
                  className="h-12 w-full bg-transparent text-[1.0625rem] text-foreground outline-none placeholder:text-muted/60"
                  type="password"
                  autoComplete="new-password"
                  value={trustedNewPassword}
                  onChange={(e) => setTrustedNewPassword(e.target.value)}
                  placeholder="Не короче 8 символов"
                  aria-label="Новый пароль"
                  required
                  minLength={8}
                />
              </div>
              {trustedError ? (
                <p role="alert" className="px-5 pb-2 text-center text-[0.8125rem] text-danger">{trustedError}</p>
              ) : null}
              {trustedMessage ? (
                <p role="status" className="px-5 pb-2 text-center text-[0.8125rem] text-success">{trustedMessage}</p>
              ) : null}
              <div className="h-px bg-border-subtle" />
              <button
                type="submit"
                disabled={trustedPending || trustedNewPassword.length < 8}
                className="h-[54px] w-full text-[1.0625rem] font-semibold text-primary transition-smooth hover:bg-surface-hover active:bg-surface-hover disabled:opacity-40"
              >
                {trustedPending ? "Подождите…" : "Сохранить"}
              </button>
              <div className="h-px bg-border-subtle" />
              <button
                type="button"
                onClick={() => setShowTrustedReset(false)}
                className="h-[54px] w-full text-[1.0625rem] text-muted transition-smooth hover:bg-surface-hover active:bg-surface-hover"
              >
                Отмена
              </button>
            </form>
          </div>
        </div>
      )}

      <ConfirmSheet
        open={confirmAvatarDelete}
        title="Удалить фото профиля?"
        confirmLabel="Удалить фото"
        busy={pending}
        onConfirm={() => void handleAvatarDelete()}
        onCancel={() => setConfirmAvatarDelete(false)}
      />

      <ConfirmSheet
        open={confirmLogout}
        title="Выйти из аккаунта?"
        body="Переписка на этом устройстве останется, но потребуется вход заново."
        confirmLabel="Выйти"
        busy={pending}
        onConfirm={() => void handleLogout()}
        onCancel={() => setConfirmLogout(false)}
      />

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

function SettingsMenuButton({ label, subtitle, icon, onClick }: { label: string; subtitle: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex min-h-[52px] w-full items-center gap-3 px-4 py-2 transition-colors hover:bg-foreground/5 active:bg-foreground/10">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center text-primary">
        {icon}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 truncate text-xs font-normal text-muted">{subtitle}</p>
      </div>
      <div className="shrink-0 text-muted opacity-50 transition-opacity group-hover:opacity-100">
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" /></svg>
      </div>
    </button>
  );
}

function ShieldIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l7.5 3v5.7c0 4.4-3.1 8.5-7.5 9.8-4.4-1.3-7.5-5.4-7.5-9.8V6L12 3Z" /></svg>; }
function LogoutIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17l5-5-5-5m5 5H9M13 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" /></svg>; }

function ProfileIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>; }
function BellIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9" /></svg>; }
function DevicesIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>; }
function AppearanceIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.364-6.364-2.121 2.121M7.757 16.243l-2.121 2.121m12.728 0-2.121-2.121M7.757 7.757 5.636 5.636M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>; }
function SecurityIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>; }
function FoldersIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7.5A2.5 2.5 0 015.5 5h4.2c.55 0 1.08.22 1.47.61l1.22 1.22c.39.39.92.61 1.47.61h4.64A2.5 2.5 0 0121 9.94V16.5A2.5 2.5 0 0118.5 19h-13A2.5 2.5 0 013 16.5v-9Z" /></svg>; }
function DataIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3-3.582 3-8 3-8-1.343-8-3Zm0 0v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5" /></svg>; }
