import type { Prisma, PrismaClient } from "@prisma/client";

type PrismaTx = PrismaClient | Prisma.TransactionClient;

export async function findDirectChatBetween(prisma: PrismaTx, firstUserId: string, secondUserId: string) {
  const candidates = await prisma.chat.findMany({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: firstUserId, status: "ACTIVE" } } },
        { members: { some: { userId: secondUserId, status: "ACTIVE" } } },
      ],
    },
    include: {
      members: {
        select: {
          userId: true,
          role: true,
          status: true,
        },
      },
    },
  });

  return (
    candidates.find((chat) => {
      const activeMemberIds = chat.members
        .filter((member) => member.status === "ACTIVE")
        .map((member) => member.userId);

      return (
        activeMemberIds.length === 2 &&
        activeMemberIds.includes(firstUserId) &&
        activeMemberIds.includes(secondUserId)
      );
    }) ?? null
  );
}

export async function createDirectChat(prisma: PrismaTx, ownerUserId: string, memberUserId: string) {
  return prisma.chat.create({
    data: {
      type: "DIRECT",
      createdByUserId: ownerUserId,
      members: {
        create: [
          { userId: ownerUserId, role: "OWNER" },
          { userId: memberUserId, role: "MEMBER" },
        ],
      },
    },
    include: {
      members: {
        select: {
          userId: true,
          role: true,
          status: true,
        },
      },
    },
  });
}
