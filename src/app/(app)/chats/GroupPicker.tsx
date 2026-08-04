"use client";

import { useState, useEffect, FormEvent } from "react";
import { useFocusTrap } from "@/lib/use-focus-trap";
import Image from "next/image";
import { Search, UsersRound } from "lucide-react";
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

  const dialogRef = useFocusTrap<HTMLDivElement>(true);

  return (
    <div ref={dialogRef} className="fixed inset-0 z-[500] flex flex-col items-center justify-center bg-black/45 p-4 backdrop-blur-sm animate-in fade-in transition-smooth sm:p-6" role="dialog" aria-modal="true" aria-labelledby="new-group-title">
        <div className="premium-glass flex max-h-full w-full max-w-md flex-col space-y-5 overflow-hidden rounded-[1.75rem] p-5">
            <div className="shrink-0 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/12 text-primary">
                <UsersRound className="h-6 w-6" strokeWidth={1.9} />
              </div>
              <h2 id="new-group-title" className="text-2xl font-semibold tracking-tight text-foreground">Новая группа</h2>
              <p className="mt-1 text-sm text-muted">Выберите участников и задайте название.</p>
            </div>
            
            {error && (
              <p className="rounded-2xl border border-danger/15 bg-danger/10 px-4 py-3 text-center text-sm font-medium text-danger shrink-0">
                {error}
              </p>
            )}
            
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
                  <button type="submit" className="fast-tap flex h-12 items-center justify-center rounded-full px-4 bg-surface-elevated text-sm font-semibold shrink-0 border border-border-subtle transition-smooth active:scale-[0.96] disabled:opacity-50" disabled={pending} aria-label="Найти пользователя">
                      <Search className="h-4 w-4" strokeWidth={2.2} />
                  </button>
              </form>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1 min-h-32 border border-border-subtle/50 rounded-2xl p-2 bg-surface-muted/25">
                {displayUsers.size === 0 && (
                    <div className="flex flex-col items-center justify-center px-4 py-8 text-center">
                      <UsersRound className="mb-3 h-8 w-8 text-muted/55" strokeWidth={1.7} />
                      <p className="text-sm font-medium text-muted">Контактов пока нет</p>
                      <p className="mt-1 text-xs leading-5 text-muted/70">Найдите пользователя по username.</p>
                    </div>
                )}
                {Array.from(displayUsers.values()).map(u => {
                    const isSelected = selectedUsers.has(u.id);
                    const fullAvatarUrl = normalizeAvatarUrl(u.avatarUrl);

  return (
                      <button
                          type="button"
                          key={u.id} 
                          aria-pressed={isSelected}
                          className={`flex w-full items-center justify-between rounded-2xl border p-3 text-left transition-smooth fast-tap ${isSelected ? "bg-primary/10 border-primary/30" : "hover:bg-surface-elevated border-transparent"}`}
                          onClick={() => toggleUser(u)}
                      >
                          <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-full bg-primary/12 flex items-center justify-center overflow-hidden shrink-0 text-primary font-semibold relative">
                                {fullAvatarUrl ? <Image src={fullAvatarUrl} alt={u.displayName} fill className="object-cover" /> : u.displayName[0]?.toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                  <p className="truncate text-sm font-bold text-foreground">{u.displayName}</p>
                                  <p className="truncate text-xs font-medium text-muted">@{u.username}</p>
                              </div>
                          </div>
                          <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-smooth ${isSelected ? "bg-primary border-primary" : "border-border-subtle"}`}>
                              {isSelected && <svg className="h-4 w-4 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                          </div>
                      </button>
                    );
                })}
            </div>

            <div className="shrink-0 space-y-3 pt-2">
              <button 
                  type="button"
                  className="fast-tap w-full bg-primary h-12 rounded-full text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-50"
                  onClick={createGroup} 
                  disabled={pending || !title.trim() || selectedUsers.size === 0}
              >
                  {pending ? "Создаём" : `Создать (${selectedUsers.size})`}
              </button>
              <button 
                  type="button"
                  className="w-full h-11 text-sm font-semibold text-muted transition-smooth hover:text-foreground active:scale-[0.96] fast-tap"
                  onClick={onClose}
              >
                  Отмена
              </button>
            </div>
        </div>
    </div>
  );
}
