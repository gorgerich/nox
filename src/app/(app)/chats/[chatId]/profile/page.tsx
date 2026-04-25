import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { PartnerProfileContent } from "./PartnerProfileContent";

export default async function PartnerProfilePage({
  params,
}: {
  params: Promise<{ chatId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { chatId } = await params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) redirect("/chats");

  const prisma = getPrisma();
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    include: {
      members: {
        where: { status: "ACTIVE" },
        include: {
          user: {
            include: { profile: true }
          }
        }
      }
    }
  });

  if (!chat || chat.type !== "DIRECT") {
    // Group profile is not handled yet in MVP, redirect back
    redirect(`/chats/${chatId}`);
  }

  const partnerMember = chat.members.find(m => m.userId !== user.id);
  if (!partnerMember) redirect(`/chats/${chatId}`);

  const partnerUser = partnerMember.user;

  // Get current user's settings for this partner
  const contactSettings = await prisma.contactSettings.findUnique({
    where: {
      ownerId_targetUserId: {
        ownerId: user.id,
        targetUserId: partnerUser.id
      }
    }
  });

  return (
    <div className="chat-screen bg-background">
      <PartnerProfileContent 
        chatId={chatId}
        partnerUser={{
          id: partnerUser.id,
          username: partnerUser.username,
          lastSeenAt: partnerUser.lastSeenAt?.toISOString() || null,
          displayName: partnerUser.profile?.displayName || partnerUser.username,
          avatarUrl: partnerUser.profile?.avatarUrl,
          bio: partnerUser.profile?.bio
        }}
        initialSettings={{
          nickname: contactSettings?.nickname || null,
          isBlocked: contactSettings?.isBlocked || false,
          mutedUntil: partnerMember.mutedUntil?.toISOString() || null
        }}
      />
    </div>
  );
}
