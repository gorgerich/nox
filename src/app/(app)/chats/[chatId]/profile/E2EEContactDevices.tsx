"use client";

import { useCallback, useEffect, useState } from "react";

type ContactDevice = {
  deviceId: string;
  name: string | null;
  platform: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
  fingerprint: string;
  fingerprintShort: string;
  isVerified: boolean;
  verifiedAt: string | null;
  keyChanged: boolean;
};

export function E2EEContactDevices({ userId, chatId }: { userId: string; chatId?: string }) {
  const [devices, setDevices] = useState<ContactDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDevices = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ userId });
      if (chatId) params.set("chatId", chatId);
      const res = await fetch(`/api/e2ee/key-trust?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Не удалось загрузить ключи");
      setDevices(Array.isArray(data?.devices) ? data.devices : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить ключи");
    } finally {
      setLoading(false);
    }
  }, [chatId, userId]);

  useEffect(() => {
    queueMicrotask(() => void loadDevices());
  }, [loadDevices]);

  const verifyDevice = async (device: ContactDevice) => {
    const res = await fetch("/api/e2ee/key-trust", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetUserId: userId,
        targetDeviceId: device.deviceId,
        publicKeyFingerprint: device.fingerprint,
        verified: true,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Не удалось подтвердить ключ");
      return;
    }
    await loadDevices();
  };

  return (
    <section className="rounded-2xl border border-border-subtle bg-surface p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-foreground">Шифрование</h3>
        <p className="mt-1 text-xs font-normal text-muted">Ключи устройств собеседника и код безопасности</p>
      </div>
      {loading ? <p className="py-3 text-sm font-medium text-muted">Загрузка ключей...</p> : null}
      {error ? <p className="mb-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p> : null}
      <div className="space-y-2">
        {devices.map((device) => (
          <div key={device.deviceId} className="rounded-xl border border-border-subtle bg-background/50 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{device.name || device.platform || "Nox device"}</p>
                  <span className={`rounded-full px-2 py-0.5 text-[0.625rem] font-semibold ${device.isVerified ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"}`}>
                    {device.isVerified ? "Проверено" : "Не проверено"}
                  </span>
                  {device.keyChanged ? <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[0.625rem] font-semibold text-destructive">Ключ изменился</span> : null}
                </div>
                <p className="mt-1 text-[0.6875rem] font-semibold text-muted">{device.platform || "Web"} · {new Date(device.createdAt).toLocaleDateString("ru-RU")}</p>
                <p className="mt-2 break-all font-mono text-[0.625rem] leading-relaxed text-muted/45">{device.fingerprintShort}</p>
              </div>
              {!device.isVerified ? (
                <button onClick={() => void verifyDevice(device)} className="shrink-0 rounded-full bg-primary/10 px-3 py-2 text-xs font-semibold text-primary active:scale-[0.96]">
                  Проверить
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {!loading && devices.length === 0 ? <p className="py-3 text-sm font-medium text-muted">У собеседника пока нет зарегистрированных E2EE-устройств.</p> : null}
      </div>
    </section>
  );
}
