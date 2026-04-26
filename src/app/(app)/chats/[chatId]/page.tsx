import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getChatsPageData } from "@/lib/chat-list";
import { getPrisma } from "@/lib/prisma";
import { ChatMessages } from "./ChatMessages";

type BaseMessage = {
  id: string;
  body: string | null;
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  senderUserId: string;
  replyToMessageId: string | null;
  deletedAt: Date | null;
  editedAt: Date | null;
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
}: {
  params: Promise<{ chatId: string }>;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const { chatId } = await params;
  const membership = await requireActiveChatMembership(chatId, user.id);

  if (!membership) {
    redirect("/chats");
  }

  const prisma = getPrisma();
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
      where: { chatId },
      orderBy: { createdAt: "desc" },
      take: 50,
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
          } : undefined
        }}
      />
    </div>
  );
}
