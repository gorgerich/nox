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
  { id: "users", label: "Люди" },
  { id: "invites", label: "Коды" },
  { id: "security", label: "Защита" },
  { id: "audit", label: "Логи" },
];

function formatDate(value: string | null) {
  if (!value) return "∞";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getRoleLabel(role: string) {
  if (role === "OWNER") return "Владелец";
  if (role === "ADMIN") return "Админ";
  return "Участник";
}

function getActionLabel(action: string) {
  const labels: Record<string, string> = {
    USER_BLOCKED: "Блокировка",
    USER_UNBLOCKED: "Разблокировка",
    USER_REVOKED: "Отказ в доступе",
    USER_MADE_ADMIN: "Назначен админ",
    USER_ADMIN_REMOVED: "Снят админ",
    INVITE_CREATED: "Код создан",
    INVITE_REVOKED: "Код отозван",
    EMERGENCY_LOCK_ENABLED: "Lock включен",
    EMERGENCY_LOCK_DISABLED: "Lock выключен",
  };
  return labels[action] ?? action;
}

async function readJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "Ошибка.");
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
      setError(reason instanceof Error ? reason.message : "Ошибка загрузки.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [usersData, invitesData, systemData, auditData] = await Promise.all([
          readJson<{ users: UserItem[] }>("/api/admin/users"),
          readJson<{ invites: InviteItem[] }>("/api/admin/invites"),
          readJson<SystemState>("/api/admin/system"),
          readJson<{ actions: AuditItem[] }>("/api/admin/audit-log"),
        ]);
        if (!active) return;
        setUsers(usersData.users);
        setInvites(invitesData.invites);
        setSystem(systemData);
        setAuditLog(auditData.actions);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Ошибка загрузки.");
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, []);

  async function runAction(actionId: string, url: string) {
    setError("");
    setPendingAction(actionId);
    try {
      await readJson(url, { method: "POST" });
      await loadAdminData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка.");
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

    try {
      const data = await readJson<{ rawInviteCode: string; notice: string }>("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          maxUses: Number(inviteForm.maxUses),
          expiresAt: inviteForm.expiresAt ? new Date(inviteForm.expiresAt).toISOString() : null,
          targetEmail: inviteForm.targetEmail.trim() || undefined,
          targetUsername: inviteForm.targetUsername.trim() || undefined,
        }),
      });
      setInviteForm({ maxUses: "1", expiresAt: "", targetEmail: "", targetUsername: "" });
      setRawInviteCode(data.rawInviteCode);
      setNotice(data.notice);
      await loadAdminData();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Ошибка.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <div className="px-2 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Управление</h1>
          <p className="mt-1 text-sm text-muted">Доступ: {getRoleLabel(currentUserRole)}</p>
        </div>
        <div className="flex bg-surface p-1 rounded-2xl border border-border-subtle">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                activeSection === section.id 
                  ? "bg-primary text-neutral-950 shadow-sm" 
                  : "text-muted hover:text-foreground"
              }`}
            >
              {section.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="bg-red-500/10 text-red-400 text-xs font-bold p-3 rounded-xl text-center border border-red-500/20">{error}</p>}
      {loading && <p className="text-center text-xs font-bold uppercase tracking-widest text-muted animate-pulse py-12">Загрузка...</p>}

      {!loading && (
        <div className="animate-in fade-in duration-500 px-2">
          {activeSection === "users" && (
            <div className="space-y-3">
              {users.map((user) => (
                <article key={user.id} className="card-clean p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-surface-hover flex items-center justify-center font-bold text-primary">
                      {user.username.slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold">{user.profile?.displayName ?? user.username}</h3>
                      <p className="text-xs text-muted">@{user.username} • {getRoleLabel(user.role)}</p>
                    </div>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <AdminActionButton 
                      label="Блок" 
                      onClick={() => runAction(`block-${user.id}`, `/api/admin/users/${user.id}/block`)}
                      pending={pendingAction === `block-${user.id}`}
                      variant="danger"
                    />
                    <AdminActionButton 
                      label="Разблок" 
                      onClick={() => runAction(`unblock-${user.id}`, `/api/admin/users/${user.id}/unblock`)}
                      pending={pendingAction === `unblock-${user.id}`}
                    />
                    {user.role !== "ADMIN" ? (
                      <AdminActionButton 
                        label="+Админ" 
                        onClick={() => runAction(`make-admin-${user.id}`, `/api/admin/users/${user.id}/make-admin`)}
                        pending={pendingAction === `make-admin-${user.id}`}
                      />
                    ) : (
                      <AdminActionButton 
                        label="-Админ" 
                        onClick={() => runAction(`remove-admin-${user.id}`, `/api/admin/users/${user.id}/remove-admin`)}
                        pending={pendingAction === `remove-admin-${user.id}`}
                      />
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}

          {activeSection === "invites" && (
            <div className="space-y-6">
              <form className="card-clean p-6 space-y-4" onSubmit={createInvite} method="POST">
                <h2 className="text-sm font-bold uppercase tracking-widest">Создать код</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    className="input-nox"
                    placeholder="Лимит использований (число)"
                    type="number"
                    value={inviteForm.maxUses}
                    onChange={(e) => setInviteForm({...inviteForm, maxUses: e.target.value})}
                  />
                  <input
                    className="input-nox"
                    type="datetime-local"
                    style={{ colorScheme: "dark" }}
                    value={inviteForm.expiresAt}
                    onChange={(e) => setInviteForm({...inviteForm, expiresAt: e.target.value})}
                  />
                </div>
                <button className="btn-primary w-full" disabled={pendingAction !== ""}>
                  {pendingAction === "create-invite" ? "..." : "Сгенерировать"}
                </button>
              </form>

              {rawInviteCode && (
                <div className="card-clean border-primary/30 bg-primary/5 p-6 text-center animate-in zoom-in-95 duration-300">
                  <p className="text-xs font-bold text-primary uppercase mb-3">{notice}</p>
                  <code className="block bg-background p-4 rounded-xl border border-border-subtle font-mono text-sm select-all">
                    {rawInviteCode}
                  </code>
                </div>
              )}

              <div className="space-y-3">
                <h2 className="text-xs font-bold uppercase tracking-widest text-muted px-2">Активные коды</h2>
                {invites.map((invite) => (
                  <article key={invite.id} className="card-clean p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-xs truncate opacity-60">{invite.id}</p>
                      <p className="text-xs mt-1">
                        <span className="font-bold">{invite.usedCount}/{invite.maxUses}</span> • до {formatDate(invite.expiresAt)}
                      </p>
                    </div>
                    <button 
                      className="text-[10px] font-bold uppercase tracking-widest text-red-400 hover:text-red-300 transition"
                      onClick={() => runAction(`revoke-invite-${invite.id}`, `/api/admin/invites/${invite.id}/revoke`)}
                    >
                      Отозвать
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {activeSection === "security" && (
            <div className="space-y-6">
              <article className={`card-clean p-8 text-center border-2 transition-colors ${system?.emergencyLocked ? "border-red-500/50 bg-red-500/5" : "border-primary/20 bg-primary/5"}`}>
                <div className={`mx-auto mb-6 h-16 w-16 rounded-full flex items-center justify-center text-2xl ${system?.emergencyLocked ? "bg-red-500 text-white animate-pulse" : "bg-primary text-neutral-950"}`}>
                  {system?.emergencyLocked ? "🔒" : "🛡️"}
                </div>
                <h2 className="text-2xl font-bold">Экстренная блокировка</h2>
                <p className="mt-3 text-sm text-muted max-w-sm mx-auto">
                  {system?.emergencyLocked 
                    ? "Доступ для обычных пользователей закрыт. Только администраторы могут войти." 
                    : "Система работает в штатном режиме. Все пользователи имеют доступ."}
                </p>
                <button
                  className={`mt-8 btn-primary w-full md:w-auto md:px-12 ${system?.emergencyLocked ? "bg-primary" : "bg-red-500 hover:bg-red-600 text-white"}`}
                  disabled={pendingAction !== ""}
                  onClick={() => runAction(
                    system?.emergencyLocked ? "unlock" : "lock",
                    system?.emergencyLocked ? "/api/admin/system/emergency-unlock" : "/api/admin/system/emergency-lock"
                  )}
                >
                  {system?.emergencyLocked ? "Снять блокировку" : "Активировать блок"}
                </button>
              </article>
            </div>
          )}

          {activeSection === "audit" && (
            <div className="space-y-3">
              {auditLog.map((item) => (
                <article key={item.id} className="card-clean p-4 text-sm">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <p className="font-bold text-primary">{getActionLabel(item.action)}</p>
                    <time className="text-[10px] text-muted font-bold uppercase">{formatDate(item.createdAt)}</time>
                  </div>
                  <p className="text-xs text-muted">Исполнитель: {item.admin.profile?.displayName ?? item.admin.username}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AdminActionButton({ label, onClick, pending, variant = "default" }: { 
  label: string, 
  onClick: () => void, 
  pending: boolean,
  variant?: "default" | "danger" 
}) {
  return (
    <button
      className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all active:scale-95 ${
        variant === "danger" 
          ? "bg-red-500/10 text-red-400 hover:bg-red-500/20" 
          : "bg-surface-hover text-muted hover:text-foreground"
      }`}
      disabled={pending}
      onClick={onClick}
    >
      {pending ? "..." : label}
    </button>
  );
}
