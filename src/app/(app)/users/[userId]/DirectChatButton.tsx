"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";

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
      className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-smooth hover:bg-primary-hover active:scale-95 fast-tap disabled:opacity-50"
    >
      {pending ? (
        <>
          <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
          Загрузка...
        </>
      ) : (
        <>
          <MessageCircle className="h-5 w-5" strokeWidth={2.1} />
          Написать
        </>
      )}
    </button>
  );
}
