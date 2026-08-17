"use client";

import { avatarTint } from "@/lib/avatar-tint";
import { useFocusTrap } from "@/lib/use-focus-trap";
import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAudioCall } from "../../../calls/CallProvider";
import { usePresence } from "@/hooks/usePresence";
import { E2EEContactDevices } from "./E2EEContactDevices";
import { ConfirmSheet } from "@/components/settings/ConfirmSheet";
import { AvatarViewer } from "../../../profile/AvatarViewer";
import { getLocalDeviceId, registerCurrentDevice } from "@/lib/e2ee/keys";
import { clearCachedMessagesForChat, clearPersistedChatMessagesForChat } from "@/lib/e2ee/indexed-db";
import { decryptMediaBlob } from "@/lib/e2ee/media";
import { normalizeAvatarUrl } from "@/lib/media-url";
import { clearChatCache } from "@/lib/chat-cache";

interface PartnerProfileProps {
  chatId: string;
  currentUserId: string;
  partnerUser: {
    id: string;
    username: string;
    lastSeenAt: string | null;
    isOnline: boolean;
    displayName: string;
    avatarUrl?: string | null;
    bio?: string | null;
  };
  initialSettings: {
    nickname: string | null;
    isBlocked: boolean;
    mutedUntil: string | null;
  };
}

interface PhotoItem {
  id: string;
  url: string;
  type: "IMAGE" | "VIDEO";
  createdAt: string;
  mimeType?: string;
  senderUserId?: string;
  fileIv?: string | null;
  isEncrypted?: boolean;
  mediaKeyEnvelopes?: {
    recipientUserId: string;
    recipientDeviceId: string;
    senderDeviceId: string;
    encryptedMediaKey: string;
    iv: string;
    salt: string | null;
    algorithm: string;
    encryptionVersion: number;
  }[];
}
interface AudioItem { id: string; url: string; fileName: string; createdAt: string }
interface FileItem { id: string; fileName: string; size: number; createdAt: string }
interface LinkItem { url: string; createdAt: string }

interface SharedMedia {
  photos: PhotoItem[];
  audio: AudioItem[];
  files: FileItem[];
  links: LinkItem[];
}

export function PartnerProfileContent({ chatId, currentUserId, partnerUser, initialSettings }: PartnerProfileProps) {
  const router = useRouter();
  const { startCall } = useAudioCall();
  const [settings, setSettings] = useState(initialSettings);
  const [activeTab, setActiveSection] = useState<"media" | "files" | "links">("media");
  const [shared, setShared] = useState<SharedMedia | null>(null);
  const [loadingShared, setLoadingShared] = useState(true);
  const [sharedError, setSharedError] = useState(false);
  const [newName, setNewName] = useState(settings.nickname || partnerUser.displayName);
  const [showAvatarViewer, setShowAvatarViewer] = useState(false);
  const [isEditSheetOpen, setIsEditSheetOpen] = useState(false);
  const [isEncryptionOpen, setIsEncryptionOpen] = useState(false);
  const editSheetRef = useFocusTrap<HTMLDivElement>(isEditSheetOpen, () => setIsEditSheetOpen(false));
  const encryptionRef = useFocusTrap<HTMLDivElement>(isEncryptionOpen, () => setIsEncryptionOpen(false));
  const [isBusy, setIsBusy] = useState(false);

  const presence = usePresence({
    userId: partnerUser.id,
    initialLastSeenAt: partnerUser.lastSeenAt,
    initialIsOnline: partnerUser.isOnline,
  });

  useEffect(() => {
    let cancelled = false;
    // A failed request used to land on the same screen as an empty one: the
    // catch only cleared the loading flag, so "Ничего не найдено" was shown
    // for a chat that may well have had media in it. Failing and being empty
    // are different things and the user can act on only one of them.
    fetch(`/api/chats/${chatId}/shared`)
      .then(res => {
        if (!res.ok) throw new Error(`shared media: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (cancelled) return;
        setShared(data);
        // Cleared here rather than at the top of the effect: a synchronous
        // write in the effect body cascades a render before the fetch has even
        // started, and this says the same thing one tick later.
        setSharedError(false);
        setLoadingShared(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSharedError(true);
        setLoadingShared(false);
      });
    return () => { cancelled = true; };
  }, [chatId]);

  const updateContact = async (patch: Partial<typeof settings>) => {
    try {
      const res = await fetch(`/api/users/${partnerUser.id}/contact-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) setSettings(prev => ({ ...prev, ...patch }));
    } catch (e) { console.error(e); }
  };

  const muteOptions = [
    { label: "15 минут", value: 15 },
    { label: "1 час", value: 60 },
    { label: "1 день", value: 1440 },
    { label: "3 дня", value: 4320 },
    { label: "7 дней", value: 10080 },
    { label: "Включить уведомления", value: 0 },
  ];

  const handleMute = (minutes: number) => {
    const mutedUntil = minutes > 0 ? new Date(Date.now() + minutes * 60000).toISOString() : null;
    updateContact({ mutedUntil });
  };

  /**
   * The pending destructive action, if any.
   *
   * One slot rather than a boolean per action: the sheet can only ask about
   * one thing at a time, and this way adding a destructive action does not
   * mean adding another piece of state to keep in sync.
   */
  const [confirming, setConfirming] = useState<{
    title: string;
    body?: string;
    confirmLabel: string;
    run: () => void | Promise<void>;
  } | null>(null);

  const clearDialog = async () => {
    setIsBusy(true);
    try {
      const res = await fetch(`/api/chats/${chatId}/clear`, { method: "DELETE" });
      if (!res.ok) throw new Error("CLEAR_FAILED");
      await Promise.all([
        clearCachedMessagesForChat(chatId).catch(() => 0),
        clearPersistedChatMessagesForChat(chatId).catch(() => undefined),
      ]);
      clearChatCache(chatId);
      router.replace(`/chats/${chatId}`);
    } finally {
      setIsBusy(false);
    }
  };

  const deleteContact = async () => {
    setIsBusy(true);
    try {
      await fetch(`/api/users/${partnerUser.id}/contact-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: null }),
      });
      await fetch(`/api/chats/${chatId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deleted: true }),
      });
      router.replace("/contacts");
    } finally {
      setIsBusy(false);
    }
  };

  const fullAvatarUrl = normalizeAvatarUrl(partnerUser.avatarUrl);

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-hide safe-bottom pb-[var(--bottom-dock-clearance)] transition-smooth">
      <header
        className="liquid-top-chrome sticky top-0 z-50 flex items-center justify-between px-3 py-2"
        style={{ minHeight: "calc(3.5rem + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <button onClick={() => router.back()} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]" aria-label="Назад">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <button
          type="button"
          onClick={() => setIsEditSheetOpen(true)}
          className="rounded-full bg-surface-elevated px-4 py-2 text-[1rem] font-semibold text-foreground shadow-sm transition-smooth active:scale-[0.96]"
        >
          Изменить
        </button>
      </header>

      <section className="flex flex-col items-center px-5 pb-6 pt-5">
        <div className="group relative mb-4 h-28 w-28">
          <button
            type="button"
            onClick={() => fullAvatarUrl && setShowAvatarViewer(true)}
            disabled={!fullAvatarUrl}
            className="nox-avatar-tint absolute inset-0 flex items-center justify-center overflow-hidden rounded-full transition-smooth active:scale-[0.96] disabled:cursor-default"
            data-avatar-tint={avatarTint(settings.nickname || partnerUser.displayName || partnerUser.username)}
            aria-label="Открыть фото профиля"
          >
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
            ) : (
              <span className="text-5xl font-semibold">{(settings.nickname || partnerUser.displayName)[0].toUpperCase()}</span>
            )}
          </button>
          {presence.isOnline && <div className="absolute bottom-1 right-1 h-6 w-6 rounded-full border-4 border-background bg-primary" />}
        </div>
        
        <h2 className="text-center text-[2rem] font-semibold leading-tight tracking-tight">{settings.nickname || partnerUser.displayName}</h2>
        <p className={`mt-1 text-[1rem] ${presence.isOnline ? "text-primary" : "text-muted"}`}>{presence.label}</p>
      </section>

      <div className="mb-7 grid grid-cols-4 gap-1 px-5">
        <ActionButton
          onClick={() => startCall(chatId, { displayName: settings.nickname || partnerUser.displayName, avatarUrl: partnerUser.avatarUrl ?? null }, { video: true })}
          label="Видео"
          icon={<VideoIcon />}
        />
        <ActionButton 
          onClick={() => {
            startCall(chatId, { displayName: settings.nickname || partnerUser.displayName, avatarUrl: partnerUser.avatarUrl ?? null });
          }} 
          label="Аудио"
          icon={<CallIcon />} 
        />
        <ActionMenuButton label="Звук" icon={<MuteIcon isMuted={!!settings.mutedUntil} />} options={muteOptions} onSelect={handleMute} />
        <MoreProfileButton
          isBlocked={settings.isBlocked}
          disabled={isBusy}
          onSearch={() => router.push(`/chats/${chatId}?search=true`)}
          onClear={() =>
            setConfirming({
              title: "Очистить диалог?",
              body: "История будет скрыта только у вас. У собеседника она останется.",
              confirmLabel: "Очистить",
              run: clearDialog,
            })
          }
          onBlock={() => updateContact({ isBlocked: !settings.isBlocked })}
        />
      </div>

      <div className="mb-6 px-5">
        <section className="overflow-hidden rounded-[28px] bg-surface-elevated">
          <div className="px-5 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[0.9375rem] text-muted">Username</p>
                <p className="mt-0.5 truncate text-[1.25rem] font-medium text-primary">@{partnerUser.username}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsEncryptionOpen(true)}
                className="mt-4 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary transition-smooth active:scale-[0.96]"
                aria-label="Информация о шифровании"
              >
                <QrIcon />
              </button>
            </div>
          </div>
          <div className="mx-5 h-px bg-border-subtle" />
          <div className="px-5 py-4">
            <p className="text-[0.9375rem] text-muted">Описание</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[1.0625rem] leading-snug text-foreground">
              {partnerUser.bio?.trim() || "Описание профиля не добавлено"}
            </p>
          </div>
        </section>
      </div>
      <div className="flex flex-1 flex-col px-5">
        <div className="sticky top-0 z-20 mb-4 rounded-full border border-border-subtle bg-foreground/5 p-1">
          <div className="grid grid-cols-3 gap-1">
          <TabButton active={activeTab === "media"} onClick={() => setActiveSection("media")} label="Медиа" />
          <TabButton active={activeTab === "files"} onClick={() => setActiveSection("files")} label="Файлы" />
          <TabButton active={activeTab === "links"} onClick={() => setActiveSection("links")} label="Ссылки" />
          </div>
        </div>

        <div className="flex-1 pb-10">
          {loadingShared ? (
            <div className="flex justify-center py-10"><div className="h-6 w-6 border-2 border-primary border-t-transparent animate-spin rounded-full" /></div>
          ) : sharedError ? (
            <div className="py-20 text-center">
              <p className="text-sm font-medium text-foreground">Не удалось загрузить</p>
              <p className="mt-1 text-[0.8125rem] text-muted">Проверьте соединение и попробуйте снова.</p>
            </div>
          ) : (
            <SharedContent type={activeTab} data={shared} chatId={chatId} currentUserId={currentUserId} />
          )}
        </div>
      </div>

      {isEditSheetOpen && (
        <div ref={editSheetRef} className="fixed inset-0 z-[600] flex items-center justify-center bg-black/55 p-6 animate-in fade-in" role="dialog" aria-modal="true" aria-labelledby="edit-contact-title">
          <div className="premium-glass w-full max-w-sm rounded-[1.75rem] p-5">
            <h2 id="edit-contact-title" className="mb-5 text-xl font-semibold">Изменить контакт</h2>
            <input 
              className="input-nox mb-6" 
              value={newName} 
              onChange={e => setNewName(e.target.value)}
              placeholder="Введите имя..."
              aria-label="Имя контакта"
              autoFocus
            />
            <button
              type="button"
              onClick={() =>
                setConfirming({
                  title: "Удалить контакт?",
                  body: "Диалог пропадёт из списка. Сообщения не удаляются.",
                  confirmLabel: "Удалить",
                  run: deleteContact,
                })
              }
              disabled={isBusy}
              className="mb-3 w-full rounded-xl bg-danger/10 px-4 py-3 text-sm font-semibold text-danger disabled:opacity-50"
            >
              Удалить контакт
            </button>
            <div className="flex gap-4">
              <button onClick={() => setIsEditSheetOpen(false)} className="flex-1 py-3 text-sm font-semibold text-muted">Отмена</button>
              <button onClick={() => { updateContact({ nickname: newName }); setIsEditSheetOpen(false); }} className="flex-1 py-3 text-sm font-semibold text-primary">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {isEncryptionOpen && (
        <div ref={encryptionRef} className="fixed inset-0 z-[600] flex items-center justify-center bg-black/55 p-6 animate-in fade-in" role="dialog" aria-modal="true" aria-labelledby="encryption-title">
          <div className="premium-glass w-full max-w-sm rounded-[1.75rem] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="encryption-title" className="text-xl font-semibold">Шифрование</h2>
              <button type="button" onClick={() => setIsEncryptionOpen(false)} className="text-sm font-semibold text-primary">Закрыть</button>
            </div>
            <p className="mb-4 text-sm leading-relaxed text-muted">
              Сообщения в личном чате шифруются на устройствах. Ни сервер, ни другие пользователи не видят содержимое переписки.
            </p>
            <E2EEContactDevices userId={partnerUser.id} chatId={chatId} />
          </div>
        </div>
      )}
      <AvatarViewer
        src={showAvatarViewer ? fullAvatarUrl : null}
        alt={settings.nickname || partnerUser.displayName}
        fileName={`${partnerUser.username || "profile"}-avatar.jpg`}
        onClose={() => setShowAvatarViewer(false)}
      />
      <ConfirmSheet
        open={confirming !== null}
        title={confirming?.title ?? ""}
        body={confirming?.body}
        confirmLabel={confirming?.confirmLabel ?? ""}
        busy={isBusy}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          const pending = confirming;
          setConfirming(null);
          void pending?.run();
        }}
      />
    </div>
  );
}

function ActionButton({ label, icon, onClick, destructive }: { label: string, icon: React.ReactNode, onClick: () => void, destructive?: boolean }) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-1.5">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full transition-smooth active:scale-[0.96] group-hover:bg-foreground/5 ${destructive ? "text-danger" : "text-primary"}`}>
        {icon}
      </div>
      <span className={`text-[0.6875rem] font-medium ${destructive ? "text-danger" : "text-primary"}`}>{label}</span>
    </button>
  );
}

function ActionMenuButton({ label, icon, options, onSelect }: { label: string, icon: React.ReactNode, options: { label: string, value: number }[], onSelect: (val: number) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useFocusTrap<HTMLDivElement>(isOpen, () => setIsOpen(false));
  return (
    <div className="relative">
      <ActionButton onClick={() => setIsOpen(!isOpen)} label={label} icon={icon} />
      {isOpen && (
        <div ref={popoverRef} className="fixed inset-0 z-[1000]" onClick={() => setIsOpen(false)} role="dialog" aria-modal="true" aria-label={label}>
          <div className="apple-glass-control absolute left-1/2 top-1/2 w-64 -translate-x-1/2 -translate-y-1/2 rounded-2xl p-2 animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            {options.map((opt) => (
              <button key={opt.value} onClick={() => { onSelect(opt.value); setIsOpen(false); }} className="w-full rounded-xl px-5 py-3.5 text-left text-sm font-medium transition-smooth hover:bg-foreground/5">
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MoreProfileButton({
  isBlocked,
  disabled,
  onSearch,
  onClear,
  onBlock,
}: {
  isBlocked: boolean;
  disabled?: boolean;
  onSearch: () => void;
  onClear: () => void;
  onBlock: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useFocusTrap<HTMLDivElement>(isOpen, () => setIsOpen(false));
  return (
    <div className="relative">
      <ActionButton onClick={() => setIsOpen((v) => !v)} label="Ещё" icon={<MoreIcon />} />
      {isOpen && (
        <div ref={menuRef} className="fixed inset-0 z-[1000]" onClick={() => setIsOpen(false)} role="dialog" aria-modal="true" aria-label="Дополнительные действия">
          <div className="apple-glass-control absolute right-5 top-[calc(env(safe-area-inset-top,0px)+17rem)] w-64 overflow-hidden rounded-2xl p-2 animate-in zoom-in-95" onClick={(event) => event.stopPropagation()}>
            <MenuItem onClick={() => { setIsOpen(false); onSearch(); }} icon={<SearchIcon />} label="Поиск" />
            <MenuItem onClick={() => { setIsOpen(false); onClear(); }} icon={<TrashIcon />} label="Очистить диалог" destructive disabled={disabled} />
            <MenuItem onClick={() => { setIsOpen(false); onBlock(); }} icon={<BlockIcon />} label={isBlocked ? "Разблокировать" : "Блок"} destructive={!isBlocked} />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({ icon, label, onClick, destructive, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-smooth hover:bg-foreground/5 disabled:opacity-50 ${destructive ? "text-danger" : "text-foreground"}`}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground/5">{icon}</span>
      {label}
    </button>
  );
}

function TabButton({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) {
  return (
    <button onClick={onClick} className={`h-10 rounded-full text-sm font-semibold transition-smooth active:scale-[0.96] ${active ? "bg-surface text-foreground shadow-sm" : "text-foreground/75 hover:bg-foreground/5"}`}>
      {label}
    </button>
  );
}

type GenericSharedItem = PhotoItem | AudioItem | FileItem | LinkItem;

function SharedContent({ type, data, chatId, currentUserId }: { type: string, data: SharedMedia | null, chatId: string, currentUserId: string }) {
  if (!data) return null;
  
  if (type === "media") {
    const items = data.photos || [];
    if (items.length === 0) return <div className="py-20 text-center text-sm font-medium text-muted">Ничего не найдено</div>;
    return (
      <div className="grid grid-cols-3 gap-1">
        {items.map((m) => (
          <SharedMediaTile key={m.id} item={m} chatId={chatId} currentUserId={currentUserId} />
        ))}
      </div>
    );
  }

  const items: GenericSharedItem[] = type === "files" ? data.files : data.links;
  if (items.length === 0) return <div className="py-20 text-center text-sm font-medium text-muted">Ничего не найдено</div>;

  return (
    <div className="space-y-4">
      {items.map((item, i) => {
        const url = 'url' in item ? item.url : '#';
        const fileName = 'fileName' in item ? item.fileName : ('url' in item ? item.url : 'Link');
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-xl p-2 transition-smooth hover:bg-foreground/5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-primary">
              {type === "files" ? <FileIcon /> : <LinkIcon />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{fileName}</p>
              <p className="text-xs font-normal text-muted">{'createdAt' in item ? new Date(item.createdAt).toLocaleDateString() : ''}</p>
            </div>
          </a>
        );
      })}
    </div>
  );
}

function SharedMediaTile({ item, chatId, currentUserId }: { item: PhotoItem, chatId: string, currentUserId: string }) {
  const [src, setSrc] = useState<string | null>(() => item.isEncrypted ? null : item.url);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!item.isEncrypted) {
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    async function decryptPreview() {
      try {
        const device = await registerCurrentDevice(currentUserId).catch(async () => ({ deviceId: await getLocalDeviceId(currentUserId) }));
        const envelope = item.mediaKeyEnvelopes?.find((entry) => entry.recipientDeviceId === device.deviceId);
        if (!envelope || !item.fileIv || !item.senderUserId) throw new Error("NO_MEDIA_ENVELOPE");

        const response = await fetch(item.url);
        if (!response.ok) throw new Error("DOWNLOAD_FAILED");
        const decrypted = await decryptMediaBlob({
          encryptedBlob: await response.blob(),
          fileIv: item.fileIv,
          senderUserId: item.senderUserId,
          senderDeviceId: envelope.senderDeviceId,
          chatId,
          envelope,
          mimeType: item.mimeType || (item.type === "VIDEO" ? "video/mp4" : "image/jpeg"),
        });
        if (!decrypted) throw new Error("DECRYPT_FAILED");
        objectUrl = URL.createObjectURL(decrypted);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) setError(true);
      }
    }

    void decryptPreview();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [chatId, currentUserId, item]);

  return (
    <div className="aspect-square bg-surface-muted rounded-md overflow-hidden active:scale-[0.96] transition-smooth relative">
      {src && !error && item.type === "VIDEO" ? (
        <video src={src} className="h-full w-full object-cover" preload="metadata" muted playsInline />
      ) : src && !error ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} className="h-full w-full object-cover" alt="" />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[0.625rem] font-bold text-muted">
          {error ? "Медиа недоступно" : "Расшифровка…"}
        </div>
      )}
    </div>
  );
}

function CallIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>; }
function VideoIcon() { return <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M4.5 6.5A2.5 2.5 0 0 1 7 4h7.5A2.5 2.5 0 0 1 17 6.5v11a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5v-11Zm13.7 3.35 2.25-1.7A.95.95 0 0 1 22 8.9v6.2a.95.95 0 0 1-1.55.75l-2.25-1.7v-4.3Z" /></svg>; }
function MoreIcon() { return <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24"><path d="M5 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" /></svg>; }
function SearchIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>; }
function MuteIcon({ isMuted }: { isMuted: boolean }) { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMuted ? "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" : "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"} /></svg>; }
function BlockIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>; }
function TrashIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 7h12m-9 0V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m2 0-.7 12.1A2 2 0 0 1 14.3 21H9.7a2 2 0 0 1-2-1.9L7 7m3 4v6m4-6v6" /></svg>; }
function QrIcon() { return <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeWidth={2} d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" /></svg>; }
function FileIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>; }
function LinkIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>; }
