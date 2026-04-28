"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useAudioCall } from "../../../calls/CallProvider";
import { usePresence } from "@/hooks/usePresence";
import { useChatAppearance, ChatAppearanceSheet } from "../ChatAppearance";
import { E2EEContactDevices } from "./E2EEContactDevices";

interface PartnerProfileProps {
  chatId: string;
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

interface PhotoItem { id: string; url: string; type: "IMAGE" | "VIDEO"; createdAt: string }
interface AudioItem { id: string; url: string; fileName: string; createdAt: string }
interface FileItem { id: string; fileName: string; size: number; createdAt: string }
interface LinkItem { url: string; createdAt: string }

interface SharedMedia {
  photos: PhotoItem[];
  audio: AudioItem[];
  files: FileItem[];
  links: LinkItem[];
}

export function PartnerProfileContent({ chatId, partnerUser, initialSettings }: PartnerProfileProps) {
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

  const fullAvatarUrl = partnerUser.avatarUrl 
    ? (partnerUser.avatarUrl.startsWith('http') ? partnerUser.avatarUrl : `/api/avatars/${partnerUser.avatarUrl}`)
    : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide safe-bottom transition-smooth">
      {/* Top Header */}
      <header className="sticky top-0 z-50 glass-header flex items-center justify-between px-4 py-3">
        <button onClick={() => router.back()} className="touch-target h-10 w-10 flex items-center justify-center rounded-xl bg-surface-muted text-foreground active:scale-90 transition-smooth">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-center">
          <h1 className="text-sm font-black tracking-tight">{settings.nickname || partnerUser.displayName}</h1>
          <p className={`text-[10px] font-black uppercase tracking-widest ${presence.isOnline ? "text-primary" : "text-muted"}`}>{presence.label}</p>
        </div>
        <div className="w-10" /> 
      </header>

      {/* Hero Section */}
      <section className="flex flex-col items-center pt-8 pb-10 px-6">
        <div className="relative mb-6 h-32 w-32 group">
          <div className="absolute inset-0 rounded-[3rem] border-4 border-surface shadow-2xl overflow-hidden bg-surface-muted flex items-center justify-center">
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
            ) : (
              <span className="text-5xl font-black text-primary">{(settings.nickname || partnerUser.displayName)[0].toUpperCase()}</span>
            )}
          </div>
          {presence.isOnline && <div className="absolute bottom-1 right-1 h-6 w-6 rounded-full bg-primary border-4 border-background shadow-sm" />}
        </div>
        
        <h2 className="text-3xl font-black tracking-tight text-center">{settings.nickname || partnerUser.displayName}</h2>
        <p className="text-sm font-bold text-primary tracking-[0.2em] uppercase mt-1">@{partnerUser.username}</p>
        
        {partnerUser.bio && (
          <p className="mt-6 text-center text-muted text-sm leading-relaxed max-w-xs">{partnerUser.bio}</p>
        )}
      </section>

      {/* Quick Actions */}
      <div className="grid grid-cols-5 gap-1 px-4 mb-10">
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
      <div className="px-6 space-y-2 mb-10">
        <section className="card-premium p-1">
          <SettingsItem 
            label="Переименовать" 
            value={settings.nickname || "Не задано"} 
            onClick={() => setIsEditingName(true)}
          />
          <div className="h-px bg-border-subtle/30 mx-4" />
          <SettingsItem 
            label="Уведомления" 
            value={settings.mutedUntil ? `До ${new Date(settings.mutedUntil).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` : "Включены"}
          />
        </section>
        <E2EEContactDevices userId={partnerUser.id} chatId={chatId} />
      </div>

      {/* Shared Media Tabs */}
      <div className="flex-1 flex flex-col px-4">
        <div className="flex gap-6 border-b border-border-subtle/30 px-2 mb-4">
          <TabButton active={activeTab === "media"} onClick={() => setActiveSection("media")} label="Медиа" />
          <TabButton active={activeTab === "files"} onClick={() => setActiveSection("files")} label="Файлы" />
          <TabButton active={activeTab === "links"} onClick={() => setActiveSection("links")} label="Ссылки" />
        </div>

        <div className="flex-1 pb-10">
          {loadingShared ? (
            <div className="flex justify-center py-10"><div className="h-6 w-6 border-2 border-primary border-t-transparent animate-spin rounded-full" /></div>
          ) : (
            <SharedContent type={activeTab} data={shared} />
          )}
        </div>
      </div>

      {/* Rename Dialog */}
      {isEditingName && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-xl p-6 animate-in fade-in">
          <div className="w-full max-w-sm rounded-[2.5rem] bg-surface p-6 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Переименовать</h3>
            <input 
              className="input-nox mb-6" 
              value={newName} 
              onChange={e => setNewName(e.target.value)}
              placeholder="Введите имя..."
              autoFocus
            />
            <div className="flex gap-4">
              <button onClick={() => setIsEditingName(false)} className="flex-1 py-4 font-black uppercase text-muted">Отмена</button>
              <button onClick={() => { updateContact({ nickname: newName }); setIsEditingName(false); }} className="flex-1 py-4 font-black uppercase text-primary">Сохранить</button>
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
    <button onClick={onClick} className="flex flex-col items-center gap-2 group">
      <div className={`h-12 w-12 rounded-2xl flex items-center justify-center transition-smooth active:scale-90 ${destructive ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"} group-hover:scale-105`}>
        {icon}
      </div>
      <span className={`text-[10px] font-black uppercase tracking-widest ${destructive ? "text-danger" : "text-primary"} opacity-80`}>{label}</span>
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
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 rounded-3xl bg-surface p-2 shadow-2xl border border-border-subtle animate-in zoom-in-95" onClick={e => e.stopPropagation()}>
            {options.map((opt) => (
              <button key={opt.value} onClick={() => { onSelect(opt.value); setIsOpen(false); }} className="w-full text-left px-5 py-3.5 text-sm font-bold hover:bg-foreground/5 rounded-2xl transition-smooth">
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
    <button onClick={onClick} className="w-full flex items-center justify-between px-5 py-4 hover:bg-foreground/5 rounded-2xl transition-smooth group active:scale-[0.98]">
      <span className="text-sm font-bold text-foreground/80">{label}</span>
      <span className="text-sm font-bold text-primary truncate max-w-[120px]">{value}</span>
    </button>
  );
}

function TabButton({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) {
  return (
    <button onClick={onClick} className={`pb-3 text-xs font-black uppercase tracking-[0.2em] transition-smooth relative ${active ? "text-primary" : "text-muted"}`}>
      {label}
      {active && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary rounded-full" />}
    </button>
  );
}

type GenericSharedItem = PhotoItem | AudioItem | FileItem | LinkItem;

function SharedContent({ type, data }: { type: string, data: SharedMedia | null }) {
  if (!data) return null;
  
  if (type === "media") {
    const items = data.photos || [];
    if (items.length === 0) return <div className="py-20 text-center text-muted font-bold text-sm">Ничего не найдено</div>;
    return (
      <div className="grid grid-cols-3 gap-1">
        {items.map((m) => (
          <div key={m.id} className="aspect-square bg-surface-muted rounded-md overflow-hidden active:scale-95 transition-smooth relative">
            <Image src={m.url} fill className="object-cover" alt="" />
          </div>
        ))}
      </div>
    );
  }

  const items: GenericSharedItem[] = type === "files" ? data.files : data.links;
  if (items.length === 0) return <div className="py-20 text-center text-muted font-bold text-sm">Ничего не найдено</div>;

  return (
    <div className="space-y-4">
      {items.map((item, i) => {
        const url = 'url' in item ? item.url : '#';
        const fileName = 'fileName' in item ? item.fileName : ('url' in item ? item.url : 'Link');
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-2 hover:bg-foreground/5 rounded-xl transition-smooth">
            <div className="h-10 w-10 rounded-lg bg-surface-muted flex items-center justify-center text-primary shrink-0">
              {type === "files" ? <FileIcon /> : <LinkIcon />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold truncate">{fileName}</p>
              <p className="text-[10px] font-black uppercase text-muted">{'createdAt' in item ? new Date(item.createdAt).toLocaleDateString() : ''}</p>
            </div>
          </a>
        );
      })}
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
