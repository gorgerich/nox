import { getPrisma } from "@/lib/prisma";

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
    type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
    body: string | null;
    isEncrypted?: boolean;
    ciphertext?: string | null;
    deliveredAt?: string | null;
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

export async function getChatsPageData(userId: string) {
  const prisma = getPrisma();

  const [memberships, incomingRequests, archivedCount] = await Promise.all([
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
  ]);

  const chatIds = memberships.map((membership) => membership.chatId);
  const unreadReceipts = chatIds.length > 0
    ? await prisma.messageReceipt.findMany({
        where: {
          userId,
          readAt: null,
          message: {
            deletedAt: null,
            chatId: { in: chatIds },
          },
        },
        select: {
          message: {
            select: {
              chatId: true,
            },
          },
        },
      })
    : [];

  const unreadCountByChatId = unreadReceipts.reduce<Record<string, number>>((counts, receipt) => {
    const chatId = receipt.message.chatId;
    counts[chatId] = (counts[chatId] ?? 0) + 1;
    return counts;
  }, {});

  const chats = memberships
    .map((membership) => {
      const otherMember = membership.chat.members.find((member) => member.user.id !== userId);
      const lastMessage = membership.chat.messages[0];

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
              body: lastMessage.isEncrypted 
                ? (lastMessage.ciphertext ? "Зашифрованное сообщение" : "Сообщение доставлено")
                : lastMessage.body,
              isEncrypted: lastMessage.isEncrypted,
              ciphertext: lastMessage.ciphertext,
              deliveredAt: lastMessage.deliveredAt?.toISOString() ?? null,
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
  };
}
