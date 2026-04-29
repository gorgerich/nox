"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

type FoundUser = {
  id: string;
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
    <div className="space-y-12 transition-smooth">
      <div className="space-y-4">
        <form className="flex gap-2" onSubmit={searchUser} method="POST">
          <input
            className="input-nox h-14"
            maxLength={32}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="Username пользователя"
            value={username}
          />
          <button
            className="btn-nox h-14 px-6 bg-primary text-primary-foreground font-black shrink-0"
            disabled={pendingAction !== ""}
            type="submit"
          >
            {pendingAction === "search" ? "..." : "НАЙТИ"}
          </button>
        </form>

        {error ? <p className="text-center text-xs font-black text-red-400 py-2 animate-in fade-in">{error}</p> : null}
        {notice ? <p className="text-center text-xs font-black text-primary py-2 animate-in fade-in">{notice}</p> : null}

        {foundUser && (
          <div className="card-premium animate-in fade-in slide-in-from-top-4 duration-300 p-8 shadow-2xl shadow-primary/5">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-[2rem] bg-primary/10 text-2xl font-black text-primary shadow-inner border border-primary/20">
                {foundUser.displayName.slice(0, 1).toUpperCase()}
              </div>
              <h2 className="text-2xl font-black tracking-tight">{foundUser.displayName}</h2>
              <p className="text-sm font-medium text-muted/60">@{foundUser.username}</p>
            </div>

            {foundUser.isSelf ? (
              <div className="mt-8 space-y-6">
                <p className="text-center text-xs font-bold text-muted/80">Сообщения самому себе</p>
                <button
                  className="btn-nox w-full bg-primary h-14 text-sm font-black text-neutral-950 shadow-lg shadow-primary/20 transition-smooth active:scale-95 fast-tap"
                  disabled={pendingAction !== ""}
                  onClick={async () => {
                    setPendingAction("start-self");
                    try {
                      const response = await readJson<{ chat: { id: string } }>("/api/chats/direct", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ userId: foundUser.id })
                      });
                      if (response.chat) {
                        router.push(`/chats/${response.chat.id}`);
                        router.refresh();
                      }
                    } catch(reason) {
                      setError(reason instanceof Error ? reason.message : "Не удалось открыть чат");
                    } finally {
                      setPendingAction("");
                    }
                  }}
                  type="button"
                >
                  {pendingAction === "start-self" ? "..." : "ОТКРЫТЬ ИЗБРАННОЕ"}
                </button>
              </div>
            ) : (
              <div className="mt-8 space-y-6">
                <textarea
                  className="input-nox min-h-24 resize-none py-4 font-medium"
                  maxLength={500}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Сообщение к запросу (необязательно)"
                  value={message}
                />
                <button
                  className="btn-nox w-full bg-primary h-14 text-sm font-black text-neutral-950 shadow-lg shadow-primary/20 transition-smooth active:scale-95"
                  disabled={pendingAction !== ""}
                  onClick={sendRequest}
                  type="button"
                >
                  {pendingAction === "send-request" ? "..." : "ОТПРАВИТЬ ЗАПРОС"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-10 sm:grid-cols-2 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
        <section className="space-y-6">
          <h2 className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted/50">Входящие запросы</h2>
          <div className="space-y-4">
            {incoming.length === 0 ? (
              <p className="px-2 text-sm text-muted/40 italic font-medium">Запросов пока нет</p>
            ) : (
              incoming.map((item) => (
                <RequestCard key={item.id} request={item} user={item.fromUser}>
                  {item.status === "PENDING" && (
                    <div className="mt-4 flex gap-3">
                      <button
                        className="btn-nox h-11 flex-1 rounded-xl bg-primary text-[10px] font-black text-neutral-950 transition-smooth active:scale-95 shadow-sm shadow-primary/20"
                        disabled={pendingAction !== ""}
                        onClick={() => respondToRequest(item.id, "accept")}
                        type="button"
                      >
                        {pendingAction === `accept-${item.id}` ? "..." : "ПРИНЯТЬ"}
                      </button>
                      <button
                        className="btn-nox h-11 flex-1 rounded-xl bg-surface-hover border border-border-subtle text-[10px] font-black transition-smooth active:scale-95"
                        disabled={pendingAction !== ""}
                        onClick={() => respondToRequest(item.id, "decline")}
                        type="button"
                      >
                        {pendingAction === `decline-${item.id}` ? "..." : "ОТКЛОНИТЬ"}
                      </button>
                    </div>
                  )}
                </RequestCard>
              ))
            )}
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="px-1 text-[10px] font-black uppercase tracking-[0.2em] text-muted/50">Ваши запросы</h2>
          <div className="space-y-4">
            {outgoing.length === 0 ? (
              <p className="px-2 text-sm text-muted/40 italic font-medium">Вы не отправляли запросов</p>
            ) : (
              outgoing.map((item) => (
                <RequestCard key={item.id} request={item} user={item.toUser}>
                  {item.status === "PENDING" && (
                    <button
                      className="btn-nox mt-4 h-11 w-full rounded-xl bg-surface-hover border border-border-subtle text-[10px] font-black transition-smooth active:scale-95 text-red-400"
                      disabled={pendingAction !== ""}
                      onClick={() => respondToRequest(item.id, "cancel")}
                      type="button"
                    >
                      {pendingAction === `cancel-${item.id}` ? "..." : "ОТМЕНИТЬ ЗАПРОС"}
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
    <article className="card-premium p-5 transition-smooth hover:border-primary/30 group">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-black tracking-tight">{displayUser(user)}</h3>
          <p className="truncate text-xs font-medium text-muted/60 tracking-wider">@{user.username}</p>
        </div>
        <span className={`shrink-0 rounded-lg px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] ${
          request.status === "PENDING" ? "bg-primary/10 text-primary border border-primary/20" : "bg-surface-hover text-muted border border-border-subtle/50"
        }`}>
          {statusLabels[request.status]}
        </span>
      </div>
      {request.message && (
        <div className="mt-4 rounded-xl bg-background/30 p-3 border border-border-subtle/20 italic">
          <p className="text-xs text-muted/80 leading-relaxed">&ldquo;{request.message}&rdquo;</p>
        </div>
      )}
      {children}
    </article>
  );
}
