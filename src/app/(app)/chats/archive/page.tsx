import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { ArchivePageClient } from "./ArchivePageClient";
import type { ChatListItem } from "@/lib/chat-list";

export default async function ArchivePage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const prisma = getPrisma();
  
  const memberships = await prisma.chatMember.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      archivedAt: { not: null },
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
  });

  const chatIds = memberships.map((membership) => membership.chatId);
  const visibleMessageScopes = memberships.map((membership) => ({
    chatId: membership.chatId,
    ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
  }));
  const unreadReceipts = chatIds.length > 0
    ? await prisma.messageReceipt.findMany({
        where: {
          userId: user.id,
          readAt: null,
          message: {
            deletedAt: null,
            OR: visibleMessageScopes,
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

  const archivedChats = memberships
    .map((membership) => {
      const otherMember = membership.chat.members.find((member) => member.user.id !== user.id);
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
              isMine: lastMessage.sender.id === user.id,
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
        // The archive lists conversations that were deliberately set aside; a
        // call event is not part of what it is for, and the projection does not
        // load one.
        lastCall: null,
      } satisfies ChatListItem;
    })
    .sort((left, right) => {
      const leftTime = left.lastMessage?.createdAt ?? left.updatedAt;
      const rightTime = right.lastMessage?.createdAt ?? right.updatedAt;
      return new Date(rightTime).getTime() - new Date(leftTime).getTime();
    });

  return (
    <div className="app-section animate-in fade-in duration-180">
      <header className="app-section-header">
        <h1 className="app-section-title text-3xl">Архив</h1>
      </header>
      <ArchivePageClient initialChats={archivedChats} />
    </div>
  );
}
