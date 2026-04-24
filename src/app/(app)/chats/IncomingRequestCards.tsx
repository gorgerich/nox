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

function formatRequestDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
    <section className="mt-5 grid gap-3">
      {visibleRequests.length > 0 ? (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3">
          <h2 className="text-base font-semibold text-emerald-100">Запросы на общение</h2>
          <p className="mt-1 text-sm text-emerald-200">
            {visibleRequests.length === 1
              ? "У вас новый запрос на общение"
              : `Новые запросы на общение: ${visibleRequests.length}`}
          </p>
        </div>
      ) : null}

      {error ? <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
      {notice ? (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {visibleRequests.map((request) => {
        const displayName = request.fromUser.profile?.displayName ?? request.fromUser.username;

        return (
          <article
            className="rounded-md border border-emerald-500/40 bg-neutral-950 p-4 shadow-[0_0_0_1px_rgba(16,185,129,0.08)]"
            key={request.id}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-300">Новый запрос</p>
                <h3 className="mt-1 truncate text-base font-semibold text-neutral-100">{displayName}</h3>
                <p className="mt-1 truncate text-sm text-neutral-400">@{request.fromUser.username}</p>
              </div>
              <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-200">
                Запрос
              </span>
            </div>

            <p className="mt-3 text-sm leading-6 text-neutral-300">Хочет начать с вами личный чат</p>
            {request.message ? (
              <p className="mt-2 whitespace-pre-wrap rounded-md bg-neutral-900 p-3 text-sm leading-6 text-neutral-300">
                {request.message}
              </p>
            ) : null}
            <p className="mt-3 text-sm text-neutral-500">{formatRequestDate(request.createdAt)}</p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="min-h-10 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pendingAction !== ""}
                onClick={() => acceptRequest(request.id)}
                type="button"
              >
                {pendingAction === `accept-${request.id}` ? "Принимаем..." : "Принять"}
              </button>
              <button
                className="min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pendingAction !== ""}
                onClick={() => declineRequest(request.id)}
                type="button"
              >
                {pendingAction === `decline-${request.id}` ? "Отклоняем..." : "Отклонить"}
              </button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
