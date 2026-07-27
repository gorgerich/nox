/**
 * Nox E2EE IndexedDB Helper
 * Safely stores private keys on the client side.
 */

const DB_NAME = "nox-e2ee";
const KEYS_STORE = "keys";
const MESSAGES_STORE = "messages";
// Persistent per-chat message metadata for instant cold-open. Holds the
// CIPHERTEXT serialized server messages (envelopes, ids, sender, type) — never
// plaintext. Decrypted bodies come from MESSAGES_STORE (encrypted at rest).
const CHATMSGS_STORE = "chatmsgs";
// v4 adds PENDING_STORE. The upgrade is purely additive — existing stores are
// only created when absent — so verified message history survives it.
const PENDING_STORE = "pending";
// v5 adds OUTBOX_BLOB_STORE: the bytes of an attachment that has been accepted
// locally but not yet uploaded. Without it a reload during an upload loses the
// file, and the message could only ever be cancelled, never retried. Also
// additive, so verified history and pending text messages survive it.
const OUTBOX_BLOB_STORE = "outbox-blobs";
const DB_VERSION = 5;
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
      if (!db.objectStoreNames.contains(CHATMSGS_STORE)) {
        db.createObjectStore(CHATMSGS_STORE);
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE);
      }
      if (!db.objectStoreNames.contains(OUTBOX_BLOB_STORE)) {
        db.createObjectStore(OUTBOX_BLOB_STORE);
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

// --- Persistent per-chat message metadata (instant cold-open) --------------
// CIPHERTEXT only: serialized server messages (envelopes/ids/sender/type) plus
// a small header. Never plaintext — decrypted bodies live encrypted-at-rest in
// MESSAGES_STORE. Survives reload so the chat list / chat screen can paint from
// disk instantly while the server revalidates.

export type PersistedChatHeader = {
  title: string;
  avatarUrl: string | null;
  isSelfChat: boolean;
};

export type PersistedChatMessages = {
  messages: unknown[];
  header: PersistedChatHeader | null;
  ts: number;
};

export async function putPersistedChatMessages(chatId: string, record: PersistedChatMessages): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(CHATMSGS_STORE, "readwrite");
      tx.objectStore(CHATMSGS_STORE).put(record, chatId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}

export async function getPersistedChatMessages(chatId: string): Promise<PersistedChatMessages | null> {
  const db = await openDb();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CHATMSGS_STORE, "readonly");
      const req = tx.objectStore(CHATMSGS_STORE).get(chatId);
      req.onsuccess = () => resolve((req.result as PersistedChatMessages) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function getAllPersistedChatMessages(): Promise<{ chatId: string; record: PersistedChatMessages }[]> {
  const db = await openDb();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CHATMSGS_STORE, "readonly");
      const store = tx.objectStore(CHATMSGS_STORE);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const keys = (keysReq.result as IDBValidKey[]) ?? [];
        const vals = (valsReq.result as PersistedChatMessages[]) ?? [];
        const out: { chatId: string; record: PersistedChatMessages }[] = [];
        for (let i = 0; i < keys.length; i += 1) {
          if (typeof keys[i] === "string" && vals[i]) {
            out.push({ chatId: keys[i] as string, record: vals[i] });
          }
        }
        resolve(out);
      };
      tx.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export function clearPersistedChatMessages(): Promise<void> {
  return clearStore(CHATMSGS_STORE);
}

export async function clearPersistedChatMessagesForChat(chatId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(CHATMSGS_STORE, "readwrite");
      tx.objectStore(CHATMSGS_STORE).delete(chatId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    } catch (error) {
      reject(error);
    }
  });
}


// --- outgoing messages that are not yet committed --------------------------
//
// A pending or failed message must not live only in React state: leaving the
// chat used to destroy it, so the user's text disappeared. These records are
// written *before* the network request and updated in place as the status
// advances, so a remount or reload can restore them.
//
// No auth token, transport private key or other secret belongs in here.

/**
 * What a pending attachment needs in order to be re-rendered and re-sent after
 * a reload. Only metadata — the bytes live in the outbox blob store, keyed by
 * the same client id.
 */
export type PendingAttachmentMeta = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** The message type the server will assign, so the bubble looks right offline. */
  kind: "IMAGE" | "VIDEO" | "VIDEO_NOTE" | "VOICE" | "FILE";
  /** True once the bytes are in the outbox store and a retry can re-upload. */
  staged: boolean;
};

export type PendingMessageRecord = {
  renderKey: string;
  clientMessageId: string;
  serverId: string | null;
  chatId: string;
  senderUserId: string;
  body: string | null;
  status: "queued" | "encrypting" | "uploading" | "sending" | "sent" | "delivered" | "read" | "failed";
  createdAt: string;
  serverCreatedAt: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
  updatedAt: string;
  attachment?: PendingAttachmentMeta | null;
};

function pendingKey(userId: string, clientMessageId: string) {
  return `${userId}:${clientMessageId}`;
}

export const NOX_OUTBOX_BLOB_STORE = OUTBOX_BLOB_STORE;

/**
 * Stages the bytes of an outgoing attachment.
 *
 * This is what lets an attachment behave like a text message: the file is
 * durable before the composer clears, so a reload, a crash or a failed upload
 * leaves something that can actually be retried rather than a bubble with no
 * data behind it. A raw File must never go anywhere else — localStorage cannot
 * hold one, and holding it only in memory is the bug being fixed.
 */
export async function putOutgoingBlob(userId: string, clientMessageId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_BLOB_STORE, "readwrite");
    tx.objectStore(OUTBOX_BLOB_STORE).put(blob, pendingKey(userId, clientMessageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getOutgoingBlob(userId: string, clientMessageId: string): Promise<Blob | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_BLOB_STORE, "readonly");
    const request = tx.objectStore(OUTBOX_BLOB_STORE).get(pendingKey(userId, clientMessageId));
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

/** Called once the server holds the attachment; the local copy is then dead weight. */
export async function deleteOutgoingBlob(userId: string, clientMessageId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_BLOB_STORE, "readwrite");
    tx.objectStore(OUTBOX_BLOB_STORE).delete(pendingKey(userId, clientMessageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export const NOX_PENDING_STORE = PENDING_STORE;

/** Writes or updates a pending record. Keyed by client id, so it never doubles. */
export async function putPendingMessage(userId: string, record: PendingMessageRecord): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readwrite");
    tx.objectStore(PENDING_STORE).put({ ...record, updatedAt: new Date().toISOString() }, pendingKey(userId, record.clientMessageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingMessages(userId: string, chatId: string): Promise<PendingMessageRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readonly");
    const request = tx.objectStore(PENDING_STORE).getAll();
    request.onsuccess = () => {
      const all = (request.result ?? []) as PendingMessageRecord[];
      resolve(all.filter((record) => record && record.senderUserId === userId && record.chatId === chatId));
    };
    request.onerror = () => reject(request.error);
  });
}

/** Called once a message is canonical and cached elsewhere. */
export async function deletePendingMessage(userId: string, clientMessageId: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readwrite");
    tx.objectStore(PENDING_STORE).delete(pendingKey(userId, clientMessageId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * A send that was in flight when the tab died cannot be known to have
 * committed, so it is moved to a retryable state rather than left spinning.
 */
export async function recoverInterruptedSends(userId: string): Promise<number> {
  const db = await openDb();
  const records = await new Promise<PendingMessageRecord[]>((resolve, reject) => {
    const tx = db.transaction(PENDING_STORE, "readonly");
    const request = tx.objectStore(PENDING_STORE).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as PendingMessageRecord[]);
    request.onerror = () => reject(request.error);
  });

  let recovered = 0;
  for (const record of records) {
    if (!record || record.senderUserId !== userId) continue;
    if (record.serverId) continue;
    if (record.status !== "sending" && record.status !== "encrypting") continue;
    await putPendingMessage(userId, { ...record, status: "failed", lastErrorCode: "INTERRUPTED" });
    recovered += 1;
  }
  return recovered;
}
