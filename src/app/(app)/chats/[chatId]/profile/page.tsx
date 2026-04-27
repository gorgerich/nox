import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";

import { PartnerProfileContent } from "./PartnerProfileContent";

export default async function ProfilePage({
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
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      type: true,
      members: {
        where: { status: "ACTIVE" },
        select: {
          userId: true,
          mutedUntil: true,
          user: {
            select: {
              id: true,
              username: true,
              lastSeenAt: true,
              profile: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                  bio: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!chat || chat.type !== "DIRECT") {
    notFound();
  }

  const partnerMember = chat.members.find((member) => member.userId !== user.id);

  if (!partnerMember) {
    redirect("/profile");
  }

  const contactSettings = await prisma.contactSettings.findUnique({
    where: {
      ownerId_targetUserId: {
        ownerId: user.id,
        targetUserId: partnerMember.user.id,
      },
    },
    select: {
      nickname: true,
      isBlocked: true,
    },
  });

  const displayName =
    contactSettings?.nickname ||
    partnerMember.user.profile?.displayName ||
    partnerMember.user.username ||
    "Пользователь";

  return (
    <div className="chat-screen bg-background transition-smooth overflow-hidden">
      <PartnerProfileContent
        chatId={chat.id}
        partnerUser={{
          id: partnerMember.user.id,
          username: partnerMember.user.username,
          lastSeenAt: partnerMember.user.lastSeenAt?.toISOString() ?? null,
          displayName,
          avatarUrl: partnerMember.user.profile?.avatarUrl ?? null,
          bio: partnerMember.user.profile?.bio ?? null,
        }}
        initialSettings={{
          nickname: contactSettings?.nickname ?? null,
          isBlocked: contactSettings?.isBlocked ?? false,
          mutedUntil: membership.mutedUntil?.toISOString() ?? null,
        }}
      />
    </div>
  );
}
