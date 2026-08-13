"use client";

/**
 * Key backup: the device's private key, sealed with a key derived from a
 * passphrase only the user knows.
 *
 * Why this exists. The private key lives in IndexedDB, which is evictable —
 * iOS Safari clears script-writable storage for an origin after about a week
 * without interaction. Losing it mints a new device id, and a new device
 * cannot open anything sealed before it existed. Production carries 66 device
 * bundles for 10 users, one of them with 35: not 35 phones, one browser losing
 * its store over and over, and a history that reads "Сообщение недоступно на
 * этом устройстве" a little more each time.
 *
 * The design, and the properties it deliberately keeps:
 *
 *   - **The server stores ciphertext only.** It never receives the passphrase,
 *     the derived key or the private key. A database dump does not open the
 *     backup, which is the whole point of end-to-end encryption surviving the
 *     feature that makes it recoverable.
 *
 *   - **A separate passphrase, not the account password.** Reusing the login
 *     password would mean that whoever obtains it obtains the entire history —
 *     which is not true today, and this feature must not make it true.
 *
 *   - **No server-side recovery path.** A forgotten passphrase means the
 *     backup is gone. An escrow that the operator could open would make the
 *     "end-to-end" claim false, so there is not one.
 *
 *   - **Forward-only.** A backup protects what is sealed after it is made. It
 *     does not retrieve messages already sealed for devices that no longer
 *     exist; nothing can. The UI has to say so plainly.
 *
 * PBKDF2 with SHA-256 is used because it is what WebCrypto offers everywhere
 * this app runs — Argon2 would be preferable and is not available natively.
 * The iteration count is stored with the backup so it can be raised later
 * without stranding existing ones.
 */

/**
 * OWASP's floor for PBKDF2-HMAC-SHA256 at the time of writing. Stored per
 * backup, so raising this only affects new ones and old ones still open.
 */
export const KEY_BACKUP_ITERATIONS = 600_000;
export const KEY_BACKUP_KDF = "PBKDF2-SHA256";
export const KEY_BACKUP_ALGORITHM = "AES-GCM";

/** The shape the server persists. None of it is secret on its own. */
export type KeyBackupPayload = {
  ciphertext: string;
  iv: string;
  salt: string;
  kdf: string;
  algorithm: string;
  iterations: number;
  deviceId: string;
  publicKey: string;
};

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Derives the wrapping key.
 *
 * The user id is mixed into the salt alongside the random half so that two
 * users who choose the same passphrase still derive different keys, and a
 * precomputed table built against one account is useless against another.
 */
async function deriveWrappingKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase.normalize("NFKC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Random half of the salt, bound to the account by the caller. */
function makeSalt(userId: string): Uint8Array {
  const random = crypto.getRandomValues(new Uint8Array(16));
  const account = new TextEncoder().encode(userId);
  const salt = new Uint8Array(random.length + account.length);
  salt.set(random, 0);
  salt.set(account, random.length);
  return salt;
}

/**
 * Seals a device's private key under the passphrase.
 *
 * `privateKey` must be extractable; the caller owns that decision, and the
 * key generated for a device is created extractable precisely so it can be
 * backed up.
 */
export async function sealKeyBackup(input: {
  userId: string;
  deviceId: string;
  publicKey: string;
  privateKey: CryptoKey;
  passphrase: string;
}): Promise<KeyBackupPayload> {
  if (input.passphrase.length < 8) {
    throw new Error("PASSPHRASE_TOO_SHORT");
  }
  const exported = await crypto.subtle.exportKey("pkcs8", input.privateKey);
  const salt = makeSalt(input.userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapping = await deriveWrappingKey(input.passphrase, salt, KEY_BACKUP_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    wrapping,
    exported,
  );

  return {
    ciphertext: toBase64(ciphertext),
    iv: toBase64(iv),
    salt: toBase64(salt),
    kdf: KEY_BACKUP_KDF,
    algorithm: KEY_BACKUP_ALGORITHM,
    iterations: KEY_BACKUP_ITERATIONS,
    deviceId: input.deviceId,
    publicKey: input.publicKey,
  };
}

/**
 * Opens a backup. A wrong passphrase fails here, in AES-GCM's authentication
 * tag, rather than producing a key that silently decrypts nothing.
 */
export async function openKeyBackup(
  payload: KeyBackupPayload,
  passphrase: string,
): Promise<{ deviceId: string; publicKey: string; privateKey: CryptoKey }> {
  const wrapping = await deriveWrappingKey(
    passphrase,
    fromBase64(payload.salt),
    payload.iterations,
  );

  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(payload.iv) as BufferSource },
      wrapping,
      fromBase64(payload.ciphertext) as BufferSource,
    );
  } catch {
    // Indistinguishable from a corrupt backup on purpose: telling the two
    // apart tells an attacker whether a guessed passphrase was close.
    throw new Error("WRONG_PASSPHRASE_OR_CORRUPT_BACKUP");
  }

  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    plain,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );

  return { deviceId: payload.deviceId, publicKey: payload.publicKey, privateKey };
}

/**
 * The synthetic device id an envelope addressed to the recovery key carries.
 *
 * Envelopes are keyed by device, and the recovery key is not a device — but
 * making it look like one means the encryption path needs no special case at
 * all. The prefix keeps it impossible to confuse with a real device id.
 */
export function recoveryDeviceId(userId: string): string {
  return `recovery:${userId}`;
}

/**
 * Generates the account's recovery keypair.
 *
 * Same curve as device keys so envelopes are built identically, but the
 * private half is extractable — that is the entire difference, and the reason
 * this key exists rather than backing up the device key, which stays sealed
 * inside Web Crypto where no script can reach it.
 */
export async function generateRecoveryKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
}
