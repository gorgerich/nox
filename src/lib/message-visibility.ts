/**
 * Whether a message row has anything to show, and in what shape.
 *
 * This exists because of one specific defect: a bare `18:28 ✓✓` floating in the
 * conversation with no bubble under it.
 *
 * The cause is a assumption that used to be made from the mime type alone. A
 * message whose attachments are all images or video is drawn "visual only" —
 * transparent background, no padding, no radius, and the timestamp in a small
 * floating pill positioned *over* the picture. That is right for a photo. But
 * the pill is absolutely positioned, so when the picture fails to paint — a
 * truncated upload, a decode the browser rejects, a blob URL that no longer
 * resolves — the container collapses to nothing and the pill stays exactly
 * where it was. Everything else is transparent, so the timestamp is all that
 * is left on screen.
 *
 * Hiding the timestamp in CSS would have made the symptom go away and left the
 * model saying a message is media when it is not. Instead the attachment
 * reports what it actually drew, and these two functions decide from that.
 */

export type AttachmentRenderMode =
  /** Drew a picture, or a correctly-sized placeholder for one. */
  | "media"
  /** Drew a text box instead — broken, undecryptable, still loading. */
  | "fallback"
  /** Drew nothing at all. */
  | "hidden";

export type VisibilityInput = {
  hasBody: boolean;
  hasReply: boolean;
  isEncrypted: boolean;
  isDeleted: boolean;
  /** Settled means the decrypt attempt is over; before that it is still loading. */
  settledUndecryptable: boolean;
  attachments: { id: string; mimeType: string }[];
  /** What each attachment reported. Absent means "not reported yet". */
  attachmentModes: Record<string, AttachmentRenderMode>;
};

export type MessageVisibility =
  /** Render no row at all — no bubble, no timestamp, no ticks. */
  | "hidden"
  /** A centred service line: deleted, still decrypting, failed attachment. */
  | "service"
  /** An ordinary bubble. */
  | "bubble";

/** True once every attachment has said it drew nothing. */
function allAttachmentsHidden(input: VisibilityInput): boolean {
  if (input.attachments.length === 0) return false;
  return input.attachments.every((attachment) => input.attachmentModes[attachment.id] === "hidden");
}

export function resolveMessageVisibility(input: VisibilityInput): MessageVisibility {
  // Nothing drew, so there is nothing for a timestamp to sit on.
  if (allAttachmentsHidden(input)) return "hidden";

  if (input.isDeleted) return "service";

  if (input.isEncrypted && !input.hasBody && input.attachments.length === 0) {
    // Still waiting is a state worth showing; never becoming readable is not —
    // a permanent "unavailable" line is noise the reader cannot act on.
    return input.settledUndecryptable ? "hidden" : "service";
  }

  // No text, no attachment, not encrypted: nothing is still on its way. This is
  // how a media message whose attachment never attached arrives.
  if (!input.hasBody && input.attachments.length === 0) return "service";

  return "bubble";
}

/**
 * Whether the bubble may drop its background and float the timestamp over the
 * media.
 *
 * Requires both halves: the attachments must *be* media by type, and must have
 * actually drawn media. The second half is the fix — without it a failed image
 * leaves a transparent bubble with a floating timestamp and nothing else.
 *
 * An attachment that has not reported yet counts as media, so a photo does not
 * flash its chrome on and off during the first frames.
 */
export function isVisualOnlyBubble(input: VisibilityInput): boolean {
  if (input.hasBody || input.hasReply) return false;
  if (input.attachments.length === 0) return false;

  const everyItemIsVisualByType = input.attachments.every(
    (attachment) => attachment.mimeType.startsWith("image/") || attachment.mimeType.startsWith("video/"),
  );
  if (!everyItemIsVisualByType) return false;

  return input.attachments.every(
    (attachment) => (input.attachmentModes[attachment.id] ?? "media") === "media",
  );
}
