/**
 * Nox E2EE Crypto Library
 * Uses Web Crypto API for ECDH, HKDF, and AES-GCM.
 */

export const ALGORITHM_NAME = "ECDH-P256-HKDF-SHA256-AES-GCM";

const textEncoder = new TextEncoder();

function copyToArrayBuffer(value: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (value instanceof ArrayBuffer) {
    return value.slice(0);
  }

  const copy = new ArrayBuffer(value.byteLength);
  new Uint8Array(copy).set(value);
  return copy;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

export function encodeAad(value: unknown): Uint8Array {
  if (value == null) return new Uint8Array();
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return textEncoder.encode(value);
  return textEncoder.encode(stableStringify(value));
}

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
    false, // public key stays exportable; private key cannot be exported from Web Crypto
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
  aadValue?: unknown
): Promise<ArrayBuffer> {
  const aad = encodeAad(aadValue);
  return crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: copyToArrayBuffer(iv),
      additionalData: copyToArrayBuffer(aad),
    },
    key,
    copyToArrayBuffer(encode(plaintext))
  );
}

/**
 * Decrypts ciphertext with AES-GCM.
 */
export async function decrypt(
  key: CryptoKey,
  ciphertext: ArrayBuffer,
  iv: Uint8Array,
  aadValue?: unknown
): Promise<string> {
  const aad = encodeAad(aadValue);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: copyToArrayBuffer(iv),
      additionalData: copyToArrayBuffer(aad),
    },
    key,
    ciphertext
  );
  return decode(new Uint8Array(decrypted));
}
