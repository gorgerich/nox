import { randomBytes, randomUUID } from "crypto";
import { createReadStream } from "fs";
import { mkdir, stat, writeFile } from "fs/promises";
import path from "path";

export type AllowedAttachmentMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "video/mp4"
  | "application/pdf"
  | "text/plain"
  | "application/zip"
  | "audio/webm"
  | "audio/mpeg"
  | "audio/mp4"
  | "audio/wav"
  | "audio/ogg";

export type AttachmentKind = "IMAGE" | "VIDEO" | "FILE" | "VOICE";

const MB = 1024 * 1024;

export const attachmentRules: Record<
  AllowedAttachmentMimeType,
  { maxSizeBytes: number; kind: AttachmentKind }
> = {
  "image/jpeg": { maxSizeBytes: 20 * MB, kind: "IMAGE" },
  "image/png": { maxSizeBytes: 20 * MB, kind: "IMAGE" },
  "image/webp": { maxSizeBytes: 20 * MB, kind: "IMAGE" },
  "video/mp4": { maxSizeBytes: 150 * MB, kind: "VIDEO" },
  "application/pdf": { maxSizeBytes: 50 * MB, kind: "FILE" },
  "text/plain": { maxSizeBytes: 5 * MB, kind: "FILE" },
  "application/zip": { maxSizeBytes: 50 * MB, kind: "FILE" },
  "audio/webm": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/mpeg": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/mp4": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/wav": { maxSizeBytes: 25 * MB, kind: "VOICE" },
  "audio/ogg": { maxSizeBytes: 25 * MB, kind: "VOICE" },
};

export function getAttachmentRule(mimeType: string) {
  return attachmentRules[mimeType as AllowedAttachmentMimeType] ?? null;
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
