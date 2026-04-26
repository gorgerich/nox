"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

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
  const [foundUsers, setFoundUser] = useState<GroupMember[]>([]);
  const [pending, setPending] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/chats/${chatId}/shared`)
      .then(res => res.json())
      .then(data => { setShared(data); setLoadingShared(false); })
      .catch(() => setLoadingShared(false));
  }, [chatId]);

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
        alert(data.error || "Ошибка при загрузке аватара");
      }
    } catch {
      alert("Ошибка сети");
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
      }
    } catch (e) { console.error(e); }
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
        router.refresh();
        // Reload members
        fetch(`/api/chats/${chatId}/group-profile`).then(r => r.json()).then(d => setMembers(d.members));
      }
    } catch (e) { console.error(e); }
  };

  const searchUsers = async (val: string) => {
    setSearchUser(val);
    if (val.length < 2) return;
    try {
        const res = await fetch("/api/users/search-by-username", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: val })
        });
        const data = await res.json();
        if (data.user) setFoundUser([data.user]); else setFoundUser([]);
    } catch {}
  };

  const fullAvatarUrl = chat.avatarUrl 
    ? (chat.avatarUrl.startsWith('http') ? chat.avatarUrl : `/api/avatars/${chat.avatarUrl}`)
    : null;

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-hide safe-bottom transition-smooth">
      <header className="sticky top-0 z-50 glass-header flex items-center justify-between px-4 py-3">
        <button onClick={() => router.back()} className="touch-target h-10 w-10 flex items-center justify-center rounded-xl bg-surface-muted text-foreground active:scale-90 transition-smooth">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <div className="text-center">
          <h1 className="text-sm font-black tracking-tight">{chat.title}</h1>
          <p className="text-[10px] font-black uppercase tracking-widest text-muted">{members.length} участников</p>
        </div>
        <div className="w-10" /> 
      </header>

      <section className="flex flex-col items-center pt-8 pb-10 px-6">
        <div className="relative mb-6 h-32 w-32 group">
          <button 
            onClick={() => permissions.canEditGroup && fileInputRef.current?.click()}
            disabled={pending || !permissions.canEditGroup}
            className={`absolute inset-0 rounded-[3rem] border-4 border-surface shadow-2xl overflow-hidden bg-surface-muted flex items-center justify-center transition-smooth ${permissions.canEditGroup ? 'hover:scale-105 active:scale-95 group-hover:shadow-primary/20' : ''}`}
          >
            {fullAvatarUrl ? (
              <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
            ) : (
              <span className="text-5xl font-black text-primary">{chat.title[0]?.toUpperCase()}</span>
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
              className="absolute -bottom-2 -right-2 h-10 w-10 bg-surface border border-border-subtle rounded-2xl flex items-center justify-center text-red-400 shadow-xl active:scale-90 transition-smooth z-10"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
        
        <h2 className="text-3xl font-black tracking-tight text-center">{chat.title}</h2>
        <p className="text-[10px] font-black text-muted tracking-[0.2em] uppercase mt-2">Группа создана {new Date(chat.createdAt).toLocaleDateString()}</p>
      </section>

      <div className="px-6 space-y-4 mb-10">
        {permissions.canEditGroup && (
          <section className="card-premium p-1">
            <SettingsItem 
              label="Изменить название" 
              value={chat.title} 
              onClick={() => setIsEditingTitle(true)}
            />
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">Участники ({members.length})</h3>
            {permissions.canAddMembers && (
              <button onClick={() => setIsAddingMembers(true)} className="text-[10px] font-black uppercase text-primary hover:opacity-80">Добавить</button>
            )}
          </div>
          <div className="card-premium divide-y divide-border-subtle/30 overflow-hidden">
            {members.map(m => (
              <div key={m.userId} className="flex items-center justify-between p-3 group">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 relative">
                    {m.avatarUrl ? (
                      <Image src={m.avatarUrl.startsWith('http') ? m.avatarUrl : `/api/avatars/${m.avatarUrl}`} fill className="object-cover" alt={m.name} />
                    ) : (
                      <span className="text-xs font-black text-primary">{m.name[0]?.toUpperCase()}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{m.name} {m.isSelf && <span className="text-muted font-medium">(Вы)</span>}</p>
                    <p className="text-[10px] font-black uppercase text-muted tracking-wider">@{m.username} • {m.role}</p>
                  </div>
                </div>
                {permissions.canRemoveMembers && !m.isSelf && (
                  <button onClick={() => handleRemoveMember(m.userId)} className="text-danger opacity-0 group-hover:opacity-100 transition-opacity p-2">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

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

      {isEditingTitle && (
        <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/80 backdrop-blur-xl p-6 animate-in fade-in">
          <div className="w-full max-w-sm rounded-[2.5rem] bg-surface p-6 shadow-2xl">
            <h3 className="text-xl font-black mb-6">Название группы</h3>
            <input className="input-nox mb-6" value={newTitle} onChange={e => setNewTitle(e.target.value)} autoFocus />
            <div className="flex gap-4">
              <button onClick={() => setIsEditingTitle(false)} className="flex-1 py-4 font-black uppercase text-muted">Отмена</button>
              <button onClick={() => { updateGroup({ title: newTitle }); setIsEditingTitle(false); }} className="flex-1 py-4 font-black uppercase text-primary">Сохранить</button>
            </div>
          </div>
        </div>
      )}

      {isAddingMembers && (
        <div className="fixed inset-0 z-[600] flex flex-col bg-surface safe-top animate-in slide-in-from-bottom duration-300">
           <header className="flex items-center justify-between px-4 py-3 border-b border-border-subtle/30">
             <button onClick={() => setIsAddingMembers(false)} className="text-sm font-bold text-muted">Отмена</button>
             <h3 className="text-sm font-black uppercase tracking-widest">Добавить участников</h3>
             <div className="w-12" />
           </header>
           <div className="p-4">
             <input className="input-nox" placeholder="Введите username..." value={searchUser} onChange={e => searchUsers(e.target.value)} />
           </div>
           <div className="flex-1 overflow-y-auto px-4">
              {foundUsers.map(u => (
                <div key={u.userId} className="flex items-center justify-between py-3 border-b border-border-subtle/10">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 relative">
                        {u.avatarUrl ? (
                          <Image src={u.avatarUrl} alt={u.name} fill className="object-cover" />
                        ) : (
                          <span className="text-xs font-black text-primary">{u.name[0]}</span>
                        )}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{u.name}</p>
                      <p className="text-xs text-muted">@{u.username}</p>
                    </div>
                  </div>
                  <button onClick={() => handleAddMembers([u.userId])} className="btn-nox bg-primary/10 text-primary text-[10px] font-black px-4 h-8 rounded-lg uppercase">Добавить</button>
                </div>
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

function SharedContent({ type, data }: { type: string, data: SharedMedia | null }) {
  if (!data) return null;
  if (type === "media") {
    const items = data.photos || [];
    if (items.length === 0) return <div className="py-20 text-center text-muted font-bold text-sm italic">Ничего не найдено</div>;
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
  const items = type === "files" ? data.files : data.links;
  if (items.length === 0) return <div className="py-20 text-center text-muted font-bold text-sm italic">Ничего не найдено</div>;
  return (
    <div className="space-y-4 px-2">
      {items.map((item: PhotoItem | AudioItem | FileItem | LinkItem, i: number) => {
        const url = 'url' in item ? item.url : '#';
        const fileName = 'fileName' in item ? item.fileName : ('url' in item ? item.url : 'Link');
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-2 hover:bg-foreground/5 rounded-xl transition-smooth">
             <div className="h-10 w-10 rounded-lg bg-surface-muted flex items-center justify-center text-primary shrink-0">
               {type === "files" ? <FileIcon /> : <LinkIcon />}
             </div>
             <div className="min-w-0 flex-1">
               <p className="text-sm font-bold truncate">{fileName}</p>
               <p className="text-[10px] font-black uppercase text-muted">{new Date(item.createdAt).toLocaleDateString()}</p>
             </div>
          </a>
        );
      })}
    </div>
  );
}

function FileIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>; }
function LinkIcon() { return <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" /></svg>; }
