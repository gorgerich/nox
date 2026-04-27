/**
 * Nox E2EE Key Management
 * Handles key generation, storage, and retrieval.
 */

import * as crypto from "./crypto";
import * as db from "./indexed-db";

const PRIVATE_KEY_ID = "nox-private-key-v1";
const PUBLIC_KEY_ID = "nox-public-key-v1";

/**
 * Ensures the user has a key pair generated and stored.
 * Returns the public key (JWK string).
 */
export async function ensureKeys(): Promise<string> {
  const existingPublic = await db.getKey<string>(PUBLIC_KEY_ID);
  const existingPrivate = await db.getKey<CryptoKey>(PRIVATE_KEY_ID);

  if (existingPublic && existingPrivate) {
    return existingPublic;
  }

  // Generate new key pair
  const keyPair = await crypto.generateKeyPair();
  const publicJwk = await crypto.exportPublicKey(keyPair.publicKey);

  // Store in IndexedDB
  await db.storeKey(PRIVATE_KEY_ID, keyPair.privateKey);
  await db.storeKey(PUBLIC_KEY_ID, publicJwk);

  return publicJwk;
}

/**
 * Gets the local private key.
 */
export async function getLocalPrivateKey(): Promise<CryptoKey | null> {
  return db.getKey<CryptoKey>(PRIVATE_KEY_ID);
}

/**
 * Gets the local public key (JWK).
 */
export async function getLocalPublicJwk(): Promise<string | null> {
  return db.getKey<string>(PUBLIC_KEY_ID);
}

/**
 * Clears local keys.
 */
export async function clearKeys(): Promise<void> {
  await db.deleteKey(PRIVATE_KEY_ID);
  await db.deleteKey(PUBLIC_KEY_ID);
}

/**
 * Key Bundle fetching from server.
 */
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

/**
 * Key Bundle uploading to server.
 */
export async function uploadPublicKeys(ecdhPublicKey: string): Promise<boolean> {
  try {
    const res = await fetch("/api/e2ee/key-bundle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ecdhPublicKey }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
