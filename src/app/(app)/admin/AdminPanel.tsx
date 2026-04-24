"use client";

import { FormEvent, useEffect, useState } from "react";

type AdminSection = "users" | "invites" | "security" | "audit";

type UserItem = {
  id: string;
  email: string | null;
  login: string | null;
  username: string;
  role: "OWNER" | "ADMIN" | "MEMBER";
  status: "PENDING" | "ACTIVE" | "BLOCKED" | "REVOKED";
  createdAt: string;
  profile: { displayName: string } | null;
};

type InviteItem = {
  id: string;
  status: "ACTIVE" | "USED" | "EXPIRED" | "REVOKED";
  usedCount: number;
  maxUses: number;
  expiresAt: string | null;
  createdAt: string;
  targetEmail: string | null;
  targetUsername: string | null;
  createdBy?: {
    username: string;
    profile: { displayName: string } | null;
  };
};

type SystemState = {
  emergencyLocked: boolean;
  updatedAt: string | null;
};

type AuditItem = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
  admin: {
    username: string;
    profile: { displayName: string } | null;
  };
};

type InviteFormState = {
  maxUses: string;
  expiresAt: string;
  targetEmail: string;
  targetUsername: string;
};

const sections: { id: AdminSection; label: string }[] = [
  { id: "users", label: "Пользователи" },
  { id: "invites", label: "Приглашения" },
  { id: "security", label: "Безопасность" },
  { id: "audit", label: "Журнал действий" },
];

function formatDate(value: string | null) {
  if (!value) {
    return "Не задано";
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getRoleLabel(role: string) {
  if (role === "OWNER") {
    return "Владелец";
  }

  if (role === "ADMIN") {
    return "Администратор";
  }

  return "Участник";
}

function getStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ACTIVE: "Активен",
    BLOCKED: "Заблокирован",
    REVOKED: "Доступ отозван",
    PENDING: "Ожидает",
    USED: "Использовано",
    EXPIRED: "Истекло",
  };

  return labels[status] ?? status;
}

function getActionLabel(action: string) {
  const labels: Record<string, string> = {
    USER_BLOCKED: "Пользователь заблокирован",
    USER_UNBLOCKED: "Пользователь разблокирован",
    USER_REVOKED: "Доступ пользователя отозван",
    USER_MADE_ADMIN: "Пользователь назначен администратором",
    USER_ADMIN_REMOVED: "Роль администратора снята",
    INVITE_CREATED: "Приглашение создано",
    INVITE_REVOKED: "Приглашение отозвано",
    EMERGENCY_LOCK_ENABLED: "Экстренная блокировка включена",
    EMERGENCY_LOCK_DISABLED: "Экстренная блокировка выключена",
  };

  return labels[action] ?? action;
}

function renderMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return "Нет данных";
  }

  return JSON.stringify(metadata);
}

async function readJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data?.error ?? "Не удалось выполнить действие.");
  }

  return data;
}

export function AdminPanel({ currentUserRole }: { currentUserRole: string }) {
  const [activeSection, setActiveSection] = useState<AdminSection>("users");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [system, setSystem] = useState<SystemState | null>(null);
  const [auditLog, setAuditLog] = useState<AuditItem[]>([]);
  const [rawInviteCode, setRawInviteCode] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState("");
  const [inviteForm, setInviteForm] = useState<InviteFormState>({
    maxUses: "1",
    expiresAt: "",
    targetEmail: "",
    targetUsername: "",
  });

  async function loadAdminData() {
    setError("");
    setLoading(true);

    try {
      const [usersData, invitesData, systemData, auditData] = await Promise.all([
        readJson<{ users: UserItem[] }>("/api/admin/users"),
        readJson<{ invites: InviteItem[] }>("/api/admin/invites"),
        readJson<SystemState>("/api/admin/system"),
        readJson<{ actions: AuditItem[] }>("/api/admin/audit-log"),
      ]);

      setUsers(usersData.users);
      setInvites(invitesData.invites);
      setSystem(systemData);
      setAuditLog(auditData.actions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить данные админки.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitialData() {
      try {
        const [usersData, invitesData, systemData, auditData] = await Promise.all([
          readJson<{ users: UserItem[] }>("/api/admin/users"),
          readJson<{ invites: InviteItem[] }>("/api/admin/invites"),
          readJson<SystemState>("/api/admin/system"),
          readJson<{ actions: AuditItem[] }>("/api/admin/audit-log"),
        ]);

        if (!active) {
          return;
        }

        setUsers(usersData.users);
        setInvites(invitesData.invites);
        setSystem(systemData);
        setAuditLog(auditData.actions);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Не удалось загрузить данные админки.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      active = false;
    };
  }, []);

  async function runAction(actionId: string, url: string) {
    setError("");
    setPendingAction(actionId);

    try {
      await readJson(url, { method: "POST" });
      await loadAdminData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выполнить действие.");
    } finally {
      setPendingAction("");
    }
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setRawInviteCode("");
    setNotice("");
    setPendingAction("create-invite");

    const maxUses = Number(inviteForm.maxUses);

    if (!Number.isInteger(maxUses) || maxUses < 1) {
      setPendingAction("");
      setError("Количество использований должно быть не меньше 1.");
      return;
    }

    const expiresAt = inviteForm.expiresAt
      ? new Date(inviteForm.expiresAt).toISOString()
      : null;

    try {
      const data = await readJson<{
        rawInviteCode: string;
        notice: string;
      }>("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxUses,
          expiresAt,
          targetEmail: inviteForm.targetEmail.trim() || undefined,
          targetUsername: inviteForm.targetUsername.trim() || undefined,
        }),
      });

      setInviteForm({
        maxUses: "1",
        expiresAt: "",
        targetEmail: "",
        targetUsername: "",
      });
      setRawInviteCode(data.rawInviteCode);
      setNotice(data.notice);
      await loadAdminData();
      setActiveSection("invites");
    } catch (reason) {
      console.error(reason);
      setError(reason instanceof Error ? reason.message : "Не удалось создать приглашение.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <section className="grid gap-5">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-emerald-400">Администрирование</p>
            <h1 className="mt-1 text-2xl font-semibold">Панель управления</h1>
          </div>
          <span className="w-fit rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300">
            {getRoleLabel(currentUserRole)}
          </span>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {sections.map((section) => (
            <button
              className={`min-h-11 rounded-md border px-3 text-sm font-semibold transition ${
                activeSection === section.id
                  ? "border-emerald-500 bg-emerald-500 text-neutral-950"
                  : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-neutral-600"
              }`}
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5 text-sm text-neutral-400">
          Загружаем данные...
        </div>
      ) : null}

      {activeSection === "users" ? (
        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">Пользователи</h2>
          {users.map((user) => (
            <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-4" key={user.id}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-lg font-semibold">{user.profile?.displayName ?? user.username}</h3>
                  <p className="mt-1 text-sm text-neutral-400">@{user.username}</p>
                  <p className="mt-1 break-words text-sm text-neutral-400">
                    Логин: {user.login ?? "Не задан"}
                  </p>
                  <p className="mt-1 break-words text-sm text-neutral-400">{user.email ?? "Электронная почта не указана"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300">
                    {getRoleLabel(user.role)}
                  </span>
                  <span className="rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300">
                    {getStatusLabel(user.status)}
                  </span>
                </div>
              </div>
              <p className="mt-3 text-sm text-neutral-500">Создан: {formatDate(user.createdAt)}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <AdminButton
                  disabled={pendingAction !== ""}
                  label="Заблокировать"
                  onClick={() => runAction(`block-${user.id}`, `/api/admin/users/${user.id}/block`)}
                  pending={pendingAction === `block-${user.id}`}
                />
                <AdminButton
                  disabled={pendingAction !== ""}
                  label="Разблокировать"
                  onClick={() => runAction(`unblock-${user.id}`, `/api/admin/users/${user.id}/unblock`)}
                  pending={pendingAction === `unblock-${user.id}`}
                />
                <AdminButton
                  disabled={pendingAction !== ""}
                  label="Отозвать доступ"
                  onClick={() => runAction(`revoke-${user.id}`, `/api/admin/users/${user.id}/revoke`)}
                  pending={pendingAction === `revoke-${user.id}`}
                />
                <AdminButton
                  disabled={pendingAction !== ""}
                  label="Сделать админом"
                  onClick={() => runAction(`make-admin-${user.id}`, `/api/admin/users/${user.id}/make-admin`)}
                  pending={pendingAction === `make-admin-${user.id}`}
                />
                <AdminButton
                  disabled={pendingAction !== ""}
                  label="Убрать админа"
                  onClick={() => runAction(`remove-admin-${user.id}`, `/api/admin/users/${user.id}/remove-admin`)}
                  pending={pendingAction === `remove-admin-${user.id}`}
                />
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {activeSection === "invites" ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-semibold">Приглашения</h2>
          <form className="grid gap-4 rounded-lg border border-neutral-800 bg-neutral-900 p-4" onSubmit={createInvite}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Количество использований
                <input
                  className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
                  min="1"
                  max="100"
                  name="maxUses"
                  onChange={(event) =>
                    setInviteForm((current) => ({ ...current, maxUses: event.target.value }))
                  }
                  type="number"
                  value={inviteForm.maxUses}
                  required
                />
              </label>
              <label className="text-sm font-medium">
                Действует до
                <input
                  className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
                  name="expiresAt"
                  onChange={(event) =>
                    setInviteForm((current) => ({ ...current, expiresAt: event.target.value }))
                  }
                  style={{ colorScheme: "dark" }}
                  type="datetime-local"
                  value={inviteForm.expiresAt}
                />
                <span className="mt-2 block text-sm leading-5 text-neutral-500">
                  Можно оставить пустым — приглашение не будет иметь срока действия.
                </span>
              </label>
              <label className="text-sm font-medium">
                Целевая электронная почта
                <input
                  className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
                  name="targetEmail"
                  onChange={(event) =>
                    setInviteForm((current) => ({ ...current, targetEmail: event.target.value }))
                  }
                  type="email"
                  value={inviteForm.targetEmail}
                />
              </label>
              <label className="text-sm font-medium">
                Целевое имя пользователя
                <input
                  className="mt-2 h-11 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 text-neutral-100 outline-none transition focus:border-emerald-400"
                  name="targetUsername"
                  onChange={(event) =>
                    setInviteForm((current) => ({ ...current, targetUsername: event.target.value }))
                  }
                  value={inviteForm.targetUsername}
                />
              </label>
            </div>
            <button
              className="min-h-11 rounded-md bg-emerald-500 px-4 text-sm font-semibold text-neutral-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={pendingAction !== ""}
              type="submit"
            >
              {pendingAction === "create-invite" ? "Создаём..." : "Создать приглашение"}
            </button>
          </form>

          {rawInviteCode ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-sm text-emerald-200">{notice}</p>
              <p className="mt-3 break-all rounded-md bg-neutral-950 p-3 font-mono text-sm text-neutral-100">
                {rawInviteCode}
              </p>
            </div>
          ) : null}

          <div className="grid gap-3">
            {invites.map((invite) => (
              <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-4" key={invite.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold">Приглашение</h3>
                    <p className="mt-1 text-sm text-neutral-500">{invite.id}</p>
                  </div>
                  <span className="w-fit rounded-full bg-neutral-800 px-3 py-1 text-sm text-neutral-300">
                    {getStatusLabel(invite.status)}
                  </span>
                </div>
                <div className="mt-4 grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
                  <p>Использовано: {invite.usedCount} из {invite.maxUses}</p>
                  <p>Истекает: {formatDate(invite.expiresAt)}</p>
                  <p>Создано: {formatDate(invite.createdAt)}</p>
                  <p>Кем создано: {invite.createdBy?.profile?.displayName ?? invite.createdBy?.username ?? "Неизвестно"}</p>
                  <p className="break-words">Целевая почта: {invite.targetEmail ?? "Не задана"}</p>
                  <p className="break-words">Целевое имя: {invite.targetUsername ?? "Не задано"}</p>
                </div>
                <div className="mt-4">
                  <AdminButton
                    disabled={pendingAction !== ""}
                    label="Отозвать"
                    onClick={() => runAction(`revoke-invite-${invite.id}`, `/api/admin/invites/${invite.id}/revoke`)}
                    pending={pendingAction === `revoke-invite-${invite.id}`}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeSection === "security" ? (
        <section className="grid gap-4">
          <h2 className="text-xl font-semibold">Безопасность</h2>
          <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <p className={`text-lg font-semibold ${system?.emergencyLocked ? "text-red-300" : "text-emerald-300"}`}>
              {system?.emergencyLocked ? "Экстренная блокировка включена" : "Экстренная блокировка выключена"}
            </p>
            <p className="mt-3 text-sm leading-6 text-neutral-400">
              При включении обычные пользователи временно теряют доступ. Админы остаются внутри.
            </p>
            <p className="mt-2 text-sm text-neutral-500">Обновлено: {formatDate(system?.updatedAt ?? null)}</p>
            <button
              className={`mt-5 min-h-12 w-full rounded-md px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
                system?.emergencyLocked
                  ? "bg-emerald-500 text-neutral-950 hover:bg-emerald-400"
                  : "bg-red-500 text-white hover:bg-red-400"
              }`}
              disabled={pendingAction !== ""}
              onClick={() =>
                runAction(
                  system?.emergencyLocked ? "emergency-unlock" : "emergency-lock",
                  system?.emergencyLocked
                    ? "/api/admin/system/emergency-unlock"
                    : "/api/admin/system/emergency-lock",
                )
              }
              type="button"
            >
              {system?.emergencyLocked ? "Выключить блокировку" : "Включить блокировку"}
            </button>
          </article>
          <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h3 className="font-semibold">Доступ</h3>
            <p className="mt-2 text-sm leading-6 text-neutral-400">
              Заблокированные и пользователи с отозванным доступом не могут пользоваться приложением.
            </p>
          </article>
        </section>
      ) : null}

      {activeSection === "audit" ? (
        <section className="grid gap-3">
          <h2 className="text-xl font-semibold">Журнал действий</h2>
          {auditLog.map((item) => (
            <article className="rounded-lg border border-neutral-800 bg-neutral-900 p-4" key={item.id}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="font-semibold">{getActionLabel(item.action)}</h3>
                  <p className="mt-1 text-sm text-neutral-400">
                    Админ: {item.admin.profile?.displayName ?? item.admin.username}
                  </p>
                </div>
                <p className="text-sm text-neutral-500">{formatDate(item.createdAt)}</p>
              </div>
              <div className="mt-3 grid gap-2 text-sm text-neutral-300 sm:grid-cols-2">
                <p>Тип цели: {item.targetType}</p>
                <p className="break-all">ID цели: {item.targetId ?? "Не указан"}</p>
              </div>
              <p className="mt-3 break-words rounded-md bg-neutral-950 p-3 text-sm text-neutral-400">
                {renderMetadata(item.metadata)}
              </p>
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}

function AdminButton({
  disabled,
  label,
  onClick,
  pending,
}: {
  disabled: boolean;
  label: string;
  onClick: () => void;
  pending: boolean;
}) {
  return (
    <button
      className="min-h-10 rounded-md border border-neutral-700 px-3 text-sm font-semibold text-neutral-200 transition hover:border-neutral-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {pending ? "Выполняем..." : label}
    </button>
  );
}
