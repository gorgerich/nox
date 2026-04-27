import * as crypto from "./crypto";
import { ensureKeys, getLocalPrivateKey, fetchRecipientKeyBundle, uploadPublicKeys } from "./keys";

async function createSenderKeyId(publicJwk: string): Promise<string> {
  const encoded = crypto.encode(publicJwk);
  const payload = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(payload).set(encoded);
  const digest = await window.crypto.subtle.digest("SHA-256", payload);
  return `ecdh-p256:${crypto.arrayBufferToBase64(digest).slice(0, 24)}`;
}

/**
 * Encrypts a message for a specific recipient.
 */
export async function encryptMessage(
  plaintext: string,
  recipientUserId: string,
  chatId: string
) {
  const localPublicJwk = await ensureKeys();
  await uploadPublicKeys(localPublicJwk);
  const privateKey = await getLocalPrivateKey();
  if (!privateKey) throw new Error("Local private key missing");

  const recipientPublicJwk = await fetchRecipientKeyBundle(recipientUserId);
  if (!recipientPublicJwk) {
    throw new Error("Recipient hasn't set up encryption yet");
  }

  const peerPublicKey = await crypto.importPublicKey(recipientPublicJwk);
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const info = crypto.encode(chatId); // Use chatId as context

  const aesKey = await crypto.deriveAesKey(privateKey, peerPublicKey, salt, info);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.encrypt(aesKey, plaintext, iv);

  return {
    ciphertext: crypto.arrayBufferToBase64(ciphertext),
    iv: crypto.arrayBufferToBase64(iv.buffer),
    salt: crypto.arrayBufferToBase64(salt.buffer),
    algorithm: crypto.ALGORITHM_NAME,
    encryptionVersion: 1,
    senderKeyId: await createSenderKeyId(localPublicJwk),
  };
}

/**
 * Decrypts a message from a specific sender.
 */
export async function decryptMessage(
  message: {
    ciphertext: string | null;
    iv: string | null;
    salt: string | null;
    chatId: string;
    senderUserId: string;
  },
  senderPublicJwk: string | null
): Promise<string | null> {
  if (!message.ciphertext || !message.iv || !message.salt || !senderPublicJwk) {
    return null;
  }

  try {
    const privateKey = await getLocalPrivateKey();
    if (!privateKey) return null;

    const peerPublicKey = await crypto.importPublicKey(senderPublicJwk);
    const salt = new Uint8Array(crypto.base64ToArrayBuffer(message.salt));
    const info = crypto.encode(message.chatId);

    const aesKey = await crypto.deriveAesKey(privateKey, peerPublicKey, salt, info);
    const iv = new Uint8Array(crypto.base64ToArrayBuffer(message.iv));
    const ciphertext = crypto.base64ToArrayBuffer(message.ciphertext);

    return await crypto.decrypt(aesKey, ciphertext, iv);
  } catch (error) {
    console.error("[e2ee] Decryption failed:", error);
    return null;
  }
}
