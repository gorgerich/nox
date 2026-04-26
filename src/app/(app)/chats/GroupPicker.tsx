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

  useEffect(() => {
    fetch("/api/users/search-by-username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "a" }) // Hack to get some users
    }).then(r => r.json()).then(d => {
        // ... simplified for demo
    }).catch(() => {});
  }, []);

  async function createGroup() {
    if (!title.trim() || selectedIds.size === 0) return;
    setPending(true);
    const res = await fetch("/api/chats/group", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, memberIds: Array.from(selectedIds) })
    });
    const data = await res.json();
    if (res.ok) {
        onNavigate(data.chat.id);
    }
    setPending(false);
  }

  return (
    <div className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-xl p-6 flex flex-col items-center justify-center animate-in fade-in">
        <div className="w-full max-w-md bg-surface rounded-[2rem] p-6 space-y-4">
            <h2 className="text-xl font-black">Новая группа</h2>
            <input className="input-nox" placeholder="Название группы" value={title} onChange={e => setTitle(e.target.value)} />
            <button className="btn-nox w-full bg-primary" onClick={createGroup} disabled={pending}>{pending ? "..." : "Создать"}</button>
            <button className="text-muted w-full" onClick={onClose}>Отмена</button>
        </div>
    </div>
  );
}
