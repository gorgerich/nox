/**
 * Nox E2EE IndexedDB Helper
 * Safely stores private keys on the client side.
 */

const DB_NAME = "nox-e2ee";
const KEYS_STORE = "keys";
const MESSAGES_STORE = "messages";
const DB_VERSION = 2;
const LOCAL_MESSAGE_CACHE_VERSION = 1;
const LOCAL_MESSAGE_CACHE_ALGORITHM = "AES-GCM";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function localMessageCacheKeyId(userId: string) {
  return `nox:e2ee:${userId}:localMessageCacheKey`;
}

function toMessageCacheKey(params: { userId: string; messageId: string; chatId: string; deviceId: string }) {
  return `nox:e2ee:${params.userId}:${params.deviceId}:${params.chatId}:${params.messageId}`;
}

async function getOrCreateLocalMessageCacheKey(userId: string): Promise<CryptoKey> {
  const existing = await getKey<CryptoKey>(localMessageCacheKeyId(userId));
  if (existing) return existing;

  const key = await crypto.subtle.generateKey(
    { name: LOCAL_MESSAGE_CACHE_ALGORITHM, length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  await storeKey(localMessageCacheKeyId(userId), key);
  return key;
}

export type StoredLocalMessage = {
  body: string;
};

type EncryptedLocalMessageRecord = {
  encrypted: true;
  version: typeof LOCAL_MESSAGE_CACHE_VERSION;
  algorithm: typeof LOCAL_MESSAGE_CACHE_ALGORITHM;
  iv: string;
  ciphertext: string;
  messageId: string;
  userId: string;
  chatId: string | null;
  deviceId: string | null;
  senderId: string;
  createdAt: string;
  type: string;
  storedAt: string;
};

function isEncryptedLocalMessageRecord(value: unknown): value is EncryptedLocalMessageRecord {
  const record = value as EncryptedLocalMessageRecord;
  return record?.encrypted === true
    && record.version === LOCAL_MESSAGE_CACHE_VERSION
    && record.algorithm === LOCAL_MESSAGE_CACHE_ALGORITHM
    && typeof record.iv === "string"
    && typeof record.ciphertext === "string";
}

export function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KEYS_STORE)) {
        db.createObjectStore(KEYS_STORE);
      }
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        db.createObjectStore(MESSAGES_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeKey(id: string, key: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEYS_STORE, "readwrite");
    const store = transaction.objectStore(KEYS_STORE);
    const request = store.put(key, id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getKey<T>(id: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEYS_STORE, "readonly");
    const store = transaction.objectStore(KEYS_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteKey(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(KEYS_STORE, "readwrite");
    const store = transaction.objectStore(KEYS_STORE);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function putMessageRecord(id: string, payload: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MESSAGES_STORE, "readwrite");
    const store = transaction.objectStore(MESSAGES_STORE);
    const request = store.put(payload, id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getMessageRecord<T>(id: string): Promise<T | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(MESSAGES_STORE, "readonly");
    const store = transaction.objectStore(MESSAGES_STORE);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function storeLocalEncryptedMessage(params: {
  userId: string;
  messageId: string;
  chatId: string;
  deviceId: string;
  senderId: string;
  createdAt: string;
  type: string;
  body: string;
}): Promise<void> {
  const key = await getOrCreateLocalMessageCacheKey(params.userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: LOCAL_MESSAGE_CACHE_ALGORITHM, iv },
    key,
    textEncoder.encode(JSON.stringify({ body: params.body })),
  );
  const record: EncryptedLocalMessageRecord = {
    encrypted: true,
    version: LOCAL_MESSAGE_CACHE_VERSION,
    algorithm: LOCAL_MESSAGE_CACHE_ALGORITHM,
    iv: arrayBufferToBase64(iv.buffer),
    ciphertext: arrayBufferToBase64(ciphertext),
    messageId: params.messageId,
    userId: params.userId,
    chatId: params.chatId,
    deviceId: params.deviceId,
    senderId: params.senderId,
    createdAt: params.createdAt,
    type: params.type,
    storedAt: new Date().toISOString(),
  };

  await putMessageRecord(toMessageCacheKey(params), record);
}

export async function getLocalEncryptedMessage(params: {
  userId: string;
  messageId: string;
  chatId: string;
  deviceId: string;
}): Promise<StoredLocalMessage | null> {
  const record = await getMessageRecord<unknown>(toMessageCacheKey(params));
  if (!isEncryptedLocalMessageRecord(record)) return null;
  if (record.userId !== params.userId || record.deviceId !== params.deviceId || record.chatId !== params.chatId) {
    return null;
  }

  const key = await getOrCreateLocalMessageCacheKey(params.userId);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: LOCAL_MESSAGE_CACHE_ALGORITHM,
      iv: new Uint8Array(base64ToArrayBuffer(record.iv)),
    },
    key,
    base64ToArrayBuffer(record.ciphertext),
  );
  const payload = JSON.parse(textDecoder.decode(new Uint8Array(decrypted))) as Partial<StoredLocalMessage>;
  return typeof payload.body === "string" ? { body: payload.body } : null;
}

export const NOX_E2EE_DB_NAME = DB_NAME;
export const NOX_MESSAGES_STORE = MESSAGES_STORE;
export const NOX_KEYS_STORE = KEYS_STORE;

/** Count records in an object store. */
async function countStore(storeName: string): Promise<number> {
  const db = await openDb();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(storeName, "readonly");
      const req = tx.objectStore(storeName).count();
      req.onsuccess = () => resolve(req.result ?? 0);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

/** Wipe every record in an object store. */
async function clearStore(storeName: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/** Number of cached (encrypted) message bodies on this device. */
export function countCachedMessages(): Promise<number> {
  return countStore(MESSAGES_STORE);
}

/** Remove ALL locally cached message bodies. Safe: they are re-decrypted on demand. */
export function clearCachedMessages(): Promise<void> {
  return clearStore(MESSAGES_STORE);
}

/** Remove cached message bodies for a single chat only. Returns how many were removed. */
export async function clearCachedMessagesForChat(chatId: string): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MESSAGES_STORE, "readwrite");
    const store = tx.objectStore(MESSAGES_STORE);
    const keysReq = store.getAllKeys();
    keysReq.onsuccess = () => {
      const keys = (keysReq.result as IDBValidKey[]).filter(
        (k) => typeof k === "string" && k.includes(`:${chatId}:`),
      );
      let removed = 0;
      if (keys.length === 0) { resolve(0); return; }
      keys.forEach((k) => {
        const del = store.delete(k);
        del.onsuccess = () => { removed += 1; if (removed === keys.length) resolve(removed); };
        del.onerror = () => { removed += 1; if (removed === keys.length) resolve(removed); };
      });
    };
    keysReq.onerror = () => reject(keysReq.error);
  });
}

/**
 * DANGER: wipes the device's E2EE keys (identity + local cache key). After this the
 * device must re-register its keys / re-establish trust. Only for "reset this device".
 */
export function clearCryptoKeys(): Promise<void> {
  return clearStore(KEYS_STORE);
}

export async function storeAndVerifyLocalEncryptedMessage(params: {
  userId: string;
  messageId: string;
  chatId: string;
  deviceId: string;
  senderId: string;
  createdAt: string;
  type: string;
  body: string;
}): Promise<StoredLocalMessage> {
  await storeLocalEncryptedMessage(params);
  const recovered = await getLocalEncryptedMessage(params);
  if (!recovered || recovered.body !== params.body) {
    throw new Error("LOCAL_ENCRYPTED_CACHE_VERIFY_FAILED");
  }
  return recovered;
}
