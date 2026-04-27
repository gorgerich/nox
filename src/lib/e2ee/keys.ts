/**
 * Nox E2EE Key Management
 * Handles device-scoped key generation, storage, and registration.
 */

import * as crypto from "./crypto";
import * as db from "./indexed-db";

const LEGACY_PRIVATE_KEY_ID = "nox-private-key-v1";
const LEGACY_PUBLIC_KEY_ID = "nox-public-key-v1";
const DEVICE_ID_KEY = "nox-device-id-v2";
const DEVICE_PRIVATE_KEY_ID = "nox-device-private-key-v2";
const DEVICE_PUBLIC_KEY_ID = "nox-device-public-key-v2";

export type KeyUploadResult = {
  ok: boolean;
  conflict?: boolean;
  error?: string;
};

export type DeviceKeyBundle = {
  userId: string;
  deviceId: string;
  publicKey: string;
  algorithm: string;
  name?: string | null;
  platform?: string | null;
  lastSeenAt?: string | null;
};

export type LocalDeviceKey = {
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
};

function getBrowserDeviceName() {
  if (typeof navigator === "undefined") return "Nox device";
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || "Web";
  return `Nox ${platform}`;
}

export async function getLocalDeviceId(): Promise<string> {
  const existing = await db.getKey<string>(DEVICE_ID_KEY);
  if (existing) return existing;

  const generated = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await db.storeKey(DEVICE_ID_KEY, generated);
  return generated;
}

/**
 * Legacy v1 helper. Kept only for old user-level encrypted messages.
 */
export async function ensureKeys(): Promise<string> {
  const existingPublic = await db.getKey<string>(LEGACY_PUBLIC_KEY_ID);
  const existingPrivate = await db.getKey<CryptoKey>(LEGACY_PRIVATE_KEY_ID);

  if (existingPublic && existingPrivate) {
    return existingPublic;
  }

  const keyPair = await crypto.generateKeyPair();
  const publicJwk = await crypto.exportPublicKey(keyPair.publicKey);

  await db.storeKey(LEGACY_PRIVATE_KEY_ID, keyPair.privateKey);
  await db.storeKey(LEGACY_PUBLIC_KEY_ID, publicJwk);

  return publicJwk;
}

export async function ensureDeviceKeys(): Promise<LocalDeviceKey> {
  const deviceId = await getLocalDeviceId();
  const existingPublic = await db.getKey<string>(DEVICE_PUBLIC_KEY_ID);
  const existingPrivate = await db.getKey<CryptoKey>(DEVICE_PRIVATE_KEY_ID);

  if (existingPublic && existingPrivate) {
    return { deviceId, publicKey: existingPublic, privateKey: existingPrivate };
  }

  const keyPair = await crypto.generateKeyPair();
  const publicKey = await crypto.exportPublicKey(keyPair.publicKey);

  await db.storeKey(DEVICE_PRIVATE_KEY_ID, keyPair.privateKey);
  await db.storeKey(DEVICE_PUBLIC_KEY_ID, publicKey);

  return { deviceId, publicKey, privateKey: keyPair.privateKey };
}

export async function getLocalPrivateKey(): Promise<CryptoKey | null> {
  return db.getKey<CryptoKey>(LEGACY_PRIVATE_KEY_ID);
}

export async function getLocalPublicJwk(): Promise<string | null> {
  return db.getKey<string>(LEGACY_PUBLIC_KEY_ID);
}

export async function getLocalDevicePrivateKey(): Promise<CryptoKey | null> {
  return db.getKey<CryptoKey>(DEVICE_PRIVATE_KEY_ID);
}

export async function clearKeys(): Promise<void> {
  await db.deleteKey(LEGACY_PRIVATE_KEY_ID);
  await db.deleteKey(LEGACY_PUBLIC_KEY_ID);
  await db.deleteKey(DEVICE_PRIVATE_KEY_ID);
  await db.deleteKey(DEVICE_PUBLIC_KEY_ID);
}

export async function fetchRecipientKeyBundle(userId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/e2ee/key-bundle?userId=${userId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.keyBundle?.ecdhPublicKey || null;
  } catch {
    return null;
  }
}

export async function uploadPublicKeys(ecdhPublicKey: string): Promise<KeyUploadResult> {
  try {
    const res = await fetch("/api/e2ee/key-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ecdhPublicKey }),
    });
    if (res.ok) return { ok: true };

    const data = await res.json().catch(() => null);
    return {
      ok: false,
      conflict: res.status === 409,
      error: data?.error || "KEY_UPLOAD_FAILED",
    };
  } catch {
    return { ok: false, error: "KEY_UPLOAD_FAILED" };
  }
}

export async function registerCurrentDevice(): Promise<LocalDeviceKey> {
  const local = await ensureDeviceKeys();
  const res = await fetch("/api/e2ee/devices/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: local.deviceId,
      publicKey: local.publicKey,
      algorithm: crypto.ALGORITHM_NAME,
      name: getBrowserDeviceName(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      platform: typeof navigator !== "undefined"
        ? ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform)
        : undefined,
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Не удалось зарегистрировать устройство шифрования");
  }

  return local;
}

export async function fetchUserDeviceBundles(userId: string, chatId?: string): Promise<DeviceKeyBundle[]> {
  const params = new URLSearchParams({ userId });
  if (chatId) params.set("chatId", chatId);
  const res = await fetch(`/api/e2ee/devices?${params.toString()}`);
  if (!res.ok) {
    throw new Error("Не удалось получить ключи шифрования. Попробуйте снова.");
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.devices) ? data.devices : [];
}

export async function fetchCurrentUserDeviceBundles(): Promise<DeviceKeyBundle[]> {
  const res = await fetch("/api/e2ee/devices");
  if (!res.ok) {
    throw new Error("Не удалось получить ключи шифрования. Попробуйте снова.");
  }
  const data = await res.json().catch(() => null);
  return Array.isArray(data?.devices) ? data.devices : [];
}

export async function fetchDeviceKeyBundle(deviceId: string): Promise<DeviceKeyBundle | null> {
  const res = await fetch(`/api/e2ee/devices?deviceId=${encodeURIComponent(deviceId)}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.device || null;
}
