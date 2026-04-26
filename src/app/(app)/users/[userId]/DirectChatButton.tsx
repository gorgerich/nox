"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DirectChatButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const handleClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/chats/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/chats/${data.chat.id}`);
      } else {
        alert("Не удалось открыть чат");
        setPending(false);
      }
    } catch {
      alert("Ошибка сети");
      setPending(false);
    }
  };

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className="btn-nox flex-1 bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary-hover fast-tap disabled:opacity-50"
    >
      {pending ? "Загрузка..." : "Написать"}
    </button>
  );
}
