import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getChatsPageData } from "@/lib/chat-list";
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
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
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
  };
}

type ForwardChatOption = {
  id: string;
  title: string;
  avatarUrl: string | null;
};

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

  const [chat, rawMessages, chatsPageData] = await Promise.all([
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
      },
    }),
    getChatsPageData(user.id),
  ]);

  if (!chat) {
    redirect("/chats");
  }

  const otherMember = chat.members.find((member) => member.user.id !== user.id);
  const otherMemberIsOnline = otherMember ? isUserOnline(otherMember.user.id) : false;
  const pinnedMessage = chat.pinnedMessage ? serializeMessage(chat.pinnedMessage as BaseMessage) : null;
  const serializedMessages = rawMessages.reverse().map((m: BaseMessage) => serializeMessage(m));
  const messagesWithPinned = pinnedMessage && !serializedMessages.some((message) => message.id === pinnedMessage.id)
    ? [...serializedMessages, pinnedMessage].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    : serializedMessages;
  const forwardChats: ForwardChatOption[] = chatsPageData.chats
    .filter((candidate) => candidate.id !== chatId)
    .map((candidate) => ({
      id: candidate.id,
      title: candidate.type === "DIRECT"
        ? candidate.otherMember?.displayName ?? candidate.otherMember?.username ?? "Чат"
        : candidate.title ?? "Группа",
      avatarUrl: candidate.type === "DIRECT" ? candidate.otherMember?.avatarUrl ?? null : null,
    }));
  
  return (
    <div className="chat-screen bg-background transition-smooth overflow-hidden">
      <ChatMessages
        chatId={chat.id}
        currentRole={membership.role}
        currentUserId={user.id}
        initialMessages={messagesWithPinned}
        initialPinnedMessage={pinnedMessage}
        initialForwardChats={forwardChats}
        isLocked={chat.isLocked}
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
