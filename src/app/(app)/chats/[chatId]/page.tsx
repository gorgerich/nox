import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { isUserOnline } from "@/lib/realtime";
import { ChatMessages } from "./ChatMessages";

type BaseMessage = {
  id: string;
  body: string | null;
  ciphertext: string | null;
  iv: string | null;
  salt: string | null;
  algorithm: string | null;
  encryptionVersion: number | null;
  isEncrypted: boolean;
  senderKeyId: string | null;
  type: "TEXT" | "IMAGE" | "VIDEO" | "VIDEO_NOTE" | "FILE" | "VOICE" | "SYSTEM";
  senderUserId: string;
  replyToMessageId: string | null;
  deletedAt: Date | null;
  editedAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  sender: {
    id: string;
    username: string;
    profile: {
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
  attachments: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    encryptedSizeBytes?: number | null;
    isEncrypted?: boolean;
    mediaEncryptionVersion?: number | null;
    fileIv?: string | null;
    fileAlgorithm?: string | null;
    mediaKeyEnvelopes?: {
      id: string;
      recipientUserId: string;
      recipientDeviceId: string;
      senderDeviceId: string;
      encryptedMediaKey: string;
      iv: string;
      salt: string | null;
      algorithm: string;
      encryptionVersion: number;
      createdAt: Date;
      deliveredAt: Date | null;
      revokedAt: Date | null;
    }[];
  }[];
  reactions: {
    emoji: string;
    userId: string;
    user: {
      id: string;
      username: string;
      profile: { displayName: string } | null;
    };
  }[];
  replyToMessage?: {
    id: string;
    body: string | null;
    deletedAt: Date | null;
    createdAt: Date;
    type: string;
    sender: {
      username: string;
      profile: { displayName: string } | null;
    };
  } | null;
  receipts: {
    userId: string;
    deliveredAt: Date | null;
    readAt: Date | null;
  }[];
  envelopes: {
    id: string;
    recipientUserId: string;
    recipientDeviceId: string;
    senderDeviceId: string;
    ciphertext: string | null;
    iv: string | null;
    salt: string | null;
    algorithm: string;
    encryptionVersion: number;
    createdAt: Date;
    deliveredAt: Date | null;
    readAt: Date | null;
    encryptedPayloadDeletedAt: Date | null;
  }[];
};

/**
 * Everything a message needs to render, including the envelopes addressed to
 * one reader. Lifted out of the chat query so the conversation's opening batch
 * can be fetched with exactly the same shape — two copies of this would drift,
 * and a missing envelope field reads as an undecryptable message.
 */
function messageIncludeFor(userId: string) {
  return {
            sender: {
              select: {
                id: true,
                username: true,
                lastSeenAt: true,
                profile: {
                  select: {
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            attachments: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                sizeBytes: true,
                encryptedSizeBytes: true,
                width: true,
                height: true,
                isEncrypted: true,
                mediaEncryptionVersion: true,
                fileIv: true,
                fileAlgorithm: true,
                mediaKeyEnvelopes: {
                  where: { recipientUserId: userId },
                  select: {
                    id: true,
                    recipientUserId: true,
                    recipientDeviceId: true,
                    senderDeviceId: true,
                    encryptedMediaKey: true,
                    iv: true,
                    salt: true,
                    algorithm: true,
                    encryptionVersion: true,
                    createdAt: true,
                    deliveredAt: true,
                    revokedAt: true,
                  },
                },
              },
            },
            replyToMessage: {
              include: {
                sender: {
                  select: {
                    username: true,
                    profile: { select: { displayName: true } },
                  },
                },
              },
            },
            reactions: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    profile: { select: { displayName: true } },
                  },
                },
              },
            },
            receipts: {
              select: {
                userId: true,
                deliveredAt: true,
                readAt: true,
              },
            },
            envelopes: {
              where: { recipientUserId: userId },
              select: {
                id: true,
                recipientUserId: true,
                recipientDeviceId: true,
                senderDeviceId: true,
                ciphertext: true,
                iv: true,
                salt: true,
                algorithm: true,
                encryptionVersion: true,
                createdAt: true,
                deliveredAt: true,
                readAt: true,
                encryptedPayloadDeletedAt: true,
              },
            },
          } as const;
}

function serializeMessage(message: BaseMessage) {
  return {
    ...message,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    editedAt: message.editedAt?.toISOString() ?? null,
    deliveredAt: message.deliveredAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
    replyToMessage: message.replyToMessage
      ? {
          ...message.replyToMessage,
          deletedAt: message.replyToMessage.deletedAt?.toISOString() ?? null,
          createdAt: message.replyToMessage.createdAt.toISOString(),
        }
      : null,
    receipts: message.receipts.map(r => ({
      ...r,
      deliveredAt: r.deliveredAt?.toISOString() ?? null,
      readAt: r.readAt?.toISOString() ?? null,
    })),
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
      mediaKeyEnvelopes: attachment.mediaKeyEnvelopes?.map((envelope) => ({
        ...envelope,
        createdAt: envelope.createdAt.toISOString(),
        deliveredAt: envelope.deliveredAt?.toISOString() ?? null,
        revokedAt: envelope.revokedAt?.toISOString() ?? null,
      })) ?? [],
    })),
    envelopes: message.envelopes.map((envelope) => ({
      ...envelope,
      createdAt: envelope.createdAt.toISOString(),
      deliveredAt: envelope.deliveredAt?.toISOString() ?? null,
      readAt: envelope.readAt?.toISOString() ?? null,
      encryptedPayloadDeletedAt: envelope.encryptedPayloadDeletedAt?.toISOString() ?? null,
    })),
  };
}

function filterMessageEnvelopesForUser<T extends { envelopes: BaseMessage["envelopes"]; attachments: BaseMessage["attachments"] }>(message: T, userId: string): T {
  return {
    ...message,
    envelopes: message.envelopes.filter((envelope) => envelope.recipientUserId === userId),
    attachments: message.attachments.map((attachment) => ({
      ...attachment,
      mediaKeyEnvelopes: attachment.mediaKeyEnvelopes?.filter((envelope) => envelope.recipientUserId === userId) ?? [],
    })),
  };
}


export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ chatId: string }>;
  searchParams: Promise<{ highlightMessageId?: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { chatId } = await params;
  await searchParams; // highlightMessageId is read client-side from the URL

  const prisma = getPrisma();

  // Messages are loaded client-side (cache-first, then network) — see the
  // ChatMessages history loader. Keeping them off the server render makes the
  // chat route open without a blocking wait.
  const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: {
        pinnedMessage: {
          include: {
            sender: {
              select: {
                id: true,
                username: true,
                lastSeenAt: true,
                profile: {
                  select: {
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
            attachments: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                sizeBytes: true,
                encryptedSizeBytes: true,
                width: true,
                height: true,
                isEncrypted: true,
                mediaEncryptionVersion: true,
                fileIv: true,
                fileAlgorithm: true,
                mediaKeyEnvelopes: {
                  where: { recipientUserId: user.id },
                  select: {
                    id: true,
                    recipientUserId: true,
                    recipientDeviceId: true,
                    senderDeviceId: true,
                    encryptedMediaKey: true,
                    iv: true,
                    salt: true,
                    algorithm: true,
                    encryptionVersion: true,
                    createdAt: true,
                    deliveredAt: true,
                    revokedAt: true,
                  },
                },
              },
            },
            replyToMessage: {
              include: {
                sender: {
                  select: {
                    username: true,
                    profile: { select: { displayName: true } },
                  },
                },
              },
            },
            reactions: {
              include: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    profile: { select: { displayName: true } },
                  },
                },
              },
            },
            receipts: {
              select: {
                userId: true,
                deliveredAt: true,
                readAt: true,
              },
            },
            envelopes: {
              where: { recipientUserId: user.id },
              select: {
                id: true,
                recipientUserId: true,
                recipientDeviceId: true,
                senderDeviceId: true,
                ciphertext: true,
                iv: true,
                salt: true,
                algorithm: true,
                encryptionVersion: true,
                createdAt: true,
                deliveredAt: true,
                readAt: true,
                encryptedPayloadDeletedAt: true,
              },
            },
          },
        },
        members: {
          where: { status: "ACTIVE" },
          include: {
            user: {
              select: {
                id: true,
                username: true,
                lastSeenAt: true,
                profile: {
                  select: {
                    displayName: true,
                    avatarUrl: true,
                  },
                },
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
      },
  });

  if (!chat) {
    redirect("/chats");
  }

  // Derive membership from the chat's already-fetched members instead of a
  // separate query — one less serial DB round-trip before the page renders.
  const myMembership = chat.members.find((member) => member.user.id === user.id);
  if (!myMembership) {
    redirect("/chats");
  }

  const otherMember = chat.members.find((member) => member.user.id !== user.id);
  const otherMemberIsOnline = otherMember ? isUserOnline(otherMember.user.id) : false;
  const pinnedMessage = chat.pinnedMessage && (
    !myMembership.clearedAt || chat.pinnedMessage.createdAt > myMembership.clearedAt
  )
    ? serializeMessage(filterMessageEnvelopesForUser(chat.pinnedMessage as BaseMessage, user.id))
    : null;
  /**
   * The opening batch, shipped with the HTML.
   *
   * Only the pinned message used to be seeded, and everything else waited for
   * the client to hydrate and fetch. Traced on a 200-message conversation: the
   * document was ready at 1.2s, the request left at 2.3s, and the first
   * message painted at 4.1s — nearly three seconds of an empty room in an app
   * whose whole job is showing that room. Nothing here decrypts anything; it
   * is the same rows, with the same reader's envelopes, that the client would
   * have asked for a second later.
   *
   * Deliberately a screenful and a bit rather than the client's full page: the
   * point is to have something to read immediately, and every extra message is
   * ciphertext in the HTML. The client still reconciles against the network
   * and takes over as the authority.
   */
  const openingBatch = await prisma.message.findMany({
    where: {
      chatId: chat.id,
      deletedAt: null,
      ...(myMembership.clearedAt ? { createdAt: { gt: myMembership.clearedAt } } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 24,
    include: messageIncludeFor(user.id),
  });

  const seededMessages = openingBatch
    .reverse()
    .map((message) => serializeMessage(filterMessageEnvelopesForUser(message as BaseMessage, user.id)));

  // The pinned message may sit outside the opening batch, so it is kept and
  // de-duplicated rather than assumed present.
  const messagesWithPinned = pinnedMessage && !seededMessages.some((m) => m.id === pinnedMessage.id)
    ? [pinnedMessage, ...seededMessages]
    : seededMessages;
  // Forward-target list is loaded lazily on the client when the user opens the
  // forward picker (see ChatMessages.loadForwardChats), so we no longer run the
  // heavy "all chats" query here — that was slowing down every chat open.
  return (
    <div className="chat-screen bg-background transition-smooth overflow-hidden">
      <ChatMessages
        key={chat.id}
        chatId={chat.id}
        currentRole={myMembership.role}
        currentUserId={user.id}
        initialMessages={messagesWithPinned}
        initialPinnedMessage={pinnedMessage}
        initialForwardChats={[]}
        isLocked={chat.isLocked}
        initialDisappearingSeconds={chat.disappearingSeconds ?? null}
        chatInfo={{
          type: chat.type,
          title: chat.title,
          avatarUrl: chat.avatarUrl,
          memberCount: chat.members.length,
          otherMember: otherMember ? {
            id: otherMember.user.id,
            displayName: otherMember.user.profile?.displayName ?? otherMember.user.username,
            avatarUrl: otherMember.user.profile?.avatarUrl ?? null,
            username: otherMember.user.username,
            lastSeenAt: otherMember.user.lastSeenAt?.toISOString() ?? null,
            isOnline: otherMemberIsOnline,
          } : undefined
        }}
      />
    </div>
  );
}
