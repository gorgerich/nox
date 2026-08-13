import * as crypto from "./crypto";
import { recoveryDeviceId } from "./key-backup";
import { getLocalRecoveryPrivateKey } from "./recovery";
import {
  DeviceKeyBundle,
  ensureKeys,
  fetchCurrentUserDeviceBundles,
  fetchDeviceKeyBundle,
  fetchRecipientKeyBundle,
  fetchUserDeviceBundles,
  getLocalDevicePrivateKey,
  getLocalPrivateKey,
  registerCurrentDevice,
  uploadPublicKeys,
} from "./keys";

export type MessageEnvelopePayload = {
  recipientUserId: string;
  recipientDeviceId: string;
  senderDeviceId: string;
  ciphertext: string;
  iv: string;
  salt: string;
  algorithm: string;
  encryptionVersion: 2;
};

export type EncryptedMessageV2Payload = {
  encrypted: true;
  encryptionVersion: 2;
  senderDeviceId: string;
  envelopes: MessageEnvelopePayload[];
};

async function createSenderKeyId(publicJwk: string): Promise<string> {
  const encoded = crypto.encode(publicJwk);
  const payload = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(payload).set(encoded);
  const digest = await window.crypto.subtle.digest("SHA-256", payload);
  return `ecdh-p256:${crypto.arrayBufferToBase64(digest).slice(0, 24)}`;
}

function envelopeContext(params: {
  chatId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
  algorithm: string;
  encryptionVersion: number;
}) {
  return {
    algorithm: params.algorithm,
    chatId: params.chatId,
    encryptionVersion: params.encryptionVersion,
    recipientDeviceId: params.recipientDeviceId,
    recipientUserId: params.recipientUserId,
    senderDeviceId: params.senderDeviceId,
    senderUserId: params.senderUserId,
  };
}

async function encryptEnvelope(params: {
  plaintext: string;
  chatId: string;
  senderUserId: string;
  senderDeviceId: string;
  senderPrivateKey: CryptoKey;
  targetDevice: DeviceKeyBundle;
}): Promise<MessageEnvelopePayload> {
  const encryptionVersion = 2;
  const algorithm = crypto.ALGORITHM_NAME;
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const peerPublicKey = await crypto.importPublicKey(params.targetDevice.publicKey);
  const aad = envelopeContext({
    chatId: params.chatId,
    senderUserId: params.senderUserId,
    senderDeviceId: params.senderDeviceId,
    recipientUserId: params.targetDevice.userId,
    recipientDeviceId: params.targetDevice.deviceId,
    algorithm,
    encryptionVersion,
  });
  const aesKey = await crypto.deriveAesKey(params.senderPrivateKey, peerPublicKey, salt, crypto.encodeAad(aad));
  const ciphertext = await crypto.encrypt(aesKey, params.plaintext, iv, aad);

  return {
    recipientUserId: params.targetDevice.userId,
    recipientDeviceId: params.targetDevice.deviceId,
    senderDeviceId: params.senderDeviceId,
    ciphertext: crypto.arrayBufferToBase64(ciphertext),
    iv: crypto.arrayBufferToBase64(iv.buffer),
    salt: crypto.arrayBufferToBase64(salt.buffer),
    algorithm,
    encryptionVersion,
  };
}

function uniqueDevices(devices: DeviceKeyBundle[]) {
  const byDevice = new Map<string, DeviceKeyBundle>();
  for (const device of devices) {
    if (!device.deviceId || !device.publicKey) continue;
    byDevice.set(device.deviceId, device);
  }
  return Array.from(byDevice.values());
}

/**
 * The recovery keys to address alongside the devices.
 *
 * A recovery key is shaped as a `DeviceKeyBundle` so the encryption path below
 * needs no special case: it is one more recipient in the same list. Both sides
 * are fetched — the recipient's so they can restore, and the sender's own so
 * that a sender who loses their device can still read what they sent.
 *
 * Failure here is not fatal. An account without a recovery key is the state
 * every account is in before setting one up, and a message must still send.
 */
async function fetchRecoveryBundles(
  recipientUserId: string,
  senderUserId: string,
  chatId: string,
): Promise<DeviceKeyBundle[]> {
  const wanted = recipientUserId === senderUserId ? [senderUserId] : [recipientUserId, senderUserId];
  const found = await Promise.all(
    wanted.map(async (userId) => {
      try {
        const query = new URLSearchParams({ userId, chatId });
        const response = await fetch(`/api/e2ee/recovery-key?${query.toString()}`);
        if (!response.ok) return null;
        const data = (await response.json()) as { recoveryKey?: { publicKey?: string } | null };
        const publicKey = data.recoveryKey?.publicKey;
        if (!publicKey) return null;
        return {
          userId,
          deviceId: recoveryDeviceId(userId),
          publicKey,
          algorithm: crypto.ALGORITHM_NAME,
        } satisfies DeviceKeyBundle;
      } catch {
        return null;
      }
    }),
  );
  return found.filter((bundle): bundle is DeviceKeyBundle => bundle !== null);
}

export async function encryptMessageForDevices(
  plaintext: string,
  recipientUserId: string,
  chatId: string,
  senderUserId: string,
): Promise<EncryptedMessageV2Payload> {
  const local = await registerCurrentDevice(senderUserId);
  const [recipientDevices, senderDevices, recoveryBundles] = await Promise.all([
    fetchUserDeviceBundles(recipientUserId, chatId),
    fetchCurrentUserDeviceBundles(),
    fetchRecoveryBundles(recipientUserId, senderUserId, chatId),
  ]);

  if (recipientDevices.length === 0) {
    throw new Error("У собеседника ещё нет ключа шифрования. Попросите его открыть приложение.");
  }

  const targetDevices = uniqueDevices([...recipientDevices, ...senderDevices, ...recoveryBundles]);
  if (!targetDevices.some((device) => device.deviceId === local.deviceId)) {
    targetDevices.push({
      userId: senderUserId,
      deviceId: local.deviceId,
      publicKey: local.publicKey,
      algorithm: crypto.ALGORITHM_NAME,
    });
  }

  const envelopes = await Promise.all(
    targetDevices.map((targetDevice) =>
      encryptEnvelope({
        plaintext,
        chatId,
        senderUserId,
        senderDeviceId: local.deviceId,
        senderPrivateKey: local.privateKey,
        targetDevice,
      }),
    ),
  );

  return {
    encrypted: true,
    encryptionVersion: 2,
    senderDeviceId: local.deviceId,
    envelopes,
  };
}

/**
 * Legacy v1 encryption. Kept only for compatibility with old callers.
 */
export async function encryptMessage(
  plaintext: string,
  recipientUserId: string,
  chatId: string,
  senderUserId: string
) {
  const localPublicJwk = await ensureKeys();
  const uploadResult = await uploadPublicKeys(localPublicJwk);
  if (!uploadResult.ok) {
    if (uploadResult.conflict) {
      throw new Error("На этом устройстве нет ключа шифрования аккаунта. Старые сообщения могут быть недоступны.");
    }

    throw new Error("Не удалось подготовить ключ шифрования на этом устройстве");
  }

  const privateKey = await getLocalPrivateKey();
  if (!privateKey) throw new Error("Local private key missing");

  const recipientPublicJwk = await fetchRecipientKeyBundle(recipientUserId);
  if (!recipientPublicJwk) {
    throw new Error("Recipient hasn't set up encryption yet");
  }

  const peerPublicKey = await crypto.importPublicKey(recipientPublicJwk);
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const info = crypto.encode(chatId);

  const aesKey = await crypto.deriveAesKey(privateKey, peerPublicKey, salt, info);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptionVersion = 1;
  const aad = {
    algorithm: crypto.ALGORITHM_NAME,
    chatId,
    encryptionVersion,
    recipientId: recipientUserId,
    senderId: senderUserId,
  };

  const ciphertext = await crypto.encrypt(aesKey, plaintext, iv, aad);

  return {
    ciphertext: crypto.arrayBufferToBase64(ciphertext),
    iv: crypto.arrayBufferToBase64(iv.buffer),
    salt: crypto.arrayBufferToBase64(salt.buffer),
    algorithm: crypto.ALGORITHM_NAME,
    encryptionVersion,
    senderKeyId: await createSenderKeyId(localPublicJwk),
  };
}

export async function decryptMessageV2(message: {
  chatId: string;
  senderUserId: string;
  senderDeviceId: string;
  envelope: {
    recipientUserId: string;
    recipientDeviceId: string;
    /**
     * Which device sealed *this* envelope. Normally the message's sender, but
     * a recovery envelope added afterwards by the reader's own device carries
     * that device instead — and the shared secret has to be derived against
     * whichever key actually did the sealing.
     */
    senderDeviceId?: string | null;
    ciphertext: string | null;
    iv: string | null;
    salt: string | null;
    algorithm: string;
    encryptionVersion: number;
  };
}): Promise<string | null> {
  if (!message.envelope.ciphertext || !message.envelope.iv || !message.envelope.salt) return null;

  try {
    // An envelope addressed to the recovery key opens with the recovery key.
    // This is how a browser that lost its device identity reads history back:
    // the device private key it would have used no longer exists anywhere.
    const isRecoveryEnvelope = message.envelope.recipientDeviceId.startsWith("recovery:");
    const privateKey = isRecoveryEnvelope
      ? await getLocalRecoveryPrivateKey(message.envelope.recipientUserId)
      : await getLocalDevicePrivateKey(message.envelope.recipientUserId);
    if (!privateKey) return null;

    const sealingDeviceId = message.envelope.senderDeviceId || message.senderDeviceId;
    const senderDevice = await fetchDeviceKeyBundle(sealingDeviceId);
    if (!senderDevice?.publicKey) return null;

    const peerPublicKey = await crypto.importPublicKey(senderDevice.publicKey);
    const salt = new Uint8Array(crypto.base64ToArrayBuffer(message.envelope.salt));
    const iv = new Uint8Array(crypto.base64ToArrayBuffer(message.envelope.iv));
    const ciphertext = crypto.base64ToArrayBuffer(message.envelope.ciphertext);
    const aad = envelopeContext({
      chatId: message.chatId,
      senderUserId: message.senderUserId,
      senderDeviceId: sealingDeviceId,
      recipientUserId: message.envelope.recipientUserId,
      recipientDeviceId: message.envelope.recipientDeviceId,
      algorithm: message.envelope.algorithm,
      encryptionVersion: message.envelope.encryptionVersion,
    });
    const aesKey = await crypto.deriveAesKey(privateKey, peerPublicKey, salt, crypto.encodeAad(aad));

    return await crypto.decrypt(aesKey, ciphertext, iv, aad);
  } catch (error) {
    console.error("[e2ee] V2 decryption failed", error);
    return null;
  }
}

export async function decryptMessage(
  message: {
    ciphertext: string | null;
    iv: string | null;
    salt: string | null;
    chatId: string;
    senderUserId: string;
    recipientUserId: string;
    algorithm?: string | null;
    encryptionVersion?: number | null;
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
    const aad = {
      algorithm: message.algorithm || crypto.ALGORITHM_NAME,
      chatId: message.chatId,
      encryptionVersion: message.encryptionVersion || 1,
      recipientId: message.recipientUserId,
      senderId: message.senderUserId,
    };

    try {
      return await crypto.decrypt(aesKey, ciphertext, iv, aad);
    } catch {
      return await crypto.decrypt(aesKey, ciphertext, iv);
    }
  } catch (error) {
    console.error("[e2ee] Decryption failed:", error);
    return null;
  }
}

/**
 * Re-seals a message this device can already read to the reader's own recovery
 * key, so it survives the loss of this device.
 *
 * The sealing device is *this* one, not the message's original sender — the
 * sender's private key is not ours to use. The envelope records that, and the
 * decryption path derives the shared secret against whichever device actually
 * sealed it, which is why this works at all.
 */
export async function addRecoveryEnvelope(params: {
  messageId: string;
  chatId: string;
  plaintext: string;
  ownerUserId: string;
  recoveryPublicKey: string;
}): Promise<boolean> {
  const local = await registerCurrentDevice(params.ownerUserId);
  const envelope = await encryptEnvelope({
    plaintext: params.plaintext,
    chatId: params.chatId,
    // The AAD names this device as the sealer on both sides, so it has to be
    // this device here too — anything else fails authentication on open.
    senderUserId: params.ownerUserId,
    senderDeviceId: local.deviceId,
    senderPrivateKey: local.privateKey,
    targetDevice: {
      userId: params.ownerUserId,
      deviceId: recoveryDeviceId(params.ownerUserId),
      publicKey: params.recoveryPublicKey,
      algorithm: crypto.ALGORITHM_NAME,
    },
  });

  const response = await fetch(`/api/messages/${params.messageId}/recovery-envelope`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipientDeviceId: envelope.recipientDeviceId,
      senderDeviceId: envelope.senderDeviceId,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      salt: envelope.salt,
      algorithm: envelope.algorithm,
      encryptionVersion: envelope.encryptionVersion,
    }),
  });
  return response.ok;
}

/**
 * The caller's own recovery public key, fetched once per page.
 *
 * Cached because the backfill asks for it per message, and an account without
 * a recovery key must not pay a request for every line of history to learn
 * that it still does not have one.
 */
let ownRecoveryPublicKey: Promise<string | null> | null = null;

export function getOwnRecoveryPublicKey(): Promise<string | null> {
  if (!ownRecoveryPublicKey) {
    ownRecoveryPublicKey = fetch("/api/e2ee/recovery-key")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => (data?.recoveryKey?.publicKey as string | undefined) ?? null)
      .catch(() => null);
  }
  return ownRecoveryPublicKey;
}
