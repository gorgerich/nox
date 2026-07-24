/**
 * Backup crypto domain.
 *
 * Deliberately separate from the transport E2EE in src/lib/e2ee: nothing here
 * touches device identity keys, MessageEnvelope, or the message protocol. See
 * docs/security/e2ee-history-recovery-design.md (§6.1–6.3) for the design this
 * implements.
 *
 *   Recovery Secret  → (KDF) → recovery wrapping key
 *                            → unwraps Backup Root Key
 *                                     → unwraps per-generation key
 *                                              → encrypts manifest + chunks
 *
 * Only AES-GCM 256 and PBKDF2/HKDF from Web Crypto are used — the primitives
 * already present in this project. No bespoke constructions.
 */

export const BACKUP_SCHEMA_VERSION = 1;
const AES = "AES-GCM";
const KEY_BITS = 256;
const NONCE_BYTES = 12; // 96-bit, the recommended AES-GCM nonce size

/**
 * The recovery secret is 256 bits of CSPRNG output, not a human-chosen
 * password, so the KDF exists for domain separation and format stability
 * rather than to stretch weak entropy. The iteration count is therefore not a
 * security-critical parameter here; it must not be read as making a *password*
 * safe to use as a recovery secret, which is explicitly disallowed.
 */
const KDF_ITERATIONS = 210_000;
const KDF_HASH = "SHA-256";
const KDF_INFO = "nox.backup.recovery.v1";

export type RecordKind = "manifest" | "chunk";
const RECORD_KIND_CODE: Record<RecordKind, number> = { manifest: 0, chunk: 1 };

export type BackupAad = {
  backupId: string;
  accountBinding: string;
  generation: number;
  chunkIndex: number;
  schemaVersion: number;
  recordKind: RecordKind;
  previousManifestHash: string | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.byteLength; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Canonical AAD bytes: fixed field order, length-prefixed, so two different
 * contexts can never serialise to the same byte string.
 */
export function serializeAad(aad: BackupAad): Uint8Array {
  const parts = [
    aad.backupId,
    aad.accountBinding,
    String(aad.generation),
    String(aad.chunkIndex),
    String(aad.schemaVersion),
    aad.recordKind,
    aad.previousManifestHash ?? "",
  ];
  const canonical = parts.map((part) => `${part.length}:${part}`).join("|");
  return encoder.encode(canonical);
}

/**
 * nonce = generationEpoch(32) ‖ recordKind(8) ‖ counter(56)
 *
 * Counters restart per generation, which is safe because every generation gets
 * a freshly generated key — a (key, nonce) pair therefore never repeats. This
 * is why nonces are counter-based rather than random: random 96-bit nonces
 * accumulate birthday-bound collision risk across many payloads under one key.
 */
export function buildNonce(params: { generation: number; recordKind: RecordKind; counter: number }): Uint8Array {
  const { generation, recordKind, counter } = params;
  if (!Number.isInteger(generation) || generation < 0 || generation > 0xffffffff) {
    throw new Error("BACKUP_NONCE_GENERATION_RANGE");
  }
  if (!Number.isInteger(counter) || counter < 0 || counter > Number.MAX_SAFE_INTEGER) {
    throw new Error("BACKUP_NONCE_COUNTER_RANGE");
  }

  const nonce = new Uint8Array(NONCE_BYTES);
  const view = new DataView(nonce.buffer);
  view.setUint32(0, generation, false);
  view.setUint8(4, RECORD_KIND_CODE[recordKind]);
  // 56-bit counter across bytes 5..11. JS safe integers are 53 bits, which
  // fits comfortably; encode big-endian.
  let remaining = counter;
  for (let i = NONCE_BYTES - 1; i >= 5; i -= 1) {
    nonce[i] = remaining & 0xff;
    remaining = Math.floor(remaining / 256);
  }
  return nonce;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

// --- recovery secret --------------------------------------------------------

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1

/**
 * 256 bits of CSPRNG output rendered as grouped base32-ish text with a
 * checksum group, so a mistyped secret is rejected before it is used.
 */
export async function generateRecoverySecret(): Promise<string> {
  const raw = randomBytes(32);
  let out = "";
  for (let i = 0; i < raw.length; i += 1) out += ALPHABET[raw[i] % ALPHABET.length];
  const checksum = await checksumOf(out);
  const body = out.match(/.{1,5}/g)!.join("-");
  return `${body}-${checksum}`;
}

async function checksumOf(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  let out = "";
  for (let i = 0; i < 3; i += 1) out += ALPHABET[digest[i] % ALPHABET.length];
  return out;
}

export async function isRecoverySecretWellFormed(secret: string): Promise<boolean> {
  const compact = secret.trim().toUpperCase().replace(/-/g, "");
  if (compact.length !== 35) return false; // 32 payload + 3 checksum
  const body = compact.slice(0, 32);
  const checksum = compact.slice(32);
  if (![...body].every((ch) => ALPHABET.includes(ch))) return false;
  return (await checksumOf(body)) === checksum;
}

function normalizeSecret(secret: string): string {
  return secret.trim().toUpperCase().replace(/-/g, "").slice(0, 32);
}

// --- key hierarchy ----------------------------------------------------------

async function deriveRecoveryWrappingKey(secret: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", encoder.encode(normalizeSecret(secret)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: KDF_ITERATIONS, hash: KDF_HASH },
    base,
    { name: AES, length: KEY_BITS },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

/** Root and generation keys are extractable so they can be wrapped; they are never uploaded unwrapped. */
async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES, length: KEY_BITS }, true, ["encrypt", "decrypt", "wrapKey", "unwrapKey"]);
}

export type WrappedKey = { wrapped: string; nonce: string; salt?: string };

export async function createBackupRootKey(recoverySecret: string): Promise<{ rootKey: CryptoKey; wrapped: WrappedKey }> {
  const rootKey = await generateAesKey();
  const wrapped = await wrapRootKey(rootKey, recoverySecret);
  return { rootKey, wrapped };
}

export async function wrapRootKey(rootKey: CryptoKey, recoverySecret: string): Promise<WrappedKey> {
  const salt = randomBytes(16);
  const nonce = randomBytes(NONCE_BYTES);
  const wrappingKey = await deriveRecoveryWrappingKey(recoverySecret, salt);
  const wrapped = await crypto.subtle.wrapKey("raw", rootKey, wrappingKey, {
    name: AES,
    iv: nonce as BufferSource,
    additionalData: encoder.encode(KDF_INFO) as BufferSource,
  });
  return { wrapped: toBase64(wrapped), nonce: toBase64(nonce), salt: toBase64(salt) };
}

export async function unwrapRootKey(wrapped: WrappedKey, recoverySecret: string): Promise<CryptoKey> {
  if (!wrapped.salt) throw new Error("BACKUP_ROOT_KEY_SALT_MISSING");
  const wrappingKey = await deriveRecoveryWrappingKey(recoverySecret, fromBase64(wrapped.salt));
  return crypto.subtle.unwrapKey(
    "raw",
    fromBase64(wrapped.wrapped) as BufferSource,
    wrappingKey,
    { name: AES, iv: fromBase64(wrapped.nonce) as BufferSource, additionalData: encoder.encode(KDF_INFO) as BufferSource },
    { name: AES, length: KEY_BITS },
    true,
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
}

export async function createGenerationKey(rootKey: CryptoKey, generation: number): Promise<{ key: CryptoKey; wrapped: WrappedKey }> {
  const key = await generateAesKey();
  const nonce = buildNonce({ generation, recordKind: "manifest", counter: 0 });
  const wrapped = await crypto.subtle.wrapKey("raw", key, rootKey, {
    name: AES,
    iv: nonce as BufferSource,
    additionalData: encoder.encode(`${KDF_INFO}.gen.${generation}`) as BufferSource,
  });
  return { key, wrapped: { wrapped: toBase64(wrapped), nonce: toBase64(nonce) } };
}

export async function unwrapGenerationKey(wrapped: WrappedKey, rootKey: CryptoKey, generation: number): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    "raw",
    fromBase64(wrapped.wrapped) as BufferSource,
    rootKey,
    {
      name: AES,
      iv: fromBase64(wrapped.nonce) as BufferSource,
      additionalData: encoder.encode(`${KDF_INFO}.gen.${generation}`) as BufferSource,
    },
    { name: AES, length: KEY_BITS },
    true,
    ["encrypt", "decrypt"],
  );
}

// --- payload encryption -----------------------------------------------------

export type SealedPayload = { ciphertext: string; nonce: string };

export async function sealPayload(params: {
  generationKey: CryptoKey;
  payload: unknown;
  aad: BackupAad;
  counter: number;
}): Promise<SealedPayload> {
  const nonce = buildNonce({
    generation: params.aad.generation,
    recordKind: params.aad.recordKind,
    counter: params.counter,
  });
  const ciphertext = await crypto.subtle.encrypt(
    { name: AES, iv: nonce as BufferSource, additionalData: serializeAad(params.aad) as BufferSource },
    params.generationKey,
    encoder.encode(JSON.stringify(params.payload)) as BufferSource,
  );
  return { ciphertext: toBase64(ciphertext), nonce: toBase64(nonce) };
}

/** Throws if the ciphertext, the nonce or any AAD field has been altered. */
export async function openPayload<T>(params: {
  generationKey: CryptoKey;
  sealed: SealedPayload;
  aad: BackupAad;
}): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: AES,
      iv: fromBase64(params.sealed.nonce) as BufferSource,
      additionalData: serializeAad(params.aad) as BufferSource,
    },
    params.generationKey,
    fromBase64(params.sealed.ciphertext) as BufferSource,
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

export async function hashManifest(sealed: SealedPayload): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(sealed.ciphertext));
  return toBase64(digest);
}
