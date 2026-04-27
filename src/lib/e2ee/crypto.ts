/**
 * Nox E2EE Crypto Library
 * Uses Web Crypto API for ECDH, HKDF, and AES-GCM.
 */

export const ALGORITHM_NAME = "ECDH-P256-HKDF-SHA256-AES-GCM-v1";

/**
 * Encodes a string to Uint8Array.
 */
export function encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Decodes a Uint8Array to string.
 */
export function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/**
 * Converts ArrayBuffer to Base64 string.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts Base64 string to ArrayBuffer.
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Generates a new ECDH P-256 key pair.
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true, // extractable
    ["deriveKey", "deriveBits"]
  );
}

/**
 * Exports a public key as JWK string.
 */
export async function exportPublicKey(key: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", key);
  return JSON.stringify(jwk);
}

/**
 * Imports a public key from JWK string.
 */
export async function importPublicKey(jwkString: string): Promise<CryptoKey> {
  const jwk = JSON.parse(jwkString);
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );
}

/**
 * Derives a shared secret and then an AES-GCM key using HKDF.
 */
export async function deriveAesKey(
  privateKey: CryptoKey,
  peerPublicKey: CryptoKey,
  salt: Uint8Array,
  info: Uint8Array
): Promise<CryptoKey> {
  const sharedSecret = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: peerPublicKey,
    },
    privateKey,
    256
  );

  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    sharedSecret,
    { name: "HKDF" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      salt: salt as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      info: info as any,
      hash: "SHA-256",
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts plaintext with AES-GCM.
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: string,
  iv: Uint8Array,
  aad?: Uint8Array
): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iv: iv as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      additionalData: aad as any,
    },
    key,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    encode(plaintext) as any
  );
}

/**
 * Decrypts ciphertext with AES-GCM.
 */
export async function decrypt(
  key: CryptoKey,
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  aad?: Uint8Array
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iv: iv as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      additionalData: aad as any,
    },
    key,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ciphertext as any
  );
  return decode(new Uint8Array(decrypted));
}
