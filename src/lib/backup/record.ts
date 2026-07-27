/**
 * Normalised backup record and its validator.
 *
 * A backup record is built from the app's *already decrypted* local history
 * (the `messages` store of the nox-e2ee IndexedDB) and re-encrypted under the
 * backup key hierarchy. This module owns the shape and the two boundaries that
 * must not be crossed:
 *
 *  - what may be serialised into a backup (never device identity, tokens, …);
 *  - what a *restored* record is allowed to look like — decrypted JSON is never
 *    trusted, so it is validated before anything touches the local store.
 */

export const BACKUP_RECORD_VERSION = 1 as const;

/** Message types the app understands; anything else is rejected on restore. */
export const ALLOWED_MESSAGE_TYPES = ["TEXT", "IMAGE", "VIDEO", "VIDEO_NOTE", "FILE", "VOICE", "SYSTEM"] as const;
export type BackupMessageType = (typeof ALLOWED_MESSAGE_TYPES)[number];

export const MAX_BODY_CHARS = 64 * 1024;
export const MAX_RECORDS = 500_000;
export const MAX_ATTACHMENTS_PER_RECORD = 32;

export type BackupAttachmentRef = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Media key travels only inside the (encrypted) backup record, never server-side plaintext. */
  fileKey: string | null;
};

export type BackupRecordV1 = {
  v: typeof BACKUP_RECORD_VERSION;
  messageId: string;
  chatId: string;
  senderId: string;
  createdAt: string;
  type: BackupMessageType;
  /** Null for a tombstone; a tombstone carries no body. */
  body: string | null;
  replyToMessageId: string | null;
  editedAt: string | null;
  deletedAt: string | null;
  expiresAt: string | null;
  reactions: { emoji: string; userId: string }[];
  attachments: BackupAttachmentRef[];
};

/** Fields that must never appear in a serialised record, checked by tests. */
export const FORBIDDEN_KEYS = [
  "privateKey",
  "deviceId",
  "deviceIdentity",
  "token",
  "accessToken",
  "sessionCookie",
  "cookie",
  "pushToken",
  "draft",
  "uploadCredential",
  "debug",
] as const;

export type DecryptedLocalMessage = {
  messageId: string;
  chatId: string | null;
  senderId: string;
  createdAt: string;
  type: string;
  body: string;
  replyToMessageId?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  expiresAt?: string | null;
  reactions?: { emoji: string; userId: string }[];
  attachments?: BackupAttachmentRef[];
};

function isExpired(record: { expiresAt?: string | null }, now: number): boolean {
  return Boolean(record.expiresAt) && new Date(record.expiresAt as string).getTime() <= now;
}

/**
 * Turn decrypted local messages into backup records.
 *
 *  - expired messages are dropped entirely (not even a tombstone);
 *  - deleted messages keep only a tombstone: no body, no attachments, no
 *    reactions — the plaintext is not carried;
 *  - everything else is normalised.
 */
export function serializeToBackupRecords(
  messages: DecryptedLocalMessage[],
  now: number = Date.now(),
): BackupRecordV1[] {
  const records: BackupRecordV1[] = [];
  for (const message of messages) {
    if (!message.chatId) continue; // a message with no conversation can't be placed on restore
    if (isExpired(message, now)) continue;

    const deleted = Boolean(message.deletedAt);
    records.push({
      v: BACKUP_RECORD_VERSION,
      messageId: message.messageId,
      chatId: message.chatId,
      senderId: message.senderId,
      createdAt: message.createdAt,
      type: (ALLOWED_MESSAGE_TYPES as readonly string[]).includes(message.type)
        ? (message.type as BackupMessageType)
        : "TEXT",
      body: deleted ? null : message.body,
      replyToMessageId: message.replyToMessageId ?? null,
      editedAt: message.editedAt ?? null,
      deletedAt: message.deletedAt ?? null,
      expiresAt: message.expiresAt ?? null,
      reactions: deleted ? [] : message.reactions ?? [],
      attachments: deleted ? [] : message.attachments ?? [],
    });
  }
  return records;
}

export type ValidationResult = { ok: true; record: BackupRecordV1 } | { ok: false; reason: string };

/** Validates one decrypted record before it is applied locally. Never trusts the JSON. */
export function validateBackupRecord(value: unknown): ValidationResult {
  if (typeof value !== "object" || value === null) return { ok: false, reason: "not an object" };
  const r = value as Record<string, unknown>;

  if (r.v !== BACKUP_RECORD_VERSION) return { ok: false, reason: `unsupported version ${String(r.v)}` };

  const str = (key: string): string | null => (typeof r[key] === "string" ? (r[key] as string) : null);
  const messageId = str("messageId");
  const chatId = str("chatId");
  const senderId = str("senderId");
  const createdAt = str("createdAt");
  if (!messageId || !chatId || !senderId || !createdAt) return { ok: false, reason: "missing required id/timestamp" };
  if (Number.isNaN(Date.parse(createdAt))) return { ok: false, reason: "invalid createdAt" };

  if (typeof r.type !== "string" || !(ALLOWED_MESSAGE_TYPES as readonly string[]).includes(r.type)) {
    return { ok: false, reason: `disallowed type ${String(r.type)}` };
  }

  if (r.body !== null && typeof r.body !== "string") return { ok: false, reason: "body must be string or null" };
  if (typeof r.body === "string" && r.body.length > MAX_BODY_CHARS) return { ok: false, reason: "body too long" };

  for (const optional of ["replyToMessageId", "editedAt", "deletedAt", "expiresAt"]) {
    if (r[optional] !== null && typeof r[optional] !== "string") return { ok: false, reason: `${optional} must be string or null` };
  }

  const reactions = r.reactions;
  if (!Array.isArray(reactions)) return { ok: false, reason: "reactions must be an array" };
  for (const reaction of reactions) {
    const re = reaction as Record<string, unknown>;
    if (typeof re?.emoji !== "string" || typeof re?.userId !== "string") return { ok: false, reason: "malformed reaction" };
  }

  const attachments = r.attachments;
  if (!Array.isArray(attachments)) return { ok: false, reason: "attachments must be an array" };
  if (attachments.length > MAX_ATTACHMENTS_PER_RECORD) return { ok: false, reason: "too many attachments" };
  for (const attachment of attachments) {
    const a = attachment as Record<string, unknown>;
    if (typeof a?.attachmentId !== "string" || typeof a?.fileName !== "string" || typeof a?.mimeType !== "string") {
      return { ok: false, reason: "malformed attachment" };
    }
    if (typeof a?.sizeBytes !== "number" || !Number.isFinite(a.sizeBytes)) return { ok: false, reason: "attachment size invalid" };
    if (a.fileKey !== null && typeof a.fileKey !== "string") return { ok: false, reason: "attachment fileKey invalid" };
  }

  return { ok: true, record: value as BackupRecordV1 };
}

/** Validates a decoded manifest's record list, enforcing the count ceiling. */
export function validateRecordBatch(values: unknown[]): { ok: true; records: BackupRecordV1[] } | { ok: false; reason: string } {
  if (values.length > MAX_RECORDS) return { ok: false, reason: "record count exceeds maximum" };
  const records: BackupRecordV1[] = [];
  for (const value of values) {
    const result = validateBackupRecord(value);
    if (!result.ok) return { ok: false, reason: result.reason };
    records.push(result.record);
  }
  return { ok: true, records };
}

/**
 * On restore, drop records whose expiry has since passed and reduce tombstoned
 * records to a body-less marker, so a stale generation can never resurrect
 * deleted or expired content.
 */
export function applyRestorePolicy(records: BackupRecordV1[], now: number = Date.now()): BackupRecordV1[] {
  const out: BackupRecordV1[] = [];
  for (const record of records) {
    if (record.expiresAt && new Date(record.expiresAt).getTime() <= now) continue;
    if (record.deletedAt) {
      out.push({ ...record, body: null, attachments: [], reactions: [] });
    } else {
      out.push(record);
    }
  }
  return out;
}

/** Deduplicate by stable message id, so replaying a restore never doubles a message. */
export function deduplicateRecords(records: BackupRecordV1[]): BackupRecordV1[] {
  const seen = new Set<string>();
  const out: BackupRecordV1[] = [];
  for (const record of records) {
    if (seen.has(record.messageId)) continue;
    seen.add(record.messageId);
    out.push(record);
  }
  return out;
}
