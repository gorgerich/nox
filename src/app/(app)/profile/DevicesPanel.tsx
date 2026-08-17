"use client";

import { useCallback, useEffect, useState } from "react";
import { getLocalDeviceId, registerCurrentDevice } from "@/lib/e2ee/keys";
import { SettingsGroup, SettingsStack } from "@/components/settings/SettingsGroup";
import { SettingsActionRow, SettingsNavRow, SettingsValueRow } from "@/components/settings/SettingsRow";
import { ConfirmSheet } from "@/components/settings/ConfirmSheet";

export type E2EEDevice = {
  deviceId: string;
  name: string | null;
  platform: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  isCurrentDevice: boolean;
  fingerprintShort: string | null;
};

function getBrowserName(userAgent: string | null) {
  if (!userAgent) return "браузер не определён";
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/CriOS|Chrome\//.test(userAgent) && !/Edg\//.test(userAgent)) return "Chrome";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent) && !/CriOS/.test(userAgent)) return "Safari";
  return "Web";
}

function getDeviceName(device: E2EEDevice) {
  const source = `${device.platform || ""} ${device.userAgent || ""}`;
  if (/iPhone/i.test(source)) return "iPhone";
  if (/iPad/i.test(source)) return "iPad";
  if (/Android/i.test(source)) return "Android";
  if (/Mac/i.test(source)) return "Mac";
  if (/Windows/i.test(source)) return "Windows PC";
  if (/Linux/i.test(source)) return "Linux";
  return device.name || "Nox Web";
}

function getPlatformName(device: E2EEDevice) {
  const source = `${device.platform || ""} ${device.userAgent || ""}`;
  const browser = getBrowserName(device.userAgent);
  let os = device.platform || "Web";
  if (/iPhone|iPad|iPod/i.test(source)) os = "iOS";
  else if (/Android/i.test(source)) os = "Android";
  else if (/Mac/i.test(source)) os = "macOS";
  else if (/Windows/i.test(source)) os = "Windows";
  else if (/Linux/i.test(source)) os = "Linux";
  return `${os} · ${browser}`;
}

function formatDeviceActivity(device: E2EEDevice) {
  if (device.isCurrentDevice) return "Сейчас";
  if (device.revokedAt) {
    return `Отозвано ${new Date(device.revokedAt).toLocaleString("ru-RU", { day: "numeric", month: "short" })}`;
  }
  if (!device.lastSeenAt) return "Активность неизвестна";

  const date = new Date(device.lastSeenAt);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  if (date.toDateString() === now.toDateString()) return `Сегодня в ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Вчера в ${time}`;
  return date.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
}

/**
 * Session manager.
 *
 * Two things changed from the previous version, both about what a session list
 * is for. The technical identity of a device — key fingerprint, raw user agent
 * — is no longer on the front of every card; it is one tap away, where someone
 * verifying a key can find it and everyone else is not asked to read it. And
 * "end all other sessions" moved from a red card at the top of the screen to a
 * plain destructive row at the bottom, because it is the last thing you do,
 * not the first thing you see.
 */
export function DevicesPanel({ userId }: { userId: string }) {
  const [devices, setDevices] = useState<E2EEDevice[]>([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [revokeAllPending, setRevokeAllPending] = useState(false);
  const [detailDeviceId, setDetailDeviceId] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<E2EEDevice | null>(null);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      let deviceId: string | null = null;
      try {
        const current = await registerCurrentDevice(userId);
        deviceId = current.deviceId;
      } catch {
        deviceId = await getLocalDeviceId(userId).catch(() => null);
      }
      setCurrentDeviceId(deviceId);
      const res = await fetch(`/api/e2ee/devices/me${deviceId ? `?currentDeviceId=${encodeURIComponent(deviceId)}` : ""}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Не удалось загрузить устройства");
      setDevices(Array.isArray(data?.devices) ? data.devices : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить устройства");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    queueMicrotask(() => void loadDevices());
  }, [loadDevices]);

  const revokeDevice = async (device: E2EEDevice) => {
    setConfirmRevoke(null);
    if (device.isCurrentDevice || device.deviceId === currentDeviceId) return;
    setError("");
    setPendingDeviceId(device.deviceId);
    const previous = devices;
    const now = new Date().toISOString();
    setDevices((current) => current.map((item) => item.deviceId === device.deviceId ? { ...item, revokedAt: now } : item));
    const res = await fetch(`/api/e2ee/devices/${encodeURIComponent(device.deviceId)}/revoke`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(currentDeviceId ? { "x-nox-device-id": currentDeviceId } : {}) },
      body: JSON.stringify({ currentDeviceId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDevices(previous);
      setError(data?.error || "Не удалось отозвать устройство");
      setPendingDeviceId(null);
      return;
    }
    setPendingDeviceId(null);
    setDetailDeviceId(null);
    await loadDevices();
  };

  const revokeOtherDevices = async () => {
    setConfirmRevokeAll(false);
    if (!currentDeviceId) {
      setError("Не удалось определить текущее устройство");
      return;
    }
    const activeOthers = devices.filter((device) => !device.isCurrentDevice && device.deviceId !== currentDeviceId && !device.revokedAt);
    if (activeOthers.length === 0) return;

    setError("");
    setRevokeAllPending(true);
    const previous = devices;
    const now = new Date().toISOString();
    setDevices((current) => current.map((device) => (
      device.isCurrentDevice || device.deviceId === currentDeviceId || device.revokedAt
        ? device
        : { ...device, revokedAt: now }
    )));

    const res = await fetch("/api/e2ee/devices/revoke-others", {
      method: "POST",
      headers: { "content-type": "application/json", "x-nox-device-id": currentDeviceId },
      body: JSON.stringify({ currentDeviceId }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setDevices(previous);
      setError(data?.error || "Не удалось завершить остальные сеансы");
      setRevokeAllPending(false);
      return;
    }

    setRevokeAllPending(false);
    await loadDevices();
  };

  const currentDevice = devices.find((device) => device.isCurrentDevice || device.deviceId === currentDeviceId) ?? null;
  const activeOtherDevices = devices.filter((device) => device.deviceId !== currentDevice?.deviceId && !device.revokedAt);
  const revokedDevices = devices.filter((device) => device.deviceId !== currentDevice?.deviceId && device.revokedAt);
  const detailDevice = devices.find((device) => device.deviceId === detailDeviceId) ?? null;

  return (
    <>
      <SettingsStack>
        {error ? (
          <p role="alert" className="px-5 text-[0.8125rem] text-danger">{error}</p>
        ) : null}

        <SettingsGroup label="Это устройство">
          {currentDevice ? (
            <SettingsValueRow
              title={getDeviceName(currentDevice)}
              subtitle={getPlatformName(currentDevice)}
              value="Сейчас"
            />
          ) : (
            <SettingsValueRow
              title={loading ? "Загрузка…" : "Устройство не определено"}
              subtitle={loading ? undefined : "Обновите страницу, чтобы зарегистрировать это устройство."}
            />
          )}
        </SettingsGroup>

        <SettingsGroup
          label="Другие устройства"
          footer={
            activeOtherDevices.length > 0
              ? "Нажмите на устройство, чтобы увидеть детали и завершить сеанс."
              : undefined
          }
        >
          {activeOtherDevices.length > 0 ? (
            activeOtherDevices.map((device) => (
              <SettingsNavRow
                key={device.deviceId}
                title={getDeviceName(device)}
                subtitle={getPlatformName(device)}
                value={formatDeviceActivity(device)}
                onClick={() => setDetailDeviceId(device.deviceId)}
              />
            ))
          ) : (
            <SettingsValueRow
              title={loading ? "Загрузка…" : "Только это устройство"}
              subtitle={loading ? undefined : "Других активных сеансов нет."}
            />
          )}
        </SettingsGroup>

        {revokedDevices.length > 0 ? (
          <SettingsGroup label="Отозванные">
            {revokedDevices.map((device) => (
              <SettingsValueRow
                key={device.deviceId}
                title={getDeviceName(device)}
                subtitle={getPlatformName(device)}
                value={formatDeviceActivity(device)}
              />
            ))}
          </SettingsGroup>
        ) : null}

        {activeOtherDevices.length > 0 ? (
          <SettingsGroup footer="Отзывает ключи всех устройств, кроме текущего. Они перестанут получать новые сообщения.">
            <SettingsActionRow
              title="Завершить все другие сеансы"
              tone="danger"
              busy={revokeAllPending}
              onClick={() => setConfirmRevokeAll(true)}
            />
          </SettingsGroup>
        ) : null}

        <p className="px-5 text-[0.8125rem] leading-snug text-muted">
          Город и страна сеанса не показываются: сервер их не хранит. Nox отображает только то, что
          известно на самом деле — устройство, платформу, браузер и время последней активности.
        </p>
      </SettingsStack>

      {/* Device detail: the technical identity, one tap away from the list. */}
      {detailDevice ? (
        <div
          className="fixed inset-0 z-[1200] flex items-end justify-center bg-black/45 p-3 animate-in fade-in duration-150"
          onClick={() => setDetailDeviceId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={getDeviceName(detailDevice)}
            className="w-full max-w-md overflow-hidden rounded-2xl bg-surface-elevated pb-[env(safe-area-inset-bottom)] animate-in slide-in-from-bottom-4 duration-200"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-5 pb-4 pt-5">
              <p className="text-[1.25rem] font-semibold text-foreground">{getDeviceName(detailDevice)}</p>
              <p className="mt-0.5 text-[0.8125rem] text-muted">{getPlatformName(detailDevice)}</p>
            </div>
            <div className="h-px bg-border-subtle" />
            <dl className="px-5 py-3 text-[0.8125rem]">
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-muted">Последняя активность</dt>
                <dd className="text-right text-foreground">{formatDeviceActivity(detailDevice)}</dd>
              </div>
              <div className="flex justify-between gap-4 py-1.5">
                <dt className="text-muted">Добавлено</dt>
                <dd className="text-right text-foreground">
                  {new Date(detailDevice.createdAt).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}
                </dd>
              </div>
              {detailDevice.fingerprintShort ? (
                <div className="flex justify-between gap-4 py-1.5">
                  <dt className="text-muted">Отпечаток ключа</dt>
                  <dd className="break-all text-right font-mono text-[0.75rem] text-muted">
                    {detailDevice.fingerprintShort}
                  </dd>
                </div>
              ) : null}
            </dl>
            <div className="h-px bg-border-subtle" />
            <button
              type="button"
              onClick={() => setConfirmRevoke(detailDevice)}
              disabled={pendingDeviceId === detailDevice.deviceId}
              className="h-[54px] w-full text-[1.0625rem] text-danger transition-smooth hover:bg-surface-hover active:bg-surface-hover disabled:opacity-45"
            >
              {pendingDeviceId === detailDevice.deviceId ? "Подождите…" : "Завершить сеанс"}
            </button>
            <div className="h-px bg-border-subtle" />
            <button
              type="button"
              onClick={() => setDetailDeviceId(null)}
              className="h-[54px] w-full text-[1.0625rem] font-semibold text-primary transition-smooth hover:bg-surface-hover active:bg-surface-hover"
            >
              Закрыть
            </button>
          </div>
        </div>
      ) : null}

      <ConfirmSheet
        open={Boolean(confirmRevoke)}
        title="Завершить сеанс?"
        body="Устройство перестанет получать новые зашифрованные сообщения."
        confirmLabel="Завершить сеанс"
        busy={pendingDeviceId != null}
        onConfirm={() => { if (confirmRevoke) void revokeDevice(confirmRevoke); }}
        onCancel={() => setConfirmRevoke(null)}
      />

      <ConfirmSheet
        open={confirmRevokeAll}
        title="Завершить все другие сеансы?"
        body="Все устройства, кроме этого, перестанут получать новые зашифрованные сообщения."
        confirmLabel="Завершить все"
        busy={revokeAllPending}
        onConfirm={() => void revokeOtherDevices()}
        onCancel={() => setConfirmRevokeAll(false)}
      />
    </>
  );
}
