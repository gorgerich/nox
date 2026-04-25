"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

type FoundUser = {
  username: string;
  displayName: string;
  isSelf: boolean;
};

type RequestUser = {
  id: string;
  username: string;
  profile: { displayName: string } | null;
};

type ChatRequestItem = {
  id: string;
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELED";
  message: string | null;
  chatId: string | null;
  createdAt: string;
  respondedAt: string | null;
  fromUser: RequestUser;
  toUser: RequestUser;
};

const statusLabels: Record<ChatRequestItem["status"], string> = {
  PENDING: "Ожидает",
  ACCEPTED: "Принят",
  DECLINED: "Отклонён",
  CANCELED: "Отменён",
};

async function readJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data?.error ?? "Не удалось выполнить действие.");
  }

  return data;
}

function displayUser(user: RequestUser) {
  return user.profile?.displayName ?? user.username;
}

export function NewChatForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState("");
  const [foundUser, setFoundUser] = useState<FoundUser | null>(null);
  const [incoming, setIncoming] = useState<ChatRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<ChatRequestItem[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingAction, setPendingAction] = useState("");

  async function fetchRequests() {
    return readJson<{ incoming: ChatRequestItem[]; outgoing: ChatRequestItem[] }>("/api/chat-requests");
  }

  async function loadRequests() {
    const data = await fetchRequests();
    setIncoming(data.incoming);
    setOutgoing(data.outgoing);
  }

  useEffect(() => {
    let active = true;

    async function loadInitialRequests() {
      try {
        const data = await fetchRequests();
        if (!active) return;
        setIncoming(data.incoming);
        setOutgoing(data.outgoing);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить запросы.");
        }
      }
    }

    void loadInitialRequests();
    return () => { active = false; };
  }, []);

  async function searchUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setFoundUser(null);

    if (!username.trim()) {
      setError("Введите username.");
      return;
    }

    setPendingAction("search");

    try {
      const data = await readJson<{ user: FoundUser }>("/api/users/search-by-username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username }),
      });
      setFoundUser(data.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Пользователь не найден.");
    } finally {
      setPendingAction("");
    }
  }

  async function sendRequest() {
    if (!foundUser) return;
    setError("");
    setNotice("");
    setPendingAction("send-request");

    try {
      await readJson("/api/chat-requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          targetUsername: foundUser.username,
          message: message.trim() || undefined,
        }),
      });
      setNotice("Запрос отправлен.");
      setMessage("");
      setFoundUser(null);
      await loadRequests();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось отправить запрос.");
    } finally {
      setPendingAction("");
    }
  }

  async function respondToRequest(requestId: string, action: "accept" | "decline" | "cancel") {
    setError("");
    setNotice("");
    setPendingAction(`${action}-${requestId}`);

    try {
      const data = await readJson<{ chat?: { id: string } }>(`/api/chat-requests/${requestId}/${action}`, {
        method: "POST",
      });

      if (action === "accept" && data.chat?.id) {
        setNotice("Личный чат создан.");
        router.push(`/chats/${data.chat.id}`);
        router.refresh();
        return;
      }

      setNotice(action === "decline" ? "Запрос отклонён." : "Запрос отменён.");
      await loadRequests();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить действие.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <form className="flex gap-2" onSubmit={searchUser} method="POST">
          <input
            className="input-nox h-12"
            maxLength={32}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username пользователя"
            value={username}
          />
          <button
            className="btn-primary h-12 flex items-center justify-center shrink-0"
            disabled={pendingAction !== ""}
            type="submit"
          >
            {pendingAction === "search" ? "..." : "Найти"}
          </button>
        </form>

        {error ? <p className="text-center text-xs text-red-400 py-2">{error}</p> : null}
        {notice ? <p className="text-center text-xs text-primary py-2">{notice}</p> : null}

        {foundUser && (
          <div className="card-clean animate-in fade-in slide-in-from-top-4 duration-300 p-6">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-bold text-primary">
                {foundUser.displayName.slice(0, 1).toUpperCase()}
              </div>
              <h2 className="text-xl font-bold">{foundUser.displayName}</h2>
              <p className="text-sm text-muted">@{foundUser.username}</p>
            </div>

            {foundUser.isSelf ? (
              <p className="mt-6 text-center text-xs text-red-400">Это вы.</p>
            ) : (
              <div className="mt-6 space-y-4">
                <textarea
                  className="input-nox min-h-24 resize-none py-3"
                  maxLength={500}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Сообщение к запросу (необязательно)"
                  value={message}
                />
                <button
                  className="btn-primary w-full"
                  disabled={pendingAction !== ""}
                  onClick={sendRequest}
                  type="button"
                >
                  {pendingAction === "send-request" ? "..." : "Отправить запрос"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-8 sm:grid-cols-2">
        <section className="space-y-4">
          <h2 className="px-2 text-xs font-bold uppercase tracking-widest text-muted">Входящие</h2>
          <div className="space-y-3">
            {incoming.length === 0 ? (
              <p className="px-2 text-sm text-muted italic">Нет запросов.</p>
            ) : (
              incoming.map((item) => (
                <RequestCard key={item.id} request={item} user={item.fromUser}>
                  {item.status === "PENDING" && (
                    <div className="mt-3 flex gap-2">
                      <button
                        className="h-8 flex-1 rounded-lg bg-primary text-[10px] font-bold text-neutral-950 transition active:scale-95 disabled:opacity-50"
                        disabled={pendingAction !== ""}
                        onClick={() => respondToRequest(item.id, "accept")}
                        type="button"
                      >
                        {pendingAction === `accept-${item.id}` ? "..." : "Принять"}
                      </button>
                      <button
                        className="h-8 flex-1 rounded-lg bg-surface-hover border border-border-subtle text-[10px] font-bold transition active:scale-95 disabled:opacity-50"
                        disabled={pendingAction !== ""}
                        onClick={() => respondToRequest(item.id, "decline")}
                        type="button"
                      >
                        {pendingAction === `decline-${item.id}` ? "..." : "Отклонить"}
                      </button>
                    </div>
                  )}
                </RequestCard>
              ))
            )}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="px-2 text-xs font-bold uppercase tracking-widest text-muted">Исходящие</h2>
          <div className="space-y-3">
            {outgoing.length === 0 ? (
              <p className="px-2 text-sm text-muted italic">Нет запросов.</p>
            ) : (
              outgoing.map((item) => (
                <RequestCard key={item.id} request={item} user={item.toUser}>
                  {item.status === "PENDING" && (
                    <button
                      className="mt-3 h-8 w-full rounded-lg bg-surface-hover border border-border-subtle text-[10px] font-bold transition active:scale-95 disabled:opacity-50"
                      disabled={pendingAction !== ""}
                      onClick={() => respondToRequest(item.id, "cancel")}
                      type="button"
                    >
                      {pendingAction === `cancel-${item.id}` ? "..." : "Отменить запрос"}
                    </button>
                  )}
                </RequestCard>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function RequestCard({
  children,
  request,
  user,
}: {
  children: ReactNode;
  request: ChatRequestItem;
  user: RequestUser;
}) {
  return (
    <article className="card-clean p-4 transition-colors hover:border-primary/20">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{displayUser(user)}</h3>
          <p className="truncate text-xs text-muted">@{user.username}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-tighter ${
          request.status === "PENDING" ? "bg-primary/10 text-primary" : "bg-surface-hover text-muted"
        }`}>
          {statusLabels[request.status]}
        </span>
      </div>
      {request.message && (
        <p className="mt-2 text-xs text-muted line-clamp-2">&ldquo;{request.message}&rdquo;</p>
      )}
      {children}
    </article>
  );
}
