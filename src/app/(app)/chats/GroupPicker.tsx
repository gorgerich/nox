"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

type User = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export function GroupPicker({ onClose, onNavigate }: { onClose: () => void; onNavigate: (chatId: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users/search-by-username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "" })
    })
    .then(r => r.json())
    .then(d => {
        if (d.users) setUsers(d.users);
    })
    .catch(() => {});
  }, []);

  const toggleUser = (id: string) => {
    setSelectedIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
  };

  async function createGroup() {
    if (!title.trim() || selectedIds.size === 0) {
        setError("Введите название группы и выберите участников");
        return;
    }
    setPending(true);
    setError(null);
    try {
        const res = await fetch("/api/chats/group", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ title, memberIds: Array.from(selectedIds) })
        });
        const data = await res.json();
        if (res.ok) {
            onNavigate(data.chat.id);
        } else {
            setError(data.error || "Не удалось создать группу");
        }
    } catch {
        setError("Ошибка сети");
    }
    setPending(false);
  }

  return (
    <div className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-xl p-6 flex flex-col items-center justify-center animate-in fade-in">
        <div className="w-full max-w-md bg-surface rounded-[2rem] p-6 space-y-4">
            <h2 className="text-xl font-black">Новая группа</h2>
            {error && <p className="text-xs text-danger font-bold">{error}</p>}
            <input className="input-nox w-full" placeholder="Название группы" value={title} onChange={e => setTitle(e.target.value)} />
            
            <div className="max-h-60 overflow-y-auto space-y-2">
                {users.map(u => (
                    <div key={u.id} className="flex items-center gap-3 p-2 cursor-pointer" onClick={() => toggleUser(u.id)}>
                        <input type="checkbox" checked={selectedIds.has(u.id)} readOnly className="accent-primary" />
                        <div className="h-8 w-8 rounded-full bg-primary/20 flex items-center justify-center overflow-hidden">
                          {u.avatarUrl ? <Image src={u.avatarUrl} width={32} height={32} alt="" /> : u.displayName[0]}
                        </div>
                        <span>{u.displayName}</span>
                    </div>
                ))}
            </div>

            <button className="btn-nox w-full bg-primary py-3" onClick={createGroup} disabled={pending}>{pending ? "..." : "Создать"}</button>
            <button className="text-muted w-full" onClick={onClose}>Отмена</button>
        </div>
    </div>
  );
}
