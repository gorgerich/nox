"use client";

import { useCallback, useEffect, useState } from "react";

type ContactDevice = {
  deviceId: string;
  name: string | null;
  platform: string | null;
  createdAt: string;
  fingerprint: string;
  fingerprintShort: string;
  isVerified: boolean;
  keyChanged: boolean;
};

export function E2EEUserDevices({ userId }: { userId: string }) {
  const [devices, setDevices] = useState<ContactDevice[]>([]);
  const [error, setError] = useState("");

  const loadDevices = useCallback(async () => {
    setError("");
    const res = await fetch(`/api/e2ee/key-trust?userId=${encodeURIComponent(userId)}`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setError(data?.error || "Не удалось загрузить ключи");
      return;
    }
    setDevices(Array.isArray(data?.devices) ? data.devices : []);
  }, [userId]);

  useEffect(() => {
    queueMicrotask(() => void loadDevices());
  }, [loadDevices]);

  const verifyDevice = async (device: ContactDevice) => {
    const res = await fetch("/api/e2ee/key-trust", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetUserId: userId, targetDeviceId: device.deviceId, publicKeyFingerprint: device.fingerprint, verified: true }),
    });
    if (!res.ok) return;
    await loadDevices();
  };

  return (
    <section className="mt-8 w-full max-w-sm">
      <h3 className="px-1 text-sm font-semibold text-muted">Шифрование</h3>
      <p className="mt-1 px-1 text-xs font-normal text-muted">Ключи устройств и код безопасности</p>
      {error ? <p className="mt-3 rounded-xl bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</p> : null}
      <div className="mt-4 space-y-2">
        {devices.map((device) => (
          <div key={device.deviceId} className="rounded-xl border border-border-subtle bg-surface p-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold text-foreground">{device.name || device.platform || "Nox device"}</p>
              <span className={`rounded-full px-2 py-0.5 text-[0.625rem] font-semibold ${device.isVerified ? "bg-primary/10 text-primary" : "bg-warning/10 text-warning"}`}>{device.isVerified ? "Проверено" : "Не проверено"}</span>
            </div>
            {device.keyChanged ? <p className="mt-2 text-xs font-semibold text-destructive">Ключ устройства изменился</p> : null}
            <p className="mt-2 break-all font-mono text-[0.625rem] leading-relaxed text-muted/45">{device.fingerprintShort}</p>
            {!device.isVerified ? <button onClick={() => void verifyDevice(device)} className="mt-3 rounded-full bg-primary/10 px-3 py-2 text-xs font-semibold text-primary">Проверить</button> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
