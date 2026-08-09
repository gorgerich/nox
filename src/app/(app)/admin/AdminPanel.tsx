"use client";

import { FormEvent, useEffect, useState } from "react";

type AdminSection = "users" | "invites" | "recovery" | "security" | "audit";

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

type RecoveryRequestItem = {
  id: string;
  publicCode: string;
  status: "PENDING" | "APPROVED" | "DENIED" | "EXPIRED" | "USED";
  requesterUserAgent: string | null;
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  deniedAt: string | null;
  usedAt: string | null;
  user: {
    id: string;
    login: string | null;
    username: string;
    email: string | null;
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
  { id: "recovery", label: "Доступ" },
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
    ACCOUNT_RECOVERY_APPROVED: "Сброс разрешен",
    ACCOUNT_RECOVERY_DENIED: "Сброс отклонен",
    ACCOUNT_RECOVERY_ADMIN_APPROVED: "Сброс разрешен админом",
    ACCOUNT_RECOVERY_ADMIN_DENIED: "Сброс отклонен админом",
    PASSWORD_RESET_FROM_REQUEST: "Пароль сброшен",
    PASSWORD_RESET: "Пароль сброшен",
    EMERGENCY_LOCK_ENABLED: "Lock включен",
    EMERGENCY_LOCK_DISABLED: "Lock выключен",
  };
  return labels[action] ?? action;
}

function getRecoveryStatusLabel(status: RecoveryRequestItem["status"], expiresAt: string) {
  if (status === "PENDING" && new Date(expiresAt).getTime() <= Date.now()) {
    return "Истек";
  }

  const labels: Record<RecoveryRequestItem["status"], string> = {
    PENDING: "Ожидает",
    APPROVED: "Разрешен",
    DENIED: "Отклонен",
    EXPIRED: "Истек",
    USED: "Использован",
  };

  return labels[status] ?? status;
}

function isRecoveryActionable(request: RecoveryRequestItem) {
  return request.status === "PENDING" && new Date(request.expiresAt).getTime() > Date.now();
}

async function readJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) throw new Error(data?.error ?? "Ошибка.");
  return data;
}

export function AdminPanel({
  currentUserId,
  currentUserRole,
}: {
  currentUserId: string;
  currentUserRole: "OWNER" | "ADMIN";
}) {
  const [activeSection, setActiveSection] = useState<AdminSection>("users");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [invites, setInvites] = useState<InviteItem[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<RecoveryRequestItem[]>([]);
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
      const [usersData, invitesData, recoveryData, systemData, auditData] = await Promise.all([
        readJson<{ users: UserItem[] }>("/api/admin/users"),
        readJson<{ invites: InviteItem[] }>("/api/admin/invites"),
        readJson<{ requests: RecoveryRequestItem[] }>("/api/admin/recovery-requests"),
        readJson<SystemState>("/api/admin/system"),
        readJson<{ actions: AuditItem[] }>("/api/admin/audit-log"),
      ]);
      setUsers(usersData.users);
      setInvites(invitesData.invites);
      setRecoveryRequests(recoveryData.requests);
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
        const [usersData, invitesData, recoveryData, systemData, auditData] = await Promise.all([
          readJson<{ users: UserItem[] }>("/api/admin/users"),
          readJson<{ invites: InviteItem[] }>("/api/admin/invites"),
          readJson<{ requests: RecoveryRequestItem[] }>("/api/admin/recovery-requests"),
          readJson<SystemState>("/api/admin/system"),
          readJson<{ actions: AuditItem[] }>("/api/admin/audit-log"),
        ]);
        if (!active) return;
        setUsers(usersData.users);
        setInvites(invitesData.invites);
        setRecoveryRequests(recoveryData.requests);
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
    <div className="app-section transition-smooth !max-w-5xl !pb-[var(--bottom-dock-clearance)]">
      <div className="mb-6 flex items-center justify-between gap-4 px-1">
        <div>
          <h1 className="nox-page-title">Админ</h1>
        </div>
        <button 
          onClick={loadAdminData}
          className={`touch-target h-11 w-11 flex items-center justify-center rounded-full bg-surface-muted border border-border-subtle/50 text-muted transition-smooth active:scale-[0.96] ${loading ? 'animate-spin' : ''}`}
          aria-label="Обновить"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.001 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      <nav
        className="mb-6 flex gap-1 overflow-x-auto rounded-2xl border border-border-subtle/50 bg-surface-muted p-1 scrollbar-hide"
        data-nox-horizontal-scroll="true"
        aria-label="Разделы админ-панели"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`min-w-16 flex-1 rounded-xl px-3 py-2.5 text-[12px] font-semibold transition-smooth ${
              activeSection === s.id
                ? "bg-surface text-primary shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {error && <p className="bg-destructive/10 text-destructive text-xs font-bold p-3 rounded-xl text-center border border-destructive/20">{error}</p>}
      {loading && <p className="py-12 text-center text-sm font-semibold text-muted animate-pulse">Загрузка...</p>}

      {!loading && (
        <div className="animate-in fade-in duration-200">
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
                  
                  {user.id !== currentUserId && (currentUserRole === "OWNER" || user.role === "MEMBER") ? (
                    <div className="flex flex-wrap gap-2">
                      {user.status === "BLOCKED" ? (
                        <AdminActionButton
                          label="Разблок"
                          onClick={() => runAction(`unblock-${user.id}`, `/api/admin/users/${user.id}/unblock`)}
                          pending={pendingAction === `unblock-${user.id}`}
                        />
                      ) : (
                        <AdminActionButton
                          label="Блок"
                          onClick={() => runAction(`block-${user.id}`, `/api/admin/users/${user.id}/block`)}
                          pending={pendingAction === `block-${user.id}`}
                          variant="danger"
                        />
                      )}
                      {currentUserRole === "OWNER" && user.role === "MEMBER" ? (
                      <AdminActionButton 
                        label="+Админ" 
                        onClick={() => runAction(`make-admin-${user.id}`, `/api/admin/users/${user.id}/make-admin`)}
                        pending={pendingAction === `make-admin-${user.id}`}
                      />
                      ) : currentUserRole === "OWNER" && user.role === "ADMIN" ? (
                      <AdminActionButton 
                        label="-Админ" 
                        onClick={() => runAction(`remove-admin-${user.id}`, `/api/admin/users/${user.id}/remove-admin`)}
                        pending={pendingAction === `remove-admin-${user.id}`}
                      />
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}

          {activeSection === "invites" && (
            <div className="space-y-6">
              <form className="card-clean p-6 space-y-4" onSubmit={createInvite} method="POST">
                <h2 className="text-base font-semibold">Создать код</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input
                    className="input-nox"
                    placeholder="Лимит использований (число)"
                    aria-label="Лимит использований"
                    type="number"
                    value={inviteForm.maxUses}
                    onChange={(e) => setInviteForm({...inviteForm, maxUses: e.target.value})}
                  />
                  <input
                    className="input-nox"
                    type="datetime-local"
                    aria-label="Срок действия кода"
                    style={{ colorScheme: "dark" }}
                    value={inviteForm.expiresAt}
                    onChange={(e) => setInviteForm({...inviteForm, expiresAt: e.target.value})}
                  />
                </div>
                <button type="submit" className="btn-primary w-full" disabled={pendingAction !== ""}>
                  {pendingAction === "create-invite" ? "..." : "Сгенерировать"}
                </button>
              </form>

              {rawInviteCode && (
                <div className="card-clean border-primary/30 bg-primary/5 p-6 text-center animate-in zoom-in-95 duration-200">
                  <p className="mb-3 text-sm font-semibold text-primary">{notice}</p>
                  <code className="block bg-background p-4 rounded-xl border border-border-subtle font-mono text-sm select-all">
                    {rawInviteCode}
                  </code>
                </div>
              )}

              <div className="space-y-3">
                <h2 className="nox-section-label !m-0 px-2">Активные коды</h2>
                {invites.map((invite) => (
                  <article key={invite.id} className="card-clean p-4 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-mono text-xs truncate opacity-60">{invite.id}</p>
                      <p className="text-xs mt-1">
                        <span className="font-bold">{invite.usedCount}/{invite.maxUses}</span> • до {formatDate(invite.expiresAt)}
                      </p>
                      <p className="mt-1 text-[11px] text-muted">
                        Создал: {invite.createdBy?.profile?.displayName ?? invite.createdBy?.username ?? "неизвестно"}
                      </p>
                    </div>
                    <button 
                      className="text-xs font-semibold text-destructive transition hover:text-destructive"
                      onClick={() => runAction(`revoke-invite-${invite.id}`, `/api/admin/invites/${invite.id}/revoke`)}
                    >
                      Отозвать
                    </button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {activeSection === "recovery" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-warning/20 bg-warning/10 p-4">
                <p className="text-xs font-bold leading-relaxed text-warning">
                  Разрешайте сброс только если лично убедились, что запрос сделал владелец аккаунта.
                  После разрешения передайте ему код из карточки: он введет его на странице восстановления.
                </p>
              </div>

              {recoveryRequests.length === 0 && (
                <p className="py-12 text-center text-sm font-semibold text-muted">
                  Заявок нет
                </p>
              )}

              {recoveryRequests.map((request) => {
                const actionable = isRecoveryActionable(request);

                return (
                  <article key={request.id} className="card-clean p-5">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-bold">
                            {request.user.profile?.displayName ?? request.user.username}
                          </h3>
                          <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                            actionable ? "bg-warning/10 text-warning" : "bg-surface-hover text-muted"
                          }`}>
                            {getRecoveryStatusLabel(request.status, request.expiresAt)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          @{request.user.username}
                          {request.user.login ? ` • login: ${request.user.login}` : ""}
                          {request.user.email ? ` • ${request.user.email}` : ""}
                        </p>
                        <p className="mt-3 text-[11px] font-semibold text-muted/70">
                          Создан: {formatDate(request.createdAt)} • до {formatDate(request.expiresAt)}
                        </p>
                        {request.requesterUserAgent && (
                          <p className="mt-2 truncate text-[10px] text-muted/60">
                            {request.requesterUserAgent}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 rounded-2xl border border-border-subtle bg-foreground/5 px-4 py-3 text-center">
                        <p className="mb-1 text-[11px] font-semibold text-muted">Код</p>
                        <code className="select-all font-mono text-xl font-bold tracking-[0.14em] text-primary">
                          {request.publicCode}
                        </code>
                      </div>
                    </div>

                    {actionable && (
                      <div className="mt-5 flex gap-3">
                        <button
                          className="flex-1 rounded-xl bg-destructive/10 py-3 text-sm font-semibold text-destructive transition-smooth active:scale-[0.96] disabled:opacity-50"
                          disabled={pendingAction !== ""}
                          onClick={() => runAction(`deny-recovery-${request.id}`, `/api/admin/recovery-requests/${request.id}/deny`)}
                        >
                          {pendingAction === `deny-recovery-${request.id}` ? "..." : "Отклонить"}
                        </button>
                        <button
                          className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-smooth active:scale-[0.96] disabled:opacity-50"
                          disabled={pendingAction !== ""}
                          onClick={() => runAction(`approve-recovery-${request.id}`, `/api/admin/recovery-requests/${request.id}/approve`)}
                        >
                          {pendingAction === `approve-recovery-${request.id}` ? "..." : "Разрешить"}
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {activeSection === "security" && (
            <div className="space-y-6">
              <article className={`card-clean p-8 text-center border-2 transition-colors ${system?.emergencyLocked ? "border-destructive/50 bg-destructive/5" : "border-primary/20 bg-primary/5"}`}>
                  <div className={`mx-auto mb-6 h-16 w-16 rounded-full flex items-center justify-center text-2xl ${system?.emergencyLocked ? "bg-danger text-primary-foreground animate-pulse" : "bg-primary text-primary-foreground"}`}>
                  {system?.emergencyLocked ? "🔒" : "🛡️"}
                </div>
                <h2 className="text-2xl font-bold">Экстренная блокировка</h2>
                <p className="mt-3 text-sm text-muted max-w-sm mx-auto">
                  {system?.emergencyLocked 
                    ? "Доступ для обычных пользователей закрыт. Только администраторы могут войти." 
                    : "Система работает в штатном режиме. Все пользователи имеют доступ."}
                </p>
                <button
                  className={`mt-8 btn-primary w-full md:w-auto md:px-12 ${system?.emergencyLocked ? "bg-primary" : "bg-danger hover:opacity-90 text-primary-foreground"}`}
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
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-[transform,background-color,color,opacity] active:scale-[0.96] ${
        variant === "danger" 
          ? "bg-destructive/10 text-destructive hover:bg-destructive/20" 
          : "bg-surface-hover text-muted hover:text-foreground"
      }`}
      disabled={pending}
      onClick={onClick}
    >
      {pending ? "..." : label}
    </button>
  );
}
