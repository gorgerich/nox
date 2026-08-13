"use client";

import * as crypto from "./crypto";
import * as db from "./indexed-db";
import {
  generateRecoveryKeyPair,
  openKeyBackup,
  recoveryDeviceId,
  sealKeyBackup,
  type KeyBackupPayload,
} from "./key-backup";

/**
 * Setting up and restoring the account recovery key.
 *
 * The device key never leaves Web Crypto. This is a second keypair whose
 * private half is extractable, sealed under a passphrase and kept by the
 * server as ciphertext. Messages are addressed to it as well as to each
 * device, so a browser that lost its storage — the thing that actually happens
 * here, roughly weekly on iOS — can be handed the history back.
 */

const scopedRecoveryPrivateKey = (userId: string) => `nox:e2ee:${userId}:recoveryPrivateKey`;
const scopedRecoveryPublicKey = (userId: string) => `nox:e2ee:${userId}:recoveryPublicKey`;

export type RecoveryKeyStatus = {
  /** The account has a recovery key on the server. */
  configured: boolean;
  /** This browser holds the private half and can read recovered history. */
  unlockedHere: boolean;
  createdAt: string | null;
};

async function fetchOwnRecoveryKey(): Promise<(KeyBackupPayload & { createdAt?: string }) | null> {
  const response = await fetch("/api/e2ee/recovery-key");
  if (!response.ok) return null;
  const data = (await response.json()) as { recoveryKey?: (KeyBackupPayload & { createdAt?: string }) | null };
  return data.recoveryKey ?? null;
}

export async function getRecoveryKeyStatus(userId: string): Promise<RecoveryKeyStatus> {
  const [remote, localPrivate] = await Promise.all([
    fetchOwnRecoveryKey().catch(() => null),
    db.getKey<CryptoKey>(scopedRecoveryPrivateKey(userId)).catch(() => null),
  ]);
  return {
    configured: Boolean(remote?.ciphertext),
    unlockedHere: Boolean(localPrivate),
    createdAt: remote?.createdAt ?? null,
  };
}

/**
 * Creates the recovery key and seals it under the passphrase.
 *
 * Returns nothing secret: the caller shows the user their passphrase warning,
 * not a key. Replacing an existing recovery key is allowed and leaves earlier
 * envelopes addressed to the old one — which is why the UI must say that
 * history sealed before this moment is not covered.
 */
export async function setUpRecoveryKey(userId: string, passphrase: string): Promise<void> {
  const keyPair = await generateRecoveryKeyPair();
  const publicKey = await crypto.exportPublicKey(keyPair.publicKey);
  const payload = await sealKeyBackup({
    userId,
    deviceId: recoveryDeviceId(userId),
    publicKey,
    privateKey: keyPair.privateKey,
    passphrase,
  });

  const response = await fetch("/api/e2ee/recovery-key", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicKey: payload.publicKey,
      ciphertext: payload.ciphertext,
      iv: payload.iv,
      salt: payload.salt,
      kdf: payload.kdf,
      algorithm: payload.algorithm,
      iterations: payload.iterations,
    }),
  });
  if (!response.ok) throw new Error("RECOVERY_KEY_UPLOAD_FAILED");

  // Held locally too, so the device that created it can read its own recovered
  // history without being asked for the passphrase again.
  await db.storeKey(scopedRecoveryPrivateKey(userId), keyPair.privateKey);
  await db.storeKey(scopedRecoveryPublicKey(userId), publicKey);
}

/**
 * Opens the recovery key on this device.
 *
 * Throws `WRONG_PASSPHRASE_OR_CORRUPT_BACKUP` for both a wrong passphrase and a
 * damaged backup — telling them apart would tell an attacker whether a guess
 * was close.
 */
export async function restoreRecoveryKey(userId: string, passphrase: string): Promise<void> {
  const remote = await fetchOwnRecoveryKey();
  if (!remote?.ciphertext) throw new Error("NO_RECOVERY_KEY");

  const opened = await openKeyBackup(remote, passphrase);
  await db.storeKey(scopedRecoveryPrivateKey(userId), opened.privateKey);
  await db.storeKey(scopedRecoveryPublicKey(userId), opened.publicKey);
}

/** The recovery private key held on this device, if it has been unlocked. */
export async function getLocalRecoveryPrivateKey(userId: string): Promise<CryptoKey | null> {
  return db.getKey<CryptoKey>(scopedRecoveryPrivateKey(userId)).catch(() => null);
}

/** Forgets the recovery key on this device without touching the server copy. */
export async function lockRecoveryKeyHere(userId: string): Promise<void> {
  await db.deleteKey(scopedRecoveryPrivateKey(userId)).catch(() => undefined);
  await db.deleteKey(scopedRecoveryPublicKey(userId)).catch(() => undefined);
}
