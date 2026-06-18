import { notFound, redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { isUserOnline } from "@/lib/realtime";

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
  const prisma = getPrisma();

  // Run the membership check and the chat fetch in parallel instead of waiting
  // for one before starting the other — both only need chatId + user.id, and
  // the chat result is discarded if membership fails. Cuts one DB round-trip
  // off the profile open.
  const [membership, chat] = await Promise.all([
    requireActiveChatMembership(chatId, user.id),
    prisma.chat.findUnique({
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
    }),
  ]);

  if (!membership) {
    redirect("/chats");
  }

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
  const partnerIsOnline = isUserOnline(partnerMember.user.id);

  return (
    <div className="chat-screen bg-background transition-smooth overflow-hidden">
      <PartnerProfileContent
        chatId={chat.id}
        currentUserId={user.id}
        partnerUser={{
          id: partnerMember.user.id,
          username: partnerMember.user.username,
          lastSeenAt: partnerMember.user.lastSeenAt?.toISOString() ?? null,
          isOnline: partnerIsOnline,
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
