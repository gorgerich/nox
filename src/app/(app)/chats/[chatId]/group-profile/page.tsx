import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { GroupProfileContent } from "./GroupProfileContent";

export default async function GroupProfilePage({
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
        },
        orderBy: { joinedAt: "asc" }
      }
    }
  });

  if (!chat || chat.type !== "GROUP") {
    redirect(`/chats/${chatId}`);
  }

  const members = chat.members.map(m => ({
    userId: m.user.id,
    name: m.user.profile?.displayName || m.user.username,
    username: m.user.username,
    avatarUrl: m.user.profile?.avatarUrl || null,
    role: m.role,
    status: m.status,
    isSelf: m.user.id === user.id
  }));

  return (
    <div className="chat-screen bg-background">
      <GroupProfileContent 
        chatId={chatId}
        chat={{
          id: chat.id,
          title: chat.title || "Группа",
          avatarUrl: chat.avatarUrl,
          createdAt: chat.createdAt.toISOString(),
        }}
        members={members}
        permissions={{
          canEditGroup: membership.role === "OWNER" || membership.role === "ADMIN",
          canAddMembers: true,
          canRemoveMembers: membership.role === "OWNER" || membership.role === "ADMIN"
        }}
      />
    </div>
  );
}
