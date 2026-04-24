"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

type UserOption = {
  id: string;
  username: string;
  displayName: string;
};

export function NewChatForm({ users }: { users: UserOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"direct" | "group">("direct");
  const [directUserId, setDirectUserId] = useState(users[0]?.id ?? "");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function toggleGroupMember(userId: string) {
    setGroupMemberIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId],
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);

    const response = await fetch(mode === "direct" ? "/api/chats/direct" : "/api/chats/group", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        mode === "direct"
          ? { userId: directUserId }
          : {
              title: groupTitle,
              memberIds: groupMemberIds,
            },
      ),
    });

    setPending(false);

    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "Не удалось создать чат.");
      return;
    }

    const data = (await response.json()) as { chat: { id: string } };
    router.push(`/chats/${data.chat.id}`);
    router.refresh();
  }

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <div className="grid grid-cols-2 rounded-md border border-neutral-800 bg-neutral-950 p-1">
        <button
          className={`h-10 rounded px-3 text-sm font-medium transition ${
            mode === "direct" ? "bg-emerald-500 text-neutral-950" : "text-neutral-300 hover:text-white"
          }`}
          onClick={() => setMode("direct")}
          type="button"
        >
          Личный чат
        </button>
        <button
          className={`h-10 rounded px-3 text-sm font-medium transition ${
            mode === "group" ? "bg-emerald-500 text-neutral-950" : "text-neutral-300 hover:text-white"
          }`}
          onClick={() => setMode("group")}
          type="button"
        >
          Групповой чат
        </button>
      </div>

      {mode === "direct" ? (
        users.length > 0 ? (
          <label className="block text-sm font-medium">
            Пользователь
            <select
              className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
              onChange={(event) => setDirectUserId(event.target.value)}
              value={directUserId}
            >
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.displayName} (@{user.username})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="rounded-md border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
            Выберите пользователя для личного чата, когда появятся активные участники.
          </div>
        )
      ) : (
        <div className="grid gap-4">
          <label className="block text-sm font-medium">
            Название
            <input
              className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
              maxLength={120}
              onChange={(event) => setGroupTitle(event.target.value)}
              placeholder="Рабочий чат"
              value={groupTitle}
            />
          </label>

          <fieldset className="grid gap-3">
            <legend className="text-sm font-medium">Участники</legend>
            <div className="grid gap-2">
              {users.map((user) => (
                <label
                  className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm"
                  key={user.id}
                >
                  <span>
                    <span className="block font-medium text-neutral-100">{user.displayName}</span>
                    <span className="text-neutral-500">@{user.username}</span>
                  </span>
                  <input
                    className="h-4 w-4 accent-emerald-500"
                    checked={groupMemberIds.includes(user.id)}
                    onChange={() => toggleGroupMember(user.id)}
                    type="checkbox"
                  />
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      {users.length === 0 && mode === "group" ? (
        <p className="rounded-md border border-dashed border-neutral-700 p-4 text-sm text-neutral-400">
          Пока нет активных пользователей для создания чата.
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-300">{error}</p> : null}

      <button
        className="h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={pending || users.length === 0}
        type="submit"
      >
        {pending ? "Создаём..." : "Создать чат"}
      </button>
    </form>
  );
}
