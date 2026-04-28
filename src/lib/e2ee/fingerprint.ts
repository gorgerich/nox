import { createHash } from "crypto";

export function createPublicKeyFingerprint(publicKey: string) {
  return createHash("sha256").update(publicKey).digest("hex").toUpperCase();
}

export function formatFingerprint(fingerprint: string) {
  return fingerprint.match(/.{1,4}/g)?.slice(0, 10).join(" ") ?? fingerprint;
}
