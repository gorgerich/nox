"use client";

import { avatarTint } from "@/lib/avatar-tint";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { formatCalendarDate, roleLabel } from "@/lib/format-ru";
import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useChatAppearance, ChatAppearanceSheet } from "../ChatAppearance";
import { normalizeAvatarUrl } from "@/lib/media-url";

interface GroupMember {
  userId: string;
  name: string;
  username: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  isSelf: boolean;
}

interface GroupProfileProps {
  chatId: string;
  chat: {
    id: string;
    title: string;
    avatarUrl: string | null;
    createdAt: string;
  };
  members: GroupMember[];
  permissions: {
    canEditGroup: boolean;
    canAddMembers: boolean;
    canRemoveMembers: boolean;
  };
}

interface PhotoItem { id: string; url: string; type: "IMAGE" | "VIDEO"; createdAt: string }
interface AudioItem { id: string; url: string; fileName: string; createdAt: string }
interface FileItem { id: string; fileName: string; size: number; createdAt: string }
interface LinkItem { url: string; createdAt: string }

interface FoundGroupUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  isSelf: boolean;
}

interface SharedMedia {
  photos: PhotoItem[];
  audio: AudioItem[];
  files: FileItem[];
  links: LinkItem[];
}

export function GroupProfileContent({ chatId, chat, members: initialMembers, permissions }: GroupProfileProps) {
  const router = useRouter();
  const [members, setMembers] = useState(initialMembers);
  const [activeTab, setActiveSection] = useState<"media" | "files" | "links">("media");
  const [shared, setShared] = useState<SharedMedia | null>(null);
  const [loadingShared, setLoadingShared] = useState(true);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState(chat.title);
  const [isAddingMembers, setIsAddingMembers] = useState(false);
  const [searchUser, setSearchUser] = useState("");
  const [foundUsers, setFoundUser] = useState<FoundGroupUser[]>([]);
  const [pending, setPending] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const editTitleRef = useFocusTrap<HTMLDivElement>(isEditingTitle, () => setIsEditingTitle(false));
  const addMembersRef = useFocusTrap<HTMLDivElement>(isAddingMembers, () => {
    setIsAddingMembers(false);
    setSearchUser("");
    setFoundUser([]);
  });
  const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
  const { settings: appearance, updateSettings, resetSettings } = useChatAppearance(chatId);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/chats/${chatId}/shared`)
      .then(res => res.json())
      .then(data => { setShared(data); setLoadingShared(false); })
      .catch(() => setLoadingShared(false));
  }, [chatId]);

  useEffect(() => {
    const query = searchUser.trim();
    if (!isAddingMembers || query.length < 2) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/users/search-by-username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: query }),
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => null)) as { user?: FoundGroupUser; error?: string } | null;
        if (!res.ok || !data?.user) {
          setFoundUser([]);
          return;
        }
        const alreadyMember = members.some((member) => member.userId === data.user?.id);
        setFoundUser(alreadyMember || data.user.isSelf ? [] : [data.user]);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setFoundUser([]);
        }
      }
    }, 220);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [isAddingMembers, members, searchUser]);

  const updateGroup = async (patch: { title?: string, avatarUrl?: string | null }) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/group-profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (res.ok) router.refresh();
    } catch (e) { console.error(e); }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPending(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/chats/${chatId}/group-avatar`, {
        method: "POST",
        body: formData,
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        setStatusMessage(data.error || "Ошибка при загрузке аватара");
      }
    } catch {
      setStatusMessage("Ошибка сети");
    } finally {
      setPending(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAvatarDelete = async () => {
    if (!confirm("Удалить фото группы?")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/chats/${chatId}/group-avatar`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
    } catch (error) {
      console.error(error);
    } finally {
      setPending(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!confirm("Удалить участника?")) return;
    try {
      const res = await fetch(`/api/chats/${chatId}/members/${userId}`, { method: "DELETE" });
      if (res.ok) {
        setMembers(prev => prev.filter(m => m.userId !== userId));
        router.refresh();
      } else {
        setStatusMessage("Не удалось удалить участника");
      }
    } catch {
      setStatusMessage("Ошибка сети");
    }
  };

  const handleAddMembers = async (userIds: string[]) => {
    try {
      const res = await fetch(`/api/chats/${chatId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds })
      });
      if (res.ok) {
        setIsAddingMembers(false);
        setSearchUser("");
        setFoundUser([]);
        router.refresh();
        // Reload members
        fetch(`/api/chats/${chatId}/group-profile`).then(r => r.json()).then(d => setMembers(d.members));
      } else {
        setStatusMessage("Не удалось добавить участника");
      }
    } catch {
      setStatusMessage("Ошибка сети");
    }
  };

  const fullAvatarUrl = normalizeAvatarUrl(chat.avatarUrl);
  const quickActionColumnClass = permissions.canEditGroup ? "grid-cols-3" : "grid-cols-2";

  return (
    // pb keeps the last card clear of the floating dock. `safe-bottom` alone
    // only accounts for the home indicator, so the final row scrolled under it.
    <div className="flex h-full flex-col overflow-y-auto bg-background scrollbar-hide safe-bottom pb-[var(--bottom-dock-clearance)] transition-smooth">
      <header
        className="liquid-top-chrome sticky top-0 z-50 flex items-center justify-between px-3 py-2"
        style={{ minHeight: "calc(3.5rem + env(safe-area-inset-top, 0px))", paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <button onClick={() => router.back()} className="touch-target flex h-11 w-11 items-center justify-center rounded-full text-primary transition-smooth hover:bg-primary/10 active:scale-[0.96]" aria-label="Назад">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="w-10" /> 
      </header>

      <section className="flex flex-col items-center px-6 pb-8 pt-7">
        <div className="group relative mb-5 h-32 w-32">
          <button 
            type="button"
            aria-label={permissions.canEditGroup ? "Изменить фото группы" : `Фото группы ${chat.title}`}
            onClick={() => permissions.canEditGroup && fileInputRef.current?.click()}
            disabled={pending || !permissions.canEditGroup}
            className={`nox-avatar-tint absolute inset-0 flex items-center justify-center overflow-hidden rounded-full transition-smooth ${permissions.canEditGroup ? 'hover:opacity-90 active:scale-[0.96]' : ''}`}
            data-avatar-tint={avatarTint(chat.title)}
          >
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
            ) : (
              <span className="text-5xl font-semibold">{chat.title[0]?.toUpperCase()}</span>
            )}
            
            {permissions.canEditGroup && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <svg className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
            )}
          </button>
          
          {permissions.canEditGroup && (
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleAvatarUpload} 
              accept="image/*" 
              className="hidden" 
            />
          )}

          {permissions.canEditGroup && chat.avatarUrl && (
            <button 
              onClick={handleAvatarDelete}
              disabled={pending}
              className="absolute -bottom-1 -right-1 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-surface text-danger shadow-lg transition-smooth active:scale-[0.96]"
              aria-label="Удалить фото группы"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
        
        <h2 className="text-center text-3xl font-semibold tracking-tight">{chat.title}</h2>
        <p className="mt-1 text-sm font-normal text-muted">{members.length} участников</p>
        <p className="mt-3 text-xs font-normal text-muted">Группа создана {formatCalendarDate(chat.createdAt)}</p>
        {statusMessage ? (
          <p className="mt-3 rounded-full bg-danger/10 px-3 py-1.5 text-xs font-semibold text-danger">
            {statusMessage}
          </p>
        ) : null}
      </section>

      {/* Quick Actions */}
      <div className={`mb-8 grid ${quickActionColumnClass} gap-1 px-4`}>
        <ActionButton onClick={() => router.push(`/chats/${chatId}?search=true`)} label="Найти" icon={<SearchIcon />} />
        <ActionButton onClick={() => setIsAppearanceOpen(true)} label="Стиль" icon={<AppearanceIcon />} />
        {permissions.canEditGroup && <ActionButton onClick={() => setIsEditingTitle(true)} label="Изменить название" icon={<EditIcon />} />}
      </div>

      <div className="mb-8 space-y-3 px-4">
        <section className="overflow-hidden rounded-2xl border border-border-subtle bg-surface">
          {permissions.canAddMembers && (
            <>
              <button onClick={() => setIsAddingMembers(true)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-smooth hover:bg-foreground/5 active:bg-foreground/10">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <AddMemberIcon />
                </div>
                <span className="text-sm font-semibold text-primary">Добавить участников</span>
              </button>
              <div className="ml-[4.25rem] h-px bg-border-subtle" />
            </>
          )}
          <div className="divide-y divide-border-subtle">
            {members.map(m => (
              <div key={m.userId} className="group flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                    {normalizeAvatarUrl(m.avatarUrl) ? (
                      <Image src={normalizeAvatarUrl(m.avatarUrl) || ""} fill className="object-cover" alt={m.name} />
                    ) : (
                      <span className="text-sm font-semibold text-primary">{m.name[0]?.toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{m.name} {m.isSelf && <span className="font-normal text-muted">(Вы)</span>}</p>
                    <p className="truncate text-xs font-normal text-muted">@{m.username}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-foreground/5 px-2 py-1 text-[11px] font-medium text-muted">{roleLabel(m.role)}</span>
                {permissions.canRemoveMembers && !m.isSelf && (
                  <button onClick={() => handleRemoveMember(m.userId)} className="rounded-full p-2 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100" aria-label="Удалить участника">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

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
            <SharedContent type={activeTab} data={shared} />
          )}
        </div>
      </div>

      {isEditingTitle && (
        <div ref={editTitleRef} className="fixed inset-0 z-[600] flex items-center justify-center bg-black/55 p-6 animate-in fade-in" role="dialog" aria-modal="true" aria-labelledby="edit-group-title">
          <div className="premium-glass w-full max-w-sm rounded-[1.75rem] p-5">
            <h2 id="edit-group-title" className="mb-5 text-xl font-semibold">Название группы</h2>
            <input className="input-nox mb-6" aria-label="Название группы" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus />
            <div className="flex gap-4">
              <button onClick={() => setIsEditingTitle(false)} className="flex-1 py-3 text-sm font-semibold text-muted">Отмена</button>
              <button onClick={() => { updateGroup({ title: newTitle }); setIsEditingTitle(false); }} className="flex-1 py-3 text-sm font-semibold text-primary">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {isAddingMembers && (
        <div ref={addMembersRef} className="fixed inset-0 z-[600] flex flex-col bg-surface safe-top animate-in slide-in-from-bottom duration-300" role="dialog" aria-modal="true" aria-labelledby="add-members-title">
           <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
             <button onClick={() => { setIsAddingMembers(false); setSearchUser(""); setFoundUser([]); }} className="text-sm font-semibold text-muted">Отмена</button>
             <h2 id="add-members-title" className="text-sm font-semibold">Добавить участников</h2>
             <div className="w-12" />
           </header>
           <div className="p-4">
             <input
               className="input-nox"
               aria-label="Поиск пользователя по username"
               placeholder="Введите username..."
               value={searchUser}
               onChange={(event) => {
                 const nextValue = event.target.value;
                 setSearchUser(nextValue);
                 if (nextValue.trim().length < 2) {
                   setFoundUser([]);
                 }
               }}
             />
           </div>
           <div className="flex-1 overflow-y-auto px-4">
              {foundUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between border-b border-border-subtle py-3">
                  <div className="flex items-center gap-3">
                    <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10">
                        {normalizeAvatarUrl(u.avatarUrl) ? (
                          <Image src={normalizeAvatarUrl(u.avatarUrl) || ""} alt={u.displayName} fill className="object-cover" />
                        ) : (
                          <span className="text-sm font-semibold text-primary">{u.displayName[0]?.toLocaleUpperCase("ru-RU")}</span>
                        )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold">{u.displayName}</p>
                      <p className="text-xs text-muted">@{u.username}</p>
                    </div>
                  </div>
                  <button onClick={() => handleAddMembers([u.id])} className="h-9 rounded-full bg-primary/10 px-4 text-sm font-semibold text-primary transition-smooth active:scale-[0.96]">Добавить</button>
                </div>
              ))}
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

function ActionButton({ label, icon, onClick }: { label: string, icon: React.ReactNode, onClick: () => void }) {
  return (
    <button onClick={onClick} className="group flex flex-col items-center gap-2">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-smooth active:scale-[0.96]">
        {icon}
      </div>
      <span className="text-[11px] font-semibold text-primary opacity-90">{label}</span>
    </button>
  );
}

function AddMemberIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3M12 15a4 4 0 10-8 0v1a2 2 0 002 2h6m1-10a4 4 0 11-8 0 4 4 0 018 0z" /></svg>; }
function SearchIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>; }
function AppearanceIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>; }
function EditIcon() { return <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M4 20h4.586a1 1 0 00.707-.293L19.5 9.5a2.5 2.5 0 00-3.536-3.536L5.757 16.172a1 1 0 00-.293.707V20z" /></svg>; }

function TabButton({ active, onClick, label }: { active: boolean, onClick: () => void, label: string }) {
  return (
    <button onClick={onClick} className={`h-10 rounded-full text-sm font-semibold transition-smooth active:scale-[0.98] ${active ? "bg-surface text-foreground shadow-sm" : "text-foreground/75 hover:bg-foreground/5"}`}>
      {label}
    </button>
  );
}

function SharedContent({ type, data }: { type: string, data: SharedMedia | null }) {
  if (!data) return null;
  if (type === "media") {
    const items = data.photos || [];
    if (items.length === 0) return <div className="py-20 text-center text-sm font-medium text-muted">Ничего не найдено</div>;
    return (
      <div className="grid grid-cols-3 gap-1">
        {items.map((m) => (
          <div key={m.id} className="relative aspect-square overflow-hidden rounded-md bg-surface-muted transition-smooth active:scale-[0.96]">
            <Image src={m.url} fill className="object-cover" alt="" />
          </div>
        ))}
      </div>
    );
  }
  const items = type === "files" ? data.files : data.links;
  if (items.length === 0) return <div className="py-20 text-center text-sm font-medium text-muted">Ничего не найдено</div>;
  return (
    <div className="space-y-4">
      {items.map((item: PhotoItem | AudioItem | FileItem | LinkItem, i: number) => {
        const url = 'url' in item ? item.url : '#';
        const fileName = 'fileName' in item ? item.fileName : ('url' in item ? item.url : 'Link');
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-xl p-2 transition-smooth hover:bg-foreground/5">
             <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted text-primary">
               {type === "files" ? <FileIcon /> : <LinkIcon />}
             </div>
             <div className="min-w-0 flex-1">
               <p className="truncate text-sm font-semibold">{fileName}</p>
               <p className="text-xs font-normal text-muted">{formatCalendarDate(item.createdAt)}</p>
             </div>
          </a>
        );
      })}
    </div>
  );
}

function FileIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>; }
function LinkIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>; }
