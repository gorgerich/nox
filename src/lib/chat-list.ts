import { getPrisma } from "@/lib/prisma";
import { getChatFolderSettings, type BuiltInFolderItem, type ChatFolderItem } from "@/lib/chat-folders";

export type ChatListItem = {
  id: string;
  type: "DIRECT" | "GROUP";
  title: string | null;
  avatarUrl: string | null;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  mutedUntil: string | null;
  pinnedAt: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  isSelfChat: boolean;
  otherMember: {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string | null;
  } | null;
  lastMessage: {
    id: string;
    type: "TEXT" | "IMAGE" | "VIDEO" | "VIDEO_NOTE" | "FILE" | "VOICE" | "SYSTEM";
    body: string | null;
    isEncrypted?: boolean;
    ciphertext?: string | null;
    isMine?: boolean;
    deliveredAt?: string | null;
    readAt?: string | null;
    deliveryStatus?: "sent" | "delivered" | "read";
    deletedAt: string | null;
    createdAt: string;
    attachments: { id: string; fileName: string; mimeType: string; sizeBytes: number }[];
    sender: {
      id: string;
      username: string;
      displayName: string;
    };
  } | null;
};

export type IncomingRequestCardItem = {
  id: string;
  message: string | null;
  createdAt: string;
  fromUser: {
    username: string;
    profile: {
      displayName: string;
      avatarUrl: string | null;
    } | null;
  };
};

export type { BuiltInFolderItem, ChatFolderItem };

export async function getChatsPageData(userId: string) {
  const prisma = getPrisma();

  const [memberships, incomingRequests, archivedCount, chatFolderSettings] = await Promise.all([
    prisma.chatMember.findMany({
      where: {
        userId,
        status: "ACTIVE",
        archivedAt: null,
        deletedAt: null,
      },
      include: {
        chat: {
          include: {
            members: {
              where: { status: "ACTIVE" },
              include: {
                user: {
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
              },
              orderBy: { joinedAt: "asc" },
            },
            messages: {
              where: { deletedAt: null },
              orderBy: { createdAt: "desc" },
              take: 1,
              include: {
                attachments: {
                  select: {
                    id: true,
                    fileName: true,
                    mimeType: true,
                    sizeBytes: true,
                  },
                },
                sender: {
                  select: {
                    id: true,
                    username: true,
                    profile: { select: { displayName: true } },
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
          },
        },
      },
    }),
    prisma.chatRequest.findMany({
      where: {
        toUserId: userId,
        status: "PENDING",
      },
      orderBy: { createdAt: "desc" },
      include: {
        fromUser: {
          select: {
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    }),
    prisma.chatMember.count({
      where: {
        userId,
        status: "ACTIVE",
        archivedAt: { not: null },
        deletedAt: null,
      }
    }),
    getChatFolderSettings(userId),
  ]);

  const chatIds = memberships.map((membership) => membership.chatId);
  const visibleMessageScopes = memberships.map((membership) => ({
    chatId: membership.chatId,
    ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
  }));
  // Aggregate unread counts in the database (GROUP BY chatId) instead of
  // streaming every unread receipt row into Node and counting in JS. A user
  // with thousands of unread messages no longer transfers thousands of rows on
  // each chat-list render. The [messageId, userId] unique on MessageReceipt
  // means "messages with an unread receipt for me" equals "unread receipts".
  const unreadGroups = chatIds.length > 0
    ? await prisma.message.groupBy({
        by: ["chatId"],
        where: {
          OR: visibleMessageScopes,
          deletedAt: null,
          receipts: { some: { userId, readAt: null } },
        },
        // Prisma's groupBy types require orderBy to include the grouped field.
        orderBy: { chatId: "asc" },
        _count: { _all: true },
      })
    : [];

  const unreadCountByChatId = unreadGroups.reduce<Record<string, number>>((counts, group) => {
    counts[group.chatId] = group._count._all;
    return counts;
  }, {});

  const chats = memberships
    .map((membership) => {
      const otherMember = membership.chat.members.find((member) => member.user.id !== userId);
      const latestMessage = membership.chat.messages[0];
      const lastMessage = latestMessage && (
        !membership.clearedAt || latestMessage.createdAt > membership.clearedAt
      ) ? latestMessage : undefined;
      const lastMessageReceipts = lastMessage?.receipts ?? [];
      const readAt = lastMessageReceipts.find((receipt) => receipt.readAt)?.readAt ?? null;
      const deliveredAt = lastMessageReceipts.find((receipt) => receipt.deliveredAt)?.deliveredAt ?? null;
      const deliveryStatus = readAt ? "read" : deliveredAt ? "delivered" : "sent";

      return {
        id: membership.chat.id,
        type: membership.chat.type,
        title: membership.chat.title,
        avatarUrl: membership.chat.avatarUrl,
        createdAt: membership.chat.createdAt.toISOString(),
        updatedAt: membership.chat.updatedAt.toISOString(),
        unreadCount: unreadCountByChatId[membership.chatId] ?? 0,
        mutedUntil: membership.mutedUntil?.toISOString() ?? null,
        pinnedAt: membership.pinnedAt?.toISOString() ?? null,
        archivedAt: membership.archivedAt?.toISOString() ?? null,
        deletedAt: membership.deletedAt?.toISOString() ?? null,
        isSelfChat: membership.chat.type === "DIRECT" && !otherMember,
        otherMember: otherMember
          ? {
              id: otherMember.user.id,
              username: otherMember.user.username,
              displayName: otherMember.user.profile?.displayName ?? otherMember.user.username,
              avatarUrl: otherMember.user.profile?.avatarUrl ?? null,
            }
          : null,
        lastMessage: lastMessage
          ? {
              id: lastMessage.id,
              type: lastMessage.type,
              body: lastMessage.isEncrypted ? null : lastMessage.body,
              isEncrypted: lastMessage.isEncrypted,
              ciphertext: lastMessage.ciphertext,
              isMine: lastMessage.sender.id === userId,
              deliveredAt: deliveredAt?.toISOString() ?? lastMessage.deliveredAt?.toISOString() ?? null,
              readAt: readAt?.toISOString() ?? null,
              deliveryStatus,
              deletedAt: lastMessage.deletedAt?.toISOString() ?? null,
              createdAt: lastMessage.createdAt.toISOString(),
              attachments: lastMessage.attachments,
              sender: {
                id: lastMessage.sender.id,
                username: lastMessage.sender.username,
                displayName: lastMessage.sender.profile?.displayName ?? lastMessage.sender.username,
              },
            }
          : null,
      } satisfies ChatListItem;
    })
    .sort((left, right) => {
      const leftPinned = left.pinnedAt ? new Date(left.pinnedAt).getTime() : 0;
      const rightPinned = right.pinnedAt ? new Date(right.pinnedAt).getTime() : 0;
      if (leftPinned !== rightPinned) {
        return rightPinned - leftPinned;
      }

      if (left.isSelfChat !== right.isSelfChat) {
        return left.isSelfChat ? -1 : 1;
      }

      const leftTime = left.lastMessage?.createdAt ?? left.updatedAt;
      const rightTime = right.lastMessage?.createdAt ?? right.updatedAt;
      return new Date(rightTime).getTime() - new Date(leftTime).getTime();
    });

  return {
    chats,
    incomingRequests: incomingRequests.map((request) => ({
      ...request,
      createdAt: request.createdAt.toISOString(),
    })) satisfies IncomingRequestCardItem[],
    archivedCount,
    chatFolders: chatFolderSettings.folders,
    chatFolderSettings,
  };
}
