"use client";

import { useState, useEffect, FormEvent } from "react";
import Image from "next/image";
import { normalizeAvatarUrl } from "@/lib/media-url";

type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export function GroupPicker({ onClose, onNavigate }: { onClose: () => void; onNavigate: (chatId: string) => void }) {
  const [contacts, setContacts] = useState<User[]>([]);
  const [searchUsername, setSearchUsername] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<Map<string, User>>(new Map());
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetch direct chats to populate the contacts list
    fetch("/api/chats")
      .then(r => r.json())
      .then(d => {
        if (d.chats) {
          const directChats = d.chats.filter((c: { type: string, otherMember: User }) => c.type === "DIRECT" && c.otherMember);
          const users = directChats.map((c: { otherMember: User }) => ({
            id: c.otherMember.id,
            username: c.otherMember.username,
            displayName: c.otherMember.displayName,
            avatarUrl: c.otherMember.avatarUrl,
          }));
          // Remove duplicates
          const uniqueUsers = Array.from(new Map(users.map((u: User) => [u.id, u])).values()) as User[];
          setContacts(uniqueUsers);
        }
      })
      .catch(() => {});
  }, []);

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault();
    if (!searchUsername.trim()) return;
    setError(null);
    setPending(true);

    try {
      const res = await fetch("/api/users/search-by-username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: searchUsername.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.user) {
        if (data.user.isSelf) {
            setError("Нельзя добавить себя в участники (вы уже там).");
        } else {
            toggleUser(data.user);
            setSearchUsername("");
        }
      } else {
        setError(data.error || "Пользователь не найден.");
      }
    } catch {
      setError("Ошибка поиска.");
    }
    setPending(false);
  };

  const toggleUser = (user: User) => {
    setSelectedUsers(prev => {
        const next = new Map(prev);
        if (next.has(user.id)) {
            next.delete(user.id);
        } else {
            next.set(user.id, user);
        }
        return next;
    });
  };

  async function createGroup() {
    if (!title.trim() || selectedUsers.size === 0) {
        setError("Введите название группы и выберите участников.");
        return;
    }
    setPending(true);
    setError(null);
    try {
        const res = await fetch("/api/chats/group", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title: title.trim(), memberIds: Array.from(selectedUsers.keys()) })
        });
        const data = await res.json();
        if (res.ok) {
            onNavigate(data.chat.id);
        } else {
            setError(data.error || "Не удалось создать группу");
            setPending(false);
        }
    } catch {
        setError("Ошибка сети");
        setPending(false);
    }
  }

  // Determine which users to show in the list (combine contacts and selected users not in contacts)
  const displayUsers = new Map<string, User>();
  contacts.forEach(c => displayUsers.set(c.id, c));
  selectedUsers.forEach((u, id) => {
      if (!displayUsers.has(id)) displayUsers.set(id, u);
  });

  return (
    <div className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-xl p-4 sm:p-6 flex flex-col items-center justify-center animate-in fade-in transition-smooth">
        <div className="w-full max-w-md bg-surface rounded-[2rem] p-6 space-y-6 shadow-2xl overflow-hidden flex flex-col max-h-full">
            <div className="shrink-0 text-center">
              <h2 className="text-2xl font-black text-foreground">Новая группа</h2>
            </div>
            
            {error && <p className="text-center text-xs font-bold text-red-400 shrink-0">{error}</p>}
            
            <div className="shrink-0 space-y-4">
              <input 
                  className="input-nox w-full h-14" 
                  placeholder="Название группы" 
                  value={title} 
                  onChange={e => setTitle(e.target.value)} 
                  maxLength={64}
              />
              
              <form onSubmit={handleSearch} className="flex gap-2">
                  <input 
                      className="input-nox w-full h-12 text-sm" 
                      placeholder="Добавить по username" 
                      value={searchUsername} 
                      onChange={e => setSearchUsername(e.target.value)} 
                  />
                  <button type="submit" className="btn-nox h-12 px-4 bg-surface-elevated text-xs font-bold shrink-0 border border-border-subtle" disabled={pending}>
                      НАЙТИ
                  </button>
              </form>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2 min-h-32 border border-border-subtle/50 rounded-2xl p-2 bg-surface-muted/30">
                {displayUsers.size === 0 && (
                    <p className="text-center text-xs text-muted font-medium p-4 italic">Нет доступных контактов. Найдите пользователей по username.</p>
                )}
                {Array.from(displayUsers.values()).map(u => {
                    const isSelected = selectedUsers.has(u.id);
                    const fullAvatarUrl = normalizeAvatarUrl(u.avatarUrl);
                    return (
                      <div 
                          key={u.id} 
                          className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-smooth fast-tap border ${isSelected ? "bg-primary/10 border-primary/30" : "bg-surface hover:bg-surface-elevated border-transparent"}`} 
                          onClick={() => toggleUser(u)}
                      >
                          <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden shrink-0 text-primary font-black relative">
                                {fullAvatarUrl ? <Image src={fullAvatarUrl} alt={u.displayName} fill className="object-cover" /> : u.displayName[0]?.toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-foreground">{u.displayName}</p>
                                  <p className="truncate text-xs font-medium text-muted">@{u.username}</p>
                              </div>
                          </div>
                          <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-smooth ${isSelected ? "bg-primary border-primary" : "border-border-subtle"}`}>
                              {isSelected && <svg className="h-4 w-4 text-neutral-950" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                          </div>
                      </div>
                    );
                })}
            </div>

            <div className="shrink-0 space-y-3 pt-2">
              <button 
                  className="btn-nox w-full bg-primary h-14 rounded-2xl text-sm font-black text-neutral-950 shadow-lg shadow-primary/20 transition-smooth active:scale-95 disabled:opacity-50 fast-tap" 
                  onClick={createGroup} 
                  disabled={pending || !title.trim() || selectedUsers.size === 0}
              >
                  {pending ? "СОЗДАНИЕ..." : `СОЗДАТЬ (${selectedUsers.size})`}
              </button>
              <button 
                  className="w-full h-12 text-xs font-black uppercase tracking-widest text-muted transition-smooth hover:text-foreground active:scale-95 fast-tap" 
                  onClick={onClose}
              >
                  Отмена
              </button>
            </div>
        </div>
    </div>
  );
}
