import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { isUserOnline } from "@/lib/realtime";
import { ChatMessages } from "./ChatMessages";
import { Prisma } from "@prisma/client";

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
  const { highlightMessageId } = await searchParams;
  const membership = await requireActiveChatMembership(chatId, user.id);

  if (!membership) {
    redirect("/chats");
  }

  const prisma = getPrisma();

  // If we have a highlightMessageId, we need to make sure it's loaded.
  // We can either fetch messages around it, or just ensure it's included in the set.
  // For simplicity, if highlightMessageId is present, we'll fetch messages up to that message + some older ones.
  let messageWhereClause: Prisma.MessageWhereInput = { chatId };
  let take = 50;

  if (highlightMessageId) {
    const targetMessage = await prisma.message.findUnique({
      where: { id: highlightMessageId },
      select: { createdAt: true }
    });

    if (targetMessage) {
      // Load 30 messages newer than target and 20 older than target?
      // Actually Prisma doesn't easily support "around".
      // Let's just load 70 messages starting from the target message's time, 
      // but simpler is to load all messages newer than (target - small offset).
      messageWhereClause = {
        chatId,
        createdAt: {
          gte: new Date(targetMessage.createdAt.getTime() - 1000 * 60 * 60) // 1 hour before
        }
      };
      take = 100; // Load more to be safe
    }
  }

  // Hide disappearing messages whose timer has elapsed.
  messageWhereClause = {
    ...messageWhereClause,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };

  const [chat, rawMessages] = await Promise.all([
    prisma.chat.findUnique({
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
    }),
    prisma.message.findMany({
      where: messageWhereClause,
      orderBy: { createdAt: "desc" },
      take,
      include: {
        sender: {
          select: {
            id: true,
            username: true,
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
          // Only this user's envelopes are usable on their devices. Filtering in
          // SQL (instead of fetching every recipient's envelope and dropping them
          // in JS) shrinks the payload a lot for groups / multi-device, so the
          // chat page renders faster.
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
    }),
  ]);

  if (!chat) {
    redirect("/chats");
  }

  const otherMember = chat.members.find((member) => member.user.id !== user.id);
  const otherMemberIsOnline = otherMember ? isUserOnline(otherMember.user.id) : false;
  const pinnedMessage = chat.pinnedMessage
    ? serializeMessage(filterMessageEnvelopesForUser(chat.pinnedMessage as BaseMessage, user.id))
    : null;
  const serializedMessages = rawMessages
    .reverse()
    .map((m: BaseMessage) => serializeMessage(filterMessageEnvelopesForUser(m, user.id)));
  const messagesWithPinned = pinnedMessage && !serializedMessages.some((message) => message.id === pinnedMessage.id)
    ? [...serializedMessages, pinnedMessage].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    : serializedMessages;
  // Forward-target list is loaded lazily on the client when the user opens the
  // forward picker (see ChatMessages.loadForwardChats), so we no longer run the
  // heavy "all chats" query here — that was slowing down every chat open.
  return (
    <div className="chat-screen bg-background transition-smooth overflow-hidden">
      <ChatMessages
        chatId={chat.id}
        currentRole={membership.role}
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
