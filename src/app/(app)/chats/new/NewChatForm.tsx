"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Clock3, Search } from "lucide-react";

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
    <div className="space-y-5 transition-smooth">
      <div>
        <form className="flex items-center gap-2" onSubmit={searchUser} method="POST">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" strokeWidth={2.1} />
            <input
              className="h-12 w-full rounded-full border border-border-subtle bg-input px-11 text-[16px] font-medium outline-none transition-smooth placeholder:text-muted/55 focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
              maxLength={32}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="@username"
              value={username}
            />
          </div>
          <button
            className="fast-tap flex h-12 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
            disabled={pendingAction !== ""}
            type="submit"
          >
            {pendingAction === "search" ? "Ищем" : "Найти"}
          </button>
        </form>

        {error ? <p className="px-3 pt-3 text-sm font-semibold text-danger animate-in fade-in">{error}</p> : null}
        {notice ? <p className="px-3 pt-3 text-sm font-semibold text-primary animate-in fade-in">{notice}</p> : null}

        {foundUser && (
          <div className="mt-3 animate-in fade-in slide-in-from-top-2 duration-200 rounded-[1.5rem] border border-border-subtle bg-surface/70 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-bold text-primary-foreground">
                {foundUser.displayName.slice(0, 1).toLocaleUpperCase("ru-RU")}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[17px] font-semibold tracking-tight">{foundUser.displayName}</h2>
                <p className="truncate text-sm text-muted">@{foundUser.username}</p>
              </div>
            </div>

            {foundUser.isSelf ? (
              <div className="mt-4 space-y-3">
                <p className="px-1 text-sm text-muted">Это ваш профиль. Можно открыть избранное.</p>
                <button
                  className="fast-tap flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
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
                  {pendingAction === "start-self" ? "Открываем" : "Открыть избранное"}
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                <textarea
                  className="min-h-24 w-full resize-none rounded-2xl border border-border-subtle bg-background/70 px-4 py-3 text-sm font-medium outline-none transition-smooth placeholder:text-muted/55 focus:border-primary/35 focus:ring-2 focus:ring-primary/15"
                  maxLength={500}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Сообщение к запросу (необязательно)"
                  value={message}
                />
                <button
                  className="fast-tap flex h-12 w-full items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
                  disabled={pendingAction !== ""}
                  onClick={sendRequest}
                  type="button"
                >
                  {pendingAction === "send-request" ? "Отправляем" : "Отправить запрос"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 animate-in fade-in slide-in-from-bottom-4 duration-180 sm:grid-cols-2">
        <section className="space-y-3">
          <h2 className="px-1 text-[13px] font-semibold text-muted">Входящие запросы</h2>
          <div className="overflow-hidden border-y border-border-subtle bg-surface/60 sm:rounded-[1.5rem] sm:border">
            {incoming.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">Запросов пока нет</p>
            ) : (
              incoming.map((item) => (
                <RequestCard key={item.id} request={item} user={item.fromUser}>
                  {item.status === "PENDING" && (
                    <div className="mt-4 flex gap-3">
                      <button
                        className="fast-tap flex h-10 flex-1 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
                        disabled={pendingAction !== ""}
                        onClick={() => respondToRequest(item.id, "accept")}
                        type="button"
                      >
                        {pendingAction === `accept-${item.id}` ? "Принимаем" : "Принять"}
                      </button>
                      <button
                        className="fast-tap flex h-10 flex-1 items-center justify-center rounded-full border border-border-subtle bg-background text-sm font-semibold text-foreground transition-smooth active:scale-[0.96] disabled:opacity-45"
                        disabled={pendingAction !== ""}
                        onClick={() => respondToRequest(item.id, "decline")}
                        type="button"
                      >
                        {pendingAction === `decline-${item.id}` ? "Отклоняем" : "Отклонить"}
                      </button>
                    </div>
                  )}
                </RequestCard>
              ))
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="px-1 text-[13px] font-semibold text-muted">Ваши запросы</h2>
          <div className="overflow-hidden border-y border-border-subtle bg-surface/60 sm:rounded-[1.5rem] sm:border">
            {outgoing.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">Вы не отправляли запросов</p>
            ) : (
              outgoing.map((item) => (
                <RequestCard key={item.id} request={item} user={item.toUser}>
                  {item.status === "PENDING" && (
                    <button
                      className="fast-tap mt-3 flex h-10 w-full items-center justify-center rounded-full border border-border-subtle bg-background text-sm font-semibold text-danger transition-smooth active:scale-[0.96] disabled:opacity-45"
                      disabled={pendingAction !== ""}
                      onClick={() => respondToRequest(item.id, "cancel")}
                      type="button"
                    >
                      {pendingAction === `cancel-${item.id}` ? "Отменяем" : "Отменить запрос"}
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
    <article className="border-b border-border-subtle px-4 py-3 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
            {displayUser(user).slice(0, 1).toLocaleUpperCase("ru-RU")}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold tracking-tight">{displayUser(user)}</h3>
            <p className="truncate text-[13px] text-muted">@{user.username}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold ${
          request.status === "PENDING" ? "bg-primary/10 text-primary" : "bg-foreground/5 text-muted"
        }`}>
          {request.status === "PENDING" ? <Clock3 className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          {statusLabels[request.status]}
        </span>
      </div>
      {request.message && (
        <div className="mt-3 rounded-2xl bg-background px-3 py-2">
          <p className="text-[13px] leading-relaxed text-muted">&ldquo;{request.message}&rdquo;</p>
        </div>
      )}
      {children}
    </article>
  );
}
