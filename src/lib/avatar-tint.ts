/**
 * A stable colour for a fallback avatar.
 *
 * Every letter-avatar used to be the same pale blue, which made a list of
 * chats read as one repeating shape: the eye had nothing to lock onto and had
 * to fall back to reading names one by one. Giving each conversation its own
 * hue turns the avatar column into a scannable index — you learn where a chat
 * lives by its colour long before you read its title.
 *
 * The hue must be derived, never assigned: the same conversation has to keep
 * its colour across devices, sessions and re-renders, with nothing stored and
 * no round trip. A hash of the name gives exactly that.
 */

/** Six hues, far enough apart to tell apart at 46px, none of them the accent. */
export const AVATAR_TINT_COUNT = 6;

export function avatarTint(seed: string | null | undefined): number {
  const text = (seed ?? "").trim();
  if (!text) return 0;

  // djb2. Small, stable, and good enough to spread names across six buckets;
  // this picks a colour, it does not protect anything.
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % AVATAR_TINT_COUNT;
}
