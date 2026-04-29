"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { normalizeAvatarUrl } from "@/lib/media-url";

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

export function IncomingRequestCards({
  requests,
  onChange,
}: {
  requests: IncomingRequest[];
  onChange?: () => void;
}) {
  const [hiddenRequestIds, setHiddenRequestIds] = useState<Set<string>>(new Set());
  const visibleRequests = useMemo(
    () => requests.filter((request) => !hiddenRequestIds.has(request.id)),
    [hiddenRequestIds, requests],
  );

  async function acceptRequest(id: string) {
    setHiddenRequestIds((current) => new Set(current).add(id));
    try {
      await readJson(`/api/chat-requests/${id}/accept`, { method: "POST" });
      onChange?.();
    } catch (e) {
      setHiddenRequestIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      alert(e instanceof Error ? e.message : "Не удалось принять запрос");
    }
  }

  async function declineRequest(id: string) {
    setHiddenRequestIds((current) => new Set(current).add(id));
    try {
      await readJson(`/api/chat-requests/${id}/decline`, { method: "POST" });
      onChange?.();
    } catch (e) {
      setHiddenRequestIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      alert(e instanceof Error ? e.message : "Не удалось отклонить запрос");
    }
  }

  if (visibleRequests.length === 0) return null;

  return (
    <div className="space-y-4">
      {visibleRequests.map((request) => {
        const displayName = request.fromUser.profile?.displayName ?? request.fromUser.username;
        const avatarUrl = request.fromUser.profile?.avatarUrl;
        const fullAvatarUrl = normalizeAvatarUrl(avatarUrl);

        return (
          <article
            className="card-premium border-primary/20 bg-primary/5 p-4 transition-smooth"
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
                  className="h-10 rounded-xl bg-primary px-4 text-xs font-black text-neutral-950 transition-smooth active:scale-[0.97] shadow-lg shadow-primary/20"
                  onClick={() => acceptRequest(request.id)}
                  type="button"
                >
                  ПРИНЯТЬ
                </button>
                <button
                  className="h-10 rounded-xl bg-surface/50 border border-border-subtle px-4 text-xs font-black text-muted transition-smooth active:scale-[0.97] hover:bg-surface"
                  onClick={() => declineRequest(request.id)}
                  type="button"
                >
                  ПРОПУСТИТЬ
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
