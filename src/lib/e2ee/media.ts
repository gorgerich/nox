import * as crypto from "./crypto";
import {
  DeviceKeyBundle,
  fetchCurrentUserDeviceBundles,
  fetchDeviceKeyBundle,
  fetchUserDeviceBundles,
  getLocalDevicePrivateKey,
  registerCurrentDevice,
} from "./keys";

export type MediaKeyEnvelopePayload = {
  recipientUserId: string;
  recipientDeviceId: string;
  senderDeviceId: string;
  encryptedMediaKey: string;
  iv: string;
  salt: string;
  algorithm: string;
  encryptionVersion: 1;
};

export type EncryptedMediaUploadPayload = {
  encryptedBlob: Blob;
  fileIv: string;
  fileAlgorithm: string;
  mediaEncryptionVersion: 1;
  senderDeviceId: string;
  mediaKeyEnvelopes: MediaKeyEnvelopePayload[];
};

const MEDIA_FILE_ALGORITHM = "AES-GCM-256";
const MEDIA_KEY_ALGORITHM = "ECDH-P256-HKDF-SHA256-AES-GCM-MEDIA-KEY";

function uniqueDevices(devices: DeviceKeyBundle[]) {
  const byDevice = new Map<string, DeviceKeyBundle>();
  for (const device of devices) {
    if (!device.deviceId || !device.publicKey) continue;
    byDevice.set(device.deviceId, device);
  }
  return Array.from(byDevice.values());
}

function mediaKeyContext(params: {
  chatId: string;
  senderUserId: string;
  senderDeviceId: string;
  recipientUserId: string;
  recipientDeviceId: string;
}) {
  return {
    algorithm: MEDIA_KEY_ALGORITHM,
    chatId: params.chatId,
    encryptionVersion: 1,
    purpose: "nox-media-key",
    recipientDeviceId: params.recipientDeviceId,
    recipientUserId: params.recipientUserId,
    senderDeviceId: params.senderDeviceId,
    senderUserId: params.senderUserId,
  };
}

async function importMediaAesKey(rawKey: ArrayBuffer | Uint8Array) {
  const bytes = rawKey instanceof Uint8Array ? rawKey : new Uint8Array(rawKey);
  const keyBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(keyBuffer).set(bytes);
  return window.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function copyToArrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const buffer = new ArrayBuffer(view.byteLength);
  new Uint8Array(buffer).set(view);
  return buffer;
}

async function encryptMediaKeyForDevice(params: {
  mediaKeyBytes: Uint8Array;
  chatId: string;
  senderUserId: string;
  senderDeviceId: string;
  senderPrivateKey: CryptoKey;
  targetDevice: DeviceKeyBundle;
}): Promise<MediaKeyEnvelopePayload> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const peerPublicKey = await crypto.importPublicKey(params.targetDevice.publicKey);
  const context = mediaKeyContext({
    chatId: params.chatId,
    senderUserId: params.senderUserId,
    senderDeviceId: params.senderDeviceId,
    recipientUserId: params.targetDevice.userId,
    recipientDeviceId: params.targetDevice.deviceId,
  });
  const wrappingKey = await crypto.deriveAesKey(params.senderPrivateKey, peerPublicKey, salt, crypto.encodeAad(context));
  const encryptedMediaKey = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: copyToArrayBuffer(iv), additionalData: copyToArrayBuffer(crypto.encodeAad(context)) },
    wrappingKey,
    copyToArrayBuffer(params.mediaKeyBytes),
  );

  return {
    recipientUserId: params.targetDevice.userId,
    recipientDeviceId: params.targetDevice.deviceId,
    senderDeviceId: params.senderDeviceId,
    encryptedMediaKey: crypto.arrayBufferToBase64(encryptedMediaKey),
    iv: crypto.arrayBufferToBase64(iv.buffer),
    salt: crypto.arrayBufferToBase64(salt.buffer),
    algorithm: MEDIA_KEY_ALGORITHM,
    encryptionVersion: 1,
  };
}

export async function encryptMediaForDevices(params: {
  file: File;
  recipientUserId: string;
  chatId: string;
  senderUserId: string;
}): Promise<EncryptedMediaUploadPayload> {
  const local = await registerCurrentDevice(params.senderUserId);
  const [recipientDevices, senderDevices] = await Promise.all([
    fetchUserDeviceBundles(params.recipientUserId, params.chatId),
    fetchCurrentUserDeviceBundles(),
  ]);

  if (recipientDevices.length === 0) {
    throw new Error("У собеседника ещё нет ключа шифрования. Попросите его открыть приложение.");
  }

  const targetDevices = uniqueDevices([...recipientDevices, ...senderDevices]);
  if (!targetDevices.some((device) => device.deviceId === local.deviceId)) {
    targetDevices.push({
      userId: params.senderUserId,
      deviceId: local.deviceId,
      publicKey: local.publicKey,
      algorithm: crypto.ALGORITHM_NAME,
    });
  }

  const mediaKeyBytes = window.crypto.getRandomValues(new Uint8Array(32));
  const mediaAesKey = await importMediaAesKey(mediaKeyBytes);
  const fileIv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedFile = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: copyToArrayBuffer(fileIv) },
    mediaAesKey,
    await params.file.arrayBuffer(),
  );

  const mediaKeyEnvelopes = await Promise.all(
    targetDevices.map((targetDevice) => encryptMediaKeyForDevice({
      mediaKeyBytes,
      chatId: params.chatId,
      senderUserId: params.senderUserId,
      senderDeviceId: local.deviceId,
      senderPrivateKey: local.privateKey,
      targetDevice,
    })),
  );

  return {
    encryptedBlob: new Blob([encryptedFile], { type: "application/octet-stream" }),
    fileIv: crypto.arrayBufferToBase64(fileIv.buffer),
    fileAlgorithm: MEDIA_FILE_ALGORITHM,
    mediaEncryptionVersion: 1,
    senderDeviceId: local.deviceId,
    mediaKeyEnvelopes,
  };
}

export async function decryptMediaBlob(params: {
  encryptedBlob: Blob;
  fileIv: string;
  senderUserId: string;
  senderDeviceId: string;
  chatId: string;
  envelope: {
    recipientUserId: string;
    recipientDeviceId: string;
    encryptedMediaKey: string;
    iv: string;
    salt: string | null;
    algorithm: string;
    encryptionVersion: number;
  };
  mimeType: string;
}): Promise<Blob | null> {
  try {
    if (!params.envelope.salt) return null;
    const privateKey = await getLocalDevicePrivateKey(params.envelope.recipientUserId);
    if (!privateKey) return null;
    const senderDevice = await fetchDeviceKeyBundle(params.senderDeviceId);
    if (!senderDevice?.publicKey) return null;

    const peerPublicKey = await crypto.importPublicKey(senderDevice.publicKey);
    const salt = new Uint8Array(crypto.base64ToArrayBuffer(params.envelope.salt));
    const keyIv = new Uint8Array(crypto.base64ToArrayBuffer(params.envelope.iv));
    const context = mediaKeyContext({
      chatId: params.chatId,
      senderUserId: params.senderUserId,
      senderDeviceId: params.senderDeviceId,
      recipientUserId: params.envelope.recipientUserId,
      recipientDeviceId: params.envelope.recipientDeviceId,
    });
    const wrappingKey = await crypto.deriveAesKey(privateKey, peerPublicKey, salt, crypto.encodeAad(context));
    const mediaKeyBytes = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: copyToArrayBuffer(keyIv), additionalData: copyToArrayBuffer(crypto.encodeAad(context)) },
      wrappingKey,
      crypto.base64ToArrayBuffer(params.envelope.encryptedMediaKey),
    );

    const mediaAesKey = await importMediaAesKey(mediaKeyBytes);
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: copyToArrayBuffer(new Uint8Array(crypto.base64ToArrayBuffer(params.fileIv))) },
      mediaAesKey,
      await params.encryptedBlob.arrayBuffer(),
    );
    return new Blob([decrypted], { type: params.mimeType });
  } catch (error) {
    console.error("[e2ee] Media decrypt failed", error);
    return null;
  }
}
