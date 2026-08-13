/**
 * Nox E2EE Key Management
 * Handles user-scoped device key generation, storage, and registration.
 */

import * as crypto from "./crypto";
import * as db from "./indexed-db";

const LEGACY_PRIVATE_KEY_ID = "nox-private-key-v1";
const LEGACY_PUBLIC_KEY_ID = "nox-public-key-v1";
const LEGACY_DEVICE_ID_KEY = "nox-device-id-v2";
const LEGACY_DEVICE_PRIVATE_KEY_ID = "nox-device-private-key-v2";
const LEGACY_DEVICE_PUBLIC_KEY_ID = "nox-device-public-key-v2";

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

function scopedDeviceIdKey(userId: string) {
  return `nox:e2ee:${userId}:deviceId`;
}

function scopedDevicePrivateKey(userId: string) {
  return `nox:e2ee:${userId}:privateKey`;
}

function scopedDevicePublicKey(userId: string) {
  return `nox:e2ee:${userId}:publicKey`;
}

function getBrowserDeviceName() {
  if (typeof navigator === "undefined") return "Nox device";
  const userAgentData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = userAgentData?.platform || navigator.platform || "Web";
  return `Nox ${platform}`;
}

/**
 * Asks the browser not to evict this origin's storage.
 *
 * The device's private key lives in IndexedDB, and IndexedDB is evictable. A
 * cleared store means a new device id, and a new device cannot read anything
 * sealed before it existed — which is what "Сообщение недоступно на этом
 * устройстве" is. Production carries 66 device bundles for 10 users, one of
 * them with 35: that is not 35 phones, it is one browser losing its store over
 * and over.
 *
 * Granted, this is a request. Chromium grants it on engagement, Firefox
 * prompts, and iOS Safari does not implement it at all — so it narrows the
 * problem rather than closing it. Closing it needs key backup, which is a
 * separate piece of work with its own security design.
 */
async function requestDurableStorage() {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return;
    if (await navigator.storage.persisted?.()) return;
    await navigator.storage.persist();
  } catch {
    // Never block device registration on a storage hint.
  }
}

async function generateDeviceId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function clearUserDeviceKeys(userId: string) {
  await db.deleteKey(scopedDeviceIdKey(userId));
  await db.deleteKey(scopedDevicePrivateKey(userId));
  await db.deleteKey(scopedDevicePublicKey(userId));
}

async function storeScopedDeviceKey(userId: string, local: LocalDeviceKey) {
  await db.storeKey(scopedDeviceIdKey(userId), local.deviceId);
  await db.storeKey(scopedDevicePrivateKey(userId), local.privateKey);
  await db.storeKey(scopedDevicePublicKey(userId), local.publicKey);
}

async function createScopedDeviceKey(userId: string): Promise<LocalDeviceKey> {
  await requestDurableStorage();
  const deviceId = await generateDeviceId();
  const keyPair = await crypto.generateKeyPair();
  const publicKey = await crypto.exportPublicKey(keyPair.publicKey);
  const local = { deviceId, publicKey, privateKey: keyPair.privateKey };
  await storeScopedDeviceKey(userId, local);
  return local;
}

async function tryMigrateLegacyDeviceKey(userId: string): Promise<LocalDeviceKey | null> {
  const legacyDeviceId = await db.getKey<string>(LEGACY_DEVICE_ID_KEY);
  const legacyPublic = await db.getKey<string>(LEGACY_DEVICE_PUBLIC_KEY_ID);
  const legacyPrivate = await db.getKey<CryptoKey>(LEGACY_DEVICE_PRIVATE_KEY_ID);
  if (!legacyDeviceId || !legacyPublic || !legacyPrivate) return null;

  const res = await fetch(`/api/e2ee/devices?deviceId=${encodeURIComponent(legacyDeviceId)}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (data?.device?.userId !== userId || data.device.publicKey !== legacyPublic) return null;

  const local = { deviceId: legacyDeviceId, publicKey: legacyPublic, privateKey: legacyPrivate };
  await storeScopedDeviceKey(userId, local);
  return local;
}

export async function getLocalDeviceId(userId: string): Promise<string> {
  const existing = await db.getKey<string>(scopedDeviceIdKey(userId));
  if (existing) return existing;

  return (await ensureDeviceKeys(userId)).deviceId;
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

export async function ensureDeviceKeys(userId: string): Promise<LocalDeviceKey> {
  const deviceId = await db.getKey<string>(scopedDeviceIdKey(userId));
  const existingPublic = await db.getKey<string>(scopedDevicePublicKey(userId));
  const existingPrivate = await db.getKey<CryptoKey>(scopedDevicePrivateKey(userId));

  if (deviceId && existingPublic && existingPrivate) {
    return { deviceId, publicKey: existingPublic, privateKey: existingPrivate };
  }

  const migrated = await tryMigrateLegacyDeviceKey(userId).catch(() => null);
  if (migrated) return migrated;

  await clearUserDeviceKeys(userId);
  return createScopedDeviceKey(userId);
}

export async function getLocalPrivateKey(): Promise<CryptoKey | null> {
  return db.getKey<CryptoKey>(LEGACY_PRIVATE_KEY_ID);
}

export async function getLocalPublicJwk(): Promise<string | null> {
  return db.getKey<string>(LEGACY_PUBLIC_KEY_ID);
}

export async function getLocalDevicePrivateKey(userId: string): Promise<CryptoKey | null> {
  return db.getKey<CryptoKey>(scopedDevicePrivateKey(userId));
}

export async function clearKeys(userId?: string): Promise<void> {
  if (userId) {
    await clearUserDeviceKeys(userId);
    return;
  }

  await db.deleteKey(LEGACY_PRIVATE_KEY_ID);
  await db.deleteKey(LEGACY_PUBLIC_KEY_ID);
  await db.deleteKey(LEGACY_DEVICE_ID_KEY);
  await db.deleteKey(LEGACY_DEVICE_PRIVATE_KEY_ID);
  await db.deleteKey(LEGACY_DEVICE_PUBLIC_KEY_ID);
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

async function postDeviceRegistration(local: LocalDeviceKey) {
  return fetch("/api/e2ee/devices/register", {
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
}

// registerCurrentDevice runs on every message send (inside encryptMessageForDevices).
// The local key part is cheap, but the POST registration is a network round-trip.
// Cache a successful registration per user for a short TTL and de-dupe concurrent
// calls, so a burst of sends does one POST instead of one each. Revocation still
// surfaces within one TTL window.
const REGISTER_TTL_MS = 60_000;
const deviceRegisteredUntil = new Map<string, number>();
const inflightRegister = new Map<string, Promise<LocalDeviceKey>>();

export async function registerCurrentDevice(userId: string): Promise<LocalDeviceKey> {
  const until = deviceRegisteredUntil.get(userId);
  if (until && until > Date.now()) {
    return ensureDeviceKeys(userId);
  }
  const existing = inflightRegister.get(userId);
  if (existing) return existing;

  const run = registerCurrentDeviceUncached(userId)
    .then((local) => {
      deviceRegisteredUntil.set(userId, Date.now() + REGISTER_TTL_MS);
      return local;
    })
    .finally(() => {
      inflightRegister.delete(userId);
    });
  inflightRegister.set(userId, run);
  return run;
}

async function registerCurrentDeviceUncached(userId: string): Promise<LocalDeviceKey> {
  const local = await ensureDeviceKeys(userId);
  const res = await postDeviceRegistration(local);

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (data?.error === "DEVICE_REVOKED") {
      throw new Error("Это устройство отозвано. Оно больше не может отправлять и получать новые зашифрованные сообщения.");
    }

    if (["DEVICE_KEY_MISMATCH", "DEVICE_BELONGS_TO_ANOTHER_USER"].includes(data?.error)) {
      await clearUserDeviceKeys(userId);
      const newLocal = await createScopedDeviceKey(userId);
      const retryRes = await postDeviceRegistration(newLocal);
      if (!retryRes.ok) {
        throw new Error("Не удалось перерегистрировать устройство после сброса");
      }
      invalidateDeviceBundleCache(); // new device → stale bundles
      return newLocal;
    }
    throw new Error(data?.error || "Не удалось зарегистрировать устройство шифрования");
  }

  return local;
}

// Device bundles changed rarely (only when a user adds/revokes a device), but
// were fetched over the network on EVERY message send (2 round-trips before the
// POST), which made sending feel slow. Cache successful, non-empty results for a
// short TTL so consecutive sends skip the network. A new device still propagates
// within one TTL window; explicit invalidation handles register/revoke.
type BundleCacheEntry = { devices: DeviceKeyBundle[]; expires: number };
const deviceBundleCache = new Map<string, BundleCacheEntry>();
const DEVICE_BUNDLE_TTL_MS = 60_000;

function readBundleCache(key: string): DeviceKeyBundle[] | null {
  const entry = deviceBundleCache.get(key);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    deviceBundleCache.delete(key);
    return null;
  }
  return entry.devices;
}

function writeBundleCache(key: string, devices: DeviceKeyBundle[]) {
  // Don't cache empty results — recipient may be mid-registration; we want the
  // next send to re-check quickly rather than fail for a whole TTL window.
  if (devices.length === 0) return;
  deviceBundleCache.set(key, { devices, expires: Date.now() + DEVICE_BUNDLE_TTL_MS });
}

/** Drop cached device bundles. Call after registering/revoking a device. */
export function invalidateDeviceBundleCache() {
  deviceBundleCache.clear();
}

export async function fetchUserDeviceBundles(userId: string, chatId?: string): Promise<DeviceKeyBundle[]> {
  const cacheKey = chatId ? `${userId}:${chatId}` : userId;
  const cached = readBundleCache(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ userId });
  if (chatId) params.set("chatId", chatId);
  const res = await fetch(`/api/e2ee/devices?${params.toString()}`);
  if (!res.ok) {
    throw new Error("Не удалось получить ключи шифрования. Попробуйте снова.");
  }
  const data = await res.json().catch(() => null);
  const devices = Array.isArray(data?.devices) ? data.devices : [];
  writeBundleCache(cacheKey, devices);
  return devices;
}

export async function fetchCurrentUserDeviceBundles(): Promise<DeviceKeyBundle[]> {
  const cached = readBundleCache("self");
  if (cached) return cached;

  const res = await fetch("/api/e2ee/devices");
  if (!res.ok) {
    throw new Error("Не удалось получить ключи шифрования. Попробуйте снова.");
  }
  const data = await res.json().catch(() => null);
  const devices = Array.isArray(data?.devices) ? data.devices : [];
  writeBundleCache("self", devices);
  return devices;
}

export async function fetchDeviceKeyBundle(deviceId: string): Promise<DeviceKeyBundle | null> {
  const res = await fetch(`/api/e2ee/devices?deviceId=${encodeURIComponent(deviceId)}`);
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return data?.device || null;
}
