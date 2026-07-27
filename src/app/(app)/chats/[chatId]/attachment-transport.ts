"use client";

/**
 * Uploading one staged attachment.
 *
 * This is the attachment half of the delivery controller's transport. It is a
 * plain function rather than a second delivery system on purpose: the queue,
 * the retry budget, the timeout, the reconciliation and the idempotency key are
 * all the controller's, exactly as they are for text. The only thing that is
 * different is what goes on the wire.
 *
 * It reads the bytes from the outbox rather than from a `File` held in memory,
 * which is what makes a retry after a reload possible at all.
 */
import { encryptMediaForDevices } from "@/lib/e2ee/media";
import type { TransportResult } from "@/lib/messages/delivery-controller";
import type { OutboxBlobStore, PendingAttachmentMeta } from "@/lib/messages/pending-repository";
import type { Message } from "./MessageBubble";

export type AttachmentUploadInput = {
  clientMessageId: string;
  attachment: PendingAttachmentMeta;
  caption: string;
  blobs: OutboxBlobStore;
  chatId: string;
  currentUserId: string;
  chatType: string;
  otherMemberId: string | null;
  /** Hands the canonical message back so the conversation can fold it in. */
  onNormalized: (message: Message) => void;
};

/** Message types the server derives; kept here so an offline bubble looks right. */
export function attachmentKindOf(file: { name: string; type: string }): PendingAttachmentMeta["kind"] {
  const isVideoNote = file.name.startsWith("video-message-") && file.type.startsWith("video/");
  if (file.type.startsWith("image/")) return "IMAGE";
  if (isVideoNote) return "VIDEO_NOTE";
  if (file.type.startsWith("video/")) return "VIDEO";
  if (file.type.startsWith("audio/")) return "VOICE";
  return "FILE";
}

export function attachmentMetaOf(file: File): PendingAttachmentMeta {
  return {
    fileName: file.name,
    mimeType: file.type,
    sizeBytes: file.size,
    kind: attachmentKindOf(file),
    staged: false,
  };
}

export async function sendStagedAttachment(input: AttachmentUploadInput): Promise<TransportResult> {
  const blob = await input.blobs.get(input.clientMessageId).catch(() => null);
  if (!blob) {
    // The bytes are gone, so no retry can ever succeed. Saying so is better
    // than a bubble that retries forever against nothing.
    return { ok: false, errorCode: "ATTACHMENT_BYTES_MISSING", retryable: false };
  }

  const file = new File([blob], input.attachment.fileName || "file", {
    type: input.attachment.mimeType || "application/octet-stream",
  });
  const shouldEncrypt = input.chatType === "DIRECT";
  const recipientUserId = input.otherMemberId ?? input.currentUserId;

  const formData = new FormData();
  formData.append("clientId", input.clientMessageId);
  if (input.attachment.kind === "VIDEO_NOTE") formData.append("videoNote", "true");

  try {
    if (shouldEncrypt) {
      const encrypted = await encryptMediaForDevices({
        file,
        recipientUserId,
        chatId: input.chatId,
        senderUserId: input.currentUserId,
      });
      const encryptedFile = new File([encrypted.encryptedBlob], "encrypted-media.bin", {
        type: "application/octet-stream",
      });
      formData.append("file", encryptedFile);
      formData.append("encrypted", "true");
      formData.append("mediaEncryptionVersion", String(encrypted.mediaEncryptionVersion));
      formData.append("fileIv", encrypted.fileIv);
      formData.append("fileAlgorithm", encrypted.fileAlgorithm);
      formData.append("senderDeviceId", encrypted.senderDeviceId);
      formData.append("mediaKeyEnvelopes", JSON.stringify(encrypted.mediaKeyEnvelopes));
      formData.append("clientMimeType", input.attachment.mimeType);
      formData.append("originalSizeBytes", String(input.attachment.sizeBytes));
    } else {
      formData.append("file", file);
      // The server rejects a caption on encrypted media, so it only travels
      // with a plaintext upload; the encrypted case sends it as its own message.
      if (input.caption.trim()) formData.append("body", input.caption.trim());
    }
  } catch (error) {
    console.error("[e2ee] Media encryption failed before upload", error);
    return { ok: false, errorCode: "MEDIA_ENCRYPT_FAILED", retryable: false };
  }

  let response: Response;
  try {
    response = await fetch(`/api/chats/${input.chatId}/attachments`, { method: "POST", body: formData });
  } catch {
    return { ok: false, errorCode: "NETWORK", retryable: true };
  }

  if (!response.ok) {
    const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    return { ok: false, errorCode: `HTTP_${response.status}`, retryable };
  }

  const data = await response.json().catch(() => null);
  const message = data?.message as Message | undefined;
  if (!message?.id) return { ok: false, errorCode: "BAD_RESPONSE", retryable: false };

  input.onNormalized(message);
  return {
    ok: true,
    message: { id: message.id, clientId: input.clientMessageId, body: message.body ?? null, createdAt: message.createdAt },
  };
}
