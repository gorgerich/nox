"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type IncomingRequest = {
  id: string;
  message: string | null;
  createdAt: string;
  fromUser: {
    username: string;
    profile: { displayName: string } | null;
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

        return (
          <article
            className="card-clean border-primary/20 bg-primary/5 p-4"
            key={request.id}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Новый запрос</p>
                <h3 className="truncate font-semibold">{displayName}</h3>
              </div>
              <div className="flex gap-2">
                <button
                  className="h-8 rounded-lg bg-primary px-3 text-xs font-bold text-neutral-950 transition active:scale-95 disabled:opacity-50"
                  disabled={pendingAction !== ""}
                  onClick={() => acceptRequest(request.id)}
                  type="button"
                >
                  {pendingAction === `accept-${request.id}` ? "..." : "Принять"}
                </button>
                <button
                  className="h-8 rounded-lg bg-surface border border-border-subtle px-3 text-xs font-bold transition active:scale-95 disabled:opacity-50"
                  disabled={pendingAction !== ""}
                  onClick={() => declineRequest(request.id)}
                  type="button"
                >
                  {pendingAction === `decline-${request.id}` ? "..." : "Пропустить"}
                </button>
              </div>
            </div>
            {request.message && (
              <p className="mt-3 text-sm text-muted line-clamp-2">
                &ldquo;{request.message}&rdquo;
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
