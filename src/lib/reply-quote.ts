/**
 * The label a reply shows for the message it is quoting.
 *
 * A quote has to survive the case where this device cannot read the original.
 * The server sends `body: null` for every encrypted message — it does not have
 * the plaintext and must not — so the quote's text is whatever the client can
 * supply locally, and sometimes that is nothing at all.
 *
 * What it used to say in that case was "Вложение", for every kind of message.
 * That is wrong in both directions: it invents an attachment on a reply to
 * plain text, and it throws away the one thing that *is* known about a reply to
 * a photo. The message type travels in the same projection as the quote, so the
 * label can at least name the kind of thing being pointed at.
 */
export function quotedFallback(type: string): string {
  switch (type) {
    case "IMAGE":
      return "Фото";
    case "VIDEO":
    case "VIDEO_NOTE":
      return "Видео";
    case "VOICE":
      return "Голосовое сообщение";
    case "FILE":
      return "Файл";
    default:
      // Including TEXT: a text message this device cannot decrypt gets a
      // neutral word rather than a decrypt warning. Tapping the quote still
      // scrolls to the original, which is the useful part.
      return "Сообщение";
  }
}

/**
 * Full quote text: the plaintext when it is available here, the type label
 * when it is not, and a plain statement when the original is gone.
 */
export function quoteLabel(input: {
  body: string | null;
  type: string;
  deletedAt: string | null;
}): string {
  if (input.deletedAt) return "Исходное сообщение удалено";
  const body = input.body?.trim();
  if (body) return body;
  return quotedFallback(input.type);
}
