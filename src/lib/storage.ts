import { randomBytes, randomUUID } from "crypto";
import { createReadStream } from "fs";
import { mkdir, open, stat, writeFile } from "fs/promises";
import path from "path";

export type AllowedAttachmentMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "video/webm"
  | "video/quicktime"
  | "application/pdf"
  | "text/plain"
  | "application/zip"
  | "audio/webm"
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/wav"
  | "audio/ogg"
  | "audio/x-m4a";

export type AttachmentKind = "IMAGE" | "VIDEO" | "FILE" | "VOICE";
export type SafeImageMimeType = "image/jpeg" | "image/png" | "image/webp";

const MB = 1024 * 1024;

export const attachmentRules: Record<
  AllowedAttachmentMimeType,
  { maxSizeBytes: number; kind: AttachmentKind }
> = {
  "image/jpeg": { maxSizeBytes: 20 * MB, kind: "IMAGE" },
  "image/png": { maxSizeBytes: 20 * MB, kind: "IMAGE" },
  "image/webp": { maxSizeBytes: 20 * MB, kind: "IMAGE" },
  "video/mp4": { maxSizeBytes: 150 * MB, kind: "VIDEO" },
  "video/webm": { maxSizeBytes: 150 * MB, kind: "VIDEO" },
  "video/quicktime": { maxSizeBytes: 150 * MB, kind: "VIDEO" },
  "application/pdf": { maxSizeBytes: 50 * MB, kind: "FILE" },
  "text/plain": { maxSizeBytes: 5 * MB, kind: "FILE" },
  "application/zip": { maxSizeBytes: 50 * MB, kind: "FILE" },
  "audio/webm": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/mpeg": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/mp4": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/wav": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/ogg": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/x-m4a": { maxSizeBytes: 25 * MB, kind: "VOICE" },
};

export function normalizeAttachmentMimeType(mimeType: string) {
  const baseMime = mimeType.split(";")[0].toLowerCase().trim();

  if (baseMime === "audio/x-m4a") {
    return "audio/mp4";
  }

  return baseMime;
}

export function getAttachmentRule(mimeType: string) {
  const normalizedMimeType = normalizeAttachmentMimeType(mimeType);
  return attachmentRules[normalizedMimeType as AllowedAttachmentMimeType] ?? null;
}

export function detectImageMimeType(buffer: Uint8Array): SafeImageMimeType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length >= 8 && pngSignature.every((byte, index) => buffer[index] === byte)) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    String.fromCharCode(...buffer.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...buffer.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export async function getStoredImageMimeType(objectPath: string) {
  const handle = await open(objectPath, "r");
  try {
    const signature = Buffer.alloc(12);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    return detectImageMimeType(signature.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function getUploadRoot() {
  const configuredDir = process.env.UPLOAD_DIR?.trim() || "./private_uploads";
  const resolvedDir = path.isAbsolute(configuredDir)
    ? path.normalize(configuredDir)
    : path.normalize(path.join(/*turbopackIgnore: true*/ process.cwd(), configuredDir));
  const publicDir = path.normalize(path.join(process.cwd(), "public"));

  if (resolvedDir === publicDir || resolvedDir.startsWith(`${publicDir}${path.sep}`)) {
    throw new Error("UPLOAD_DIR must not be inside public.");
  }

  return resolvedDir;
}

export function createStorageKey() {
  return `${randomUUID()}-${randomBytes(12).toString("hex")}`;
}

export async function saveObject(data: Buffer) {
  const uploadRoot = getUploadRoot();
  await mkdir(uploadRoot, { recursive: true });

  const storageKey = createStorageKey();
  const objectPath = path.join(uploadRoot, storageKey);
  await writeFile(objectPath, data, { flag: "wx" });

  return { storageKey };
}

export async function getObject(storageKey: string) {
  if (!/^[a-f0-9-]{36}-[a-f0-9]{24}$/.test(storageKey)) {
    return null;
  }

  const uploadRoot = getUploadRoot();
  const objectPath = path.normalize(path.join(uploadRoot, storageKey));

  if (!objectPath.startsWith(`${uploadRoot}${path.sep}`)) {
    return null;
  }

  const metadata = await stat(objectPath).catch(() => null);

  if (!metadata?.isFile()) {
    return null;
  }

  return {
    path: objectPath,
    sizeBytes: metadata.size,
    stream: createReadStream(objectPath),
  };
}
