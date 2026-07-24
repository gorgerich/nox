// Classifies *why* history can't be read on this install.
//
// After a reinstall the device key that old envelopes were sealed to is gone
// for good, so those messages can never be decrypted here. Previously the chat
// just rendered a wall of "Сообщение недоступно" lines with no explanation.
// This distinguishes that permanent case from a genuinely empty new chat and
// from transient conditions, using only data the client already has.

export type HistoryAvailability =
  | "ok"
  | "empty-chat"
  | "missing-device-key"
  | "partially-unavailable";

export type AvailabilityInput = {
  /** A message as returned by the server, reduced to what the check needs. */
  id: string;
  /** Envelope recipients present on the server for this message. */
  envelopeDeviceIds: string[];
  /** True when this client could not produce a plaintext for the message. */
  unavailable: boolean;
};

export type ClassifyParams = {
  messages: AvailabilityInput[];
  /** The device id this install registered, or null before registration. */
  localDeviceId: string | null;
};

/**
 * A message is unreadable *because of a lost device key* when the server did
 * return envelopes for it, none of them addressed to this device, and this
 * client failed to read it. That combination cannot be produced by a sync
 * hiccup: the payloads are present, they simply belong to another install.
 */
export function isSealedForAnotherDevice(
  message: AvailabilityInput,
  localDeviceId: string | null,
): boolean {
  if (!localDeviceId) return false;
  if (!message.unavailable) return false;
  if (message.envelopeDeviceIds.length === 0) return false;
  return !message.envelopeDeviceIds.includes(localDeviceId);
}

export function classifyHistory({ messages, localDeviceId }: ClassifyParams): HistoryAvailability {
  if (messages.length === 0) return "empty-chat";

  const sealedElsewhere = messages.filter((m) => isSealedForAnotherDevice(m, localDeviceId));
  if (sealedElsewhere.length === 0) return "ok";

  // Every message we hold is sealed to a key we don't have: this install can
  // show nothing of the past conversation.
  if (sealedElsewhere.length === messages.length) return "missing-device-key";

  return "partially-unavailable";
}

/** Messages that will never become readable on this install. */
export function countPermanentlyUnavailable(
  messages: AvailabilityInput[],
  localDeviceId: string | null,
): number {
  return messages.filter((m) => isSealedForAnotherDevice(m, localDeviceId)).length;
}
