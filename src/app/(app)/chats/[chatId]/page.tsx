import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { ChatMessages } from "./ChatMessages";

function getRoleLabel(role: string) {
  if (role === "OWNER") {
    return "Владелец";
  }

  if (role === "ADMIN") {
    return "Администратор";
  }

  return "Участник";
}

function serializeMessage(message: {
  id: string;
  body: string | null;
  type: "TEXT" | "IMAGE" | "VIDEO" | "FILE" | "VOICE" | "SYSTEM";
  senderUserId: string;
  deletedAt: Date | null;
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
}) {
  return {
    ...message,
    deletedAt: message.deletedAt?.toISOString() ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}

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
  const [chat, rawMessages] = await Promise.all([
    prisma.chat.findUnique({
      where: { id: chatId },
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
      },
    }),
  ]);

  if (!chat) {
    redirect("/chats");
  }

  const otherMember = chat.members.find((member) => member.user.id !== user.id);
  const title =
    chat.type === "DIRECT"
      ? otherMember?.user.profile?.displayName ?? otherMember?.user.username ?? "Личный чат"
      : chat.title ?? "Групповой чат";
  const chatTypeLabel = chat.type === "DIRECT" ? "Личный чат" : "Групповой чат";

  return (
    <section className="lg:grid lg:gap-6 lg:grid-cols-[280px_1fr]">
      <div className="mb-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 lg:hidden">
        <Link className="inline-flex min-h-10 items-center text-sm text-neutral-400 transition hover:text-white" href="/chats">
          Назад к чатам
        </Link>
        <div className="mt-3 flex items-start justify-between gap-3">
          <div>
            <span className="rounded-full bg-neutral-800 px-2 py-1 text-xs text-neutral-400">
              {chatTypeLabel}
            </span>
            <h1 className="mt-2 text-xl font-semibold">{title}</h1>
          </div>
          {chat.isLocked ? <p className="text-sm text-amber-300">Закрыт</p> : null}
        </div>
      </div>

      <aside className="hidden rounded-lg border border-neutral-800 bg-neutral-900 p-4 lg:block">
        <Link className="inline-flex min-h-10 items-center text-sm text-neutral-400 transition hover:text-white" href="/chats">
          Назад к чатам
        </Link>

        <div className="mt-6">
          <span className="rounded-full bg-neutral-800 px-2 py-1 text-xs text-neutral-400">
            {chatTypeLabel}
          </span>
          <h1 className="mt-3 text-xl font-semibold">{title}</h1>
          {chat.isLocked ? <p className="mt-2 text-sm text-amber-300">Закрыт</p> : null}
        </div>

        <div className="mt-6">
          <p className="text-sm font-medium text-neutral-300">Участники</p>
          <div className="mt-3 grid gap-2">
            {chat.members.map((member) => (
              <div
                className="rounded-md border border-neutral-800 bg-neutral-950 p-3"
                key={member.id}
              >
                <p className="truncate text-sm font-medium">
                  {member.user.profile?.displayName ?? member.user.username}
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  @{member.user.username} · {getRoleLabel(member.role)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </aside>

      <ChatMessages
        chatId={chat.id}
        currentRole={membership.role}
        currentUserId={user.id}
        initialMessages={rawMessages.reverse().map(serializeMessage)}
        isLocked={chat.isLocked}
      />
    </section>
  );
}
