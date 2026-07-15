import { z } from "zod";

const base64UrlCoordinate = z.string().min(40).max(60).regex(/^[A-Za-z0-9_-]+$/);

const ecdhPublicJwkSchema = z.object({
  kty: z.literal("EC"),
  crv: z.literal("P-256"),
  x: base64UrlCoordinate,
  y: base64UrlCoordinate,
  d: z.never().optional(),
}).passthrough();

export function isValidEcdhPublicKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;

  try {
    return ecdhPublicJwkSchema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}
