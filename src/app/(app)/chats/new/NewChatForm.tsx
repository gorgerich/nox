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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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

        if (!active) {
          return;
        }

        setIncoming(data.incoming);
        setOutgoing(data.outgoing);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить запросы.");
        }
      }
    }

    void loadInitialRequests();

    return () => {
      active = false;
    };
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
    if (!foundUser) {
      return;
    }

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
    <div className="grid gap-6">
      <form className="grid gap-4" onSubmit={searchUser}>
        <label className="block text-sm font-medium">
          Username пользователя
          <input
            className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-base text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-emerald-400"
            maxLength={32}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="например, user2"
            value={username}
          />
        </label>
        <button
          className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={pendingAction !== ""}
          type="submit"
        >
          {pendingAction === "search" ? "Ищем..." : "Найти пользователя"}
        </button>
      </form>

      {error ? <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
      {notice ? (
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      ) : null}

      {foundUser ? (
        <article className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
          <div>
            <h2 className="text-lg font-semibold">{foundUser.displayName}</h2>
            <p className="mt-1 text-sm text-neutral-400">@{foundUser.username}</p>
          </div>

          {foundUser.isSelf ? (
            <p className="mt-4 text-sm text-red-300">Нельзя отправить запрос самому себе.</p>
          ) : (
            <div className="mt-4 grid gap-3">
              <label className="block text-sm font-medium">
                Сообщение к запросу
                <textarea
                  className="mt-2 min-h-24 w-full resize-none rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-base text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-emerald-400"
                  maxLength={500}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder="Можно оставить пустым"
                  value={message}
                />
              </label>
              <button
                className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={pendingAction !== ""}
                onClick={sendRequest}
                type="button"
              >
                {pendingAction === "send-request" ? "Отправляем..." : "Отправить запрос"}
              </button>
            </div>
          )}
        </article>
      ) : null}

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Входящие запросы</h2>
        {incoming.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
            Входящих запросов пока нет.
          </p>
        ) : (
          incoming.map((item) => (
            <RequestCard key={item.id} request={item} user={item.fromUser}>
              {item.status === "PENDING" ? (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button
                    className="min-h-10 rounded-md bg-emerald-500 px-3 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:opacity-60"
                    disabled={pendingAction !== ""}
                    onClick={() => respondToRequest(item.id, "accept")}
                    type="button"
                  >
                    {pendingAction === `accept-${item.id}` ? "Принимаем..." : "Принять"}
                  </button>
                  <button
                    className="min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 disabled:opacity-60"
                    disabled={pendingAction !== ""}
                    onClick={() => respondToRequest(item.id, "decline")}
                    type="button"
                  >
                    {pendingAction === `decline-${item.id}` ? "Отклоняем..." : "Отклонить"}
                  </button>
                </div>
              ) : null}
            </RequestCard>
          ))
        )}
      </section>

      <section className="grid gap-3">
        <h2 className="text-lg font-semibold">Исходящие запросы</h2>
        {outgoing.length === 0 ? (
          <p className="rounded-md border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
            Исходящих запросов пока нет.
          </p>
        ) : (
          outgoing.map((item) => (
            <RequestCard key={item.id} request={item} user={item.toUser}>
              {item.status === "PENDING" ? (
                <button
                  className="mt-4 min-h-10 w-full rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 disabled:opacity-60"
                  disabled={pendingAction !== ""}
                  onClick={() => respondToRequest(item.id, "cancel")}
                  type="button"
                >
                  {pendingAction === `cancel-${item.id}` ? "Отменяем..." : "Отменить"}
                </button>
              ) : null}
            </RequestCard>
          ))
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
        <h2 className="font-semibold">Групповые чаты</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-400">
          Создание групп через общий список пользователей временно скрыто. Для личных чатов используйте запросы на общение.
        </p>
      </section>
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
    <article className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-semibold">{displayUser(user)}</h3>
          <p className="mt-1 text-sm text-neutral-400">@{user.username}</p>
        </div>
        <span className="w-fit rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300">
          {statusLabels[request.status]}
        </span>
      </div>
      {request.message ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-300">{request.message}</p> : null}
      <p className="mt-3 text-sm text-neutral-500">Создан: {formatDate(request.createdAt)}</p>
      {children}
    </article>
  );
}
