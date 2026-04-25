"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type IncomingRequest = {
  id: string;
  message: string | null;
  createdAt: string;
  fromUser: {
    username: string;
    profile: { 
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
};

async function readJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "Ошибка.");
  return data;
}

export function IncomingRequestCards({ requests }: { requests: IncomingRequest[] }) {
  const router = useRouter();
  const [visibleRequests, setVisibleRequests] = useState(requests);
  const [pendingAction, setPendingAction] = useState("");

  async function acceptRequest(id: string) {
    setPendingAction(`accept-${id}`);
    try {
      await readJson(`/api/chat-requests/${id}/accept`, { method: "POST" });
      setVisibleRequests((curr) => curr.filter((r) => r.id !== id));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось принять запрос");
    } finally {
      setPendingAction("");
    }
  }

  async function declineRequest(id: string) {
    setPendingAction(`decline-${id}`);
    try {
      await readJson(`/api/chat-requests/${id}/decline`, { method: "POST" });
      setVisibleRequests((curr) => curr.filter((r) => r.id !== id));
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не удалось отклонить запрос");
    } finally {
      setPendingAction("");
    }
  }

  if (visibleRequests.length === 0) return null;

  return (
    <div className="space-y-4">
      {visibleRequests.map((request) => {
        const displayName = request.fromUser.profile?.displayName ?? request.fromUser.username;
        const avatarUrl = request.fromUser.profile?.avatarUrl;
        const fullAvatarUrl = avatarUrl 
          ? (avatarUrl.startsWith('http') ? avatarUrl : `/api/avatars/${avatarUrl}`)
          : null;

        return (
          <article
            className="card-premium border-primary/20 bg-primary/5 p-4"
            key={request.id}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-12 w-12 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden border border-primary/20 relative">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt={displayName} fill className="object-cover" />
                  ) : (
                    <span className="text-lg font-black text-primary">{displayName[0]?.toUpperCase()}</span>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-primary/70">Новый запрос</p>
                  <h3 className="truncate font-black tracking-tight text-foreground">{displayName}</h3>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  className="h-10 rounded-xl bg-primary px-4 text-xs font-black text-neutral-950 transition active:scale-95 disabled:opacity-50 shadow-lg shadow-primary/20"
                  disabled={pendingAction !== ""}
                  onClick={() => acceptRequest(request.id)}
                  type="button"
                >
                  {pendingAction === `accept-${request.id}` ? "..." : "ПРИНЯТЬ"}
                </button>
                <button
                  className="h-10 rounded-xl bg-surface/50 border border-border-subtle px-4 text-xs font-black text-muted transition active:scale-95 disabled:opacity-50 hover:bg-surface"
                  disabled={pendingAction !== ""}
                  onClick={() => declineRequest(request.id)}
                  type="button"
                >
                  {pendingAction === `decline-${request.id}` ? "..." : "ПРОПУСТИТЬ"}
                </button>
              </div>
            </div>
            {request.message && (
              <div className="mt-4 rounded-xl bg-background/50 p-3 border border-border-subtle/30">
                <p className="text-sm text-muted-foreground leading-relaxed italic">
                  &ldquo;{request.message}&rdquo;
                </p>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
