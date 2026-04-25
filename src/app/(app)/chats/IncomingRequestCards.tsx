"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  if (!response.ok) {
    throw new Error(data?.error ?? "Не удалось выполнить действие.");
  }

  return data;
}

export function IncomingRequestCards({ requests }: { requests: IncomingRequest[] }) {
  const router = useRouter();
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [pendingAction, setPendingAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const visibleRequests = requests.filter((request) => !hiddenIds.includes(request.id));

  async function acceptRequest(requestId: string) {
    setError("");
    setNotice("");
    setPendingAction(`accept-${requestId}`);

    try {
      const data = await readJson<{ chat: { id: string } }>(`/api/chat-requests/${requestId}/accept`, {
        method: "POST",
      });

      setHiddenIds((current) => [...current, requestId]);
      setNotice("Запрос принят.");
      router.push(`/chats/${data.chat.id}`);
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось принять запрос.");
    } finally {
      setPendingAction("");
    }
  }

  async function declineRequest(requestId: string) {
    setError("");
    setNotice("");
    setPendingAction(`decline-${requestId}`);

    try {
      await readJson(`/api/chat-requests/${requestId}/decline`, {
        method: "POST",
      });

      setHiddenIds((current) => [...current, requestId]);
      setNotice("Запрос отклонён.");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отклонить запрос.");
    } finally {
      setPendingAction("");
    }
  }

  if (visibleRequests.length === 0 && !notice && !error) {
    return null;
  }

  return (
    <div className="mb-8 space-y-4">
      {error ? <p className="text-center text-xs text-red-400 bg-red-400/10 py-2 rounded-lg">{error}</p> : null}
      {notice ? (
        <p className="text-center text-xs text-primary bg-primary/10 py-2 rounded-lg">
          {notice}
        </p>
      ) : null}

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
                <div className="h-12 w-12 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center overflow-hidden border border-primary/20">
                  {fullAvatarUrl ? (
                    <img src={fullAvatarUrl} alt={displayName} className="h-full w-full object-cover" />
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
