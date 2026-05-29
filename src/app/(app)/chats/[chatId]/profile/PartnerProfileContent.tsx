"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAudioCall } from "../../../calls/CallProvider";
import { usePresence } from "@/hooks/usePresence";
import { useChatAppearance, ChatAppearanceSheet } from "../ChatAppearance";
import { E2EEContactDevices } from "./E2EEContactDevices";
import { getLocalDeviceId, registerCurrentDevice } from "@/lib/e2ee/keys";
import { decryptMediaBlob } from "@/lib/e2ee/media";
import { normalizeAvatarUrl } from "@/lib/media-url";

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
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(settings.nickname || partnerUser.displayName);
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const { settings: appearance, updateSettings, resetSettings } = useChatAppearance(chatId);

  const presence = usePresence({
    userId: partnerUser.id,
    initialLastSeenAt: partnerUser.lastSeenAt,
    initialIsOnline: partnerUser.isOnline,
  });

  useEffect(() => {
    fetch(`/api/chats/${chatId}/shared`)
      .then(res => res.json())
      .then(data => { setShared(data); setLoadingShared(false); })
      .catch(() => setLoadingShared(false));
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

  const fullAvatarUrl = normalizeAvatarUrl(partnerUser.avatarUrl);

  return (
    <div className="flex h-full flex-col overflow-y-auto scrollbar-hide safe-bottom transition-smooth">
      {/* Top Header */}
      <header
        className="sticky top-0 z-50 flex items-center justify-between border-b border-border-subtle bg-background px-3 py-2"
        style={{ minHeight: "calc(3.5rem + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <button onClick={() => router.back()} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-95" aria-label="Назад">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-center">
          <h1 className="text-sm font-semibold tracking-tight">{settings.nickname || partnerUser.displayName}</h1>
          <p className={`text-xs font-normal ${presence.isOnline ? "text-primary" : "text-muted"}`}>{presence.label}</p>
        </div>
        <div className="w-10" /> 
      </header>

      {/* Hero Section */}
      <section className="flex flex-col items-center px-6 pb-8 pt-7">
        <div className="group relative mb-5 h-32 w-32">
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full bg-surface-muted">
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
            ) : (
              <span className="text-5xl font-semibold text-primary">{(settings.nickname || partnerUser.displayName)[0].toUpperCase()}</span>
            )}
          </div>
          {presence.isOnline && <div className="absolute bottom-1 right-1 h-6 w-6 rounded-full border-4 border-background bg-primary" />}
        </div>
        
        <h2 className="text-center text-3xl font-semibold tracking-tight">{settings.nickname || partnerUser.displayName}</h2>
        <p className="mt-1 text-sm font-medium text-primary">@{partnerUser.username}</p>
        
        {partnerUser.bio && (
          <p className="mt-5 max-w-xs text-center text-sm leading-relaxed text-muted">{partnerUser.bio}</p>
        )}
      </section>

      {/* Quick Actions */}
      <div className="mb-8 grid grid-cols-5 gap-1 px-4">
        <ActionButton 
          onClick={() => {
            const currentU = { displayName: "Я", avatarUrl: null };
            startCall(chatId, currentU);
          }} 
          label="Звонок" 
          icon={<CallIcon />} 
        />
        <ActionButton onClick={() => router.push(`/chats/${chatId}?search=true`)} label="Найти" icon={<SearchIcon />} />
        <ActionButton onClick={() => setIsAppearanceOpen(true)} label="Стиль" icon={<AppearanceIcon />} />
        <ActionMenuButton label="Звук" icon={<MuteIcon isMuted={!!settings.mutedUntil} />} options={muteOptions} onSelect={handleMute} />
        <ActionButton onClick={() => updateContact({ isBlocked: !settings.isBlocked })} label={settings.isBlocked ? "Разблок." : "Блок"} icon={<BlockIcon />} destructive={!settings.isBlocked} />
      </div>

      {/* Settings List */}
      <div className="mb-8 space-y-3 px-4">
        <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
          <SettingsItem 
            label="Переименовать" 
            value={settings.nickname || "Не задано"} 
            onClick={() => setIsEditingName(true)}
          />
          <div className="mx-4 h-px bg-border-subtle" />
          <SettingsItem 
            label="Уведомления" 
            value={settings.mutedUntil ? `До ${new Date(settings.mutedUntil).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : "Включены"}
          />
        </section>
        <E2EEContactDevices userId={partnerUser.id} chatId={chatId} />
      </div>

      {/* Shared Media Tabs */}
      <div className="flex flex-1 flex-col px-4">
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
          ) : (
            <SharedContent type={activeTab} data={shared} chatId={chatId} currentUserId={currentUserId} />
          )}
        </div>
      </div>

      {/* Rename Dialog */}
      {isEditingName && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/55 p-6 animate-in fade-in">
          <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-lg">
            <h3 className="mb-5 text-xl font-semibold">Переименовать</h3>
            <input 
              className="input-nox mb-6" 
              value={newName} 
              onChange={e => setNewName(e.target.value)}
              placeholder="Введите имя..."
              autoFocus
            />
            <div className="flex gap-4">
              <button onClick={() => setIsEditingName(false)} className="flex-1 py-3 text-sm font-semibold text-muted">Отмена</button>
              <button onClick={() => { updateContact({ nickname: newName }); setIsEditingName(false); }} className="flex-1 py-3 text-sm font-semibold text-primary">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      <ChatAppearanceSheet 
        isOpen={isAppearanceOpen} 
        onClose={() => setIsAppearanceOpen(false)} 
        settings={appearance} 
        onUpdate={updateSettings} 
        onReset={resetSettings} 
      />
    </div>
  );
}

function ActionButton({ label, icon, onClick, destructive }: { label: string, icon: React.ReactNode, onClick: () => void, destructive?: boolean }) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-2">
      <div className={`flex h-12 w-12 items-center justify-center rounded-full transition-smooth active:scale-95 ${destructive ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"}`}>
        {icon}
      </div>
      <span className={`text-[11px] font-semibold ${destructive ? "text-danger" : "text-primary"} opacity-90`}>{label}</span>
    </button>
  );
}

function ActionMenuButton({ label, icon, options, onSelect }: { label: string, icon: React.ReactNode, options: { label: string, value: number }[], onSelect: (val: number) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="relative">
      <ActionButton onClick={() => setIsOpen(!isOpen)} label={label} icon={icon} />
      {isOpen && (
        <div className="fixed inset-0 z-[1000]" onClick={() => setIsOpen(false)}>
          <div className="absolute left-1/2 top-1/2 w-64 -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border-subtle bg-surface p-2 shadow-lg animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
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

function SettingsItem({ label, value, onClick }: { label: string, value: string, onClick?: () => void }) {
  return (
    <button onClick={onClick} className="group flex w-full items-center justify-between px-5 py-4 transition-smooth hover:bg-foreground/5 active:bg-foreground/10">
      <span className="text-sm font-semibold text-foreground/80">{label}</span>
      <span className="max-w-[140px] truncate text-sm font-medium text-primary">{value}</span>
    </button>
  );
}

function TabButton({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) {
  return (
    <button onClick={onClick} className={`h-10 rounded-full text-sm font-semibold transition-smooth active:scale-[0.98] ${active ? "bg-surface text-foreground shadow-sm" : "text-foreground/75 hover:bg-foreground/5"}`}>
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
    <div className="aspect-square bg-surface-muted rounded-md overflow-hidden active:scale-95 transition-smooth relative">
      {src && !error && item.type === "VIDEO" ? (
        <video src={src} className="h-full w-full object-cover" preload="metadata" muted playsInline />
      ) : src && !error ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} className="h-full w-full object-cover" alt="" />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-bold text-muted">
          {error ? "Медиа недоступно" : "Расшифровка…"}
        </div>
      )}
    </div>
  );
}

function CallIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>; }
function SearchIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>; }
function AppearanceIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>; }
function MuteIcon({ isMuted }: { isMuted: boolean }) { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMuted ? "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" : "M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"} /></svg>; }
function BlockIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>; }
function FileIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>; }
function LinkIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>; }
