import { getPrisma } from "@/lib/prisma";

export type ChatMemberRole = "OWNER" | "ADMIN" | "MEMBER";

export function isChatAdminRole(role: ChatMemberRole) {
  return role === "OWNER" || role === "ADMIN";
}

export async function getActiveChatMembership(chatId: string, userId: string) {
  const prisma = getPrisma();

  return prisma.chatMember.findUnique({
    where: {
      chatId_userId: {
        chatId,
        userId,
      },
    },
    include: {
      chat: true,
    },
  });
}

export async function requireActiveChatMembership(chatId: string, userId: string) {
  const membership = await getActiveChatMembership(chatId, userId);

  if (!membership || membership.status !== "ACTIVE") {
    return null;
  }

  return membership;
}
