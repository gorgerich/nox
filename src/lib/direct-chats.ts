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

      if (firstUserId === secondUserId) {
        return activeMemberIds.length === 1 && activeMemberIds[0] === firstUserId;
      }

      return (
        activeMemberIds.length === 2 &&
        activeMemberIds.includes(firstUserId) &&
        activeMemberIds.includes(secondUserId)
      );
    }) ?? null
  );
}

export async function createDirectChat(prisma: PrismaTx, ownerUserId: string, memberUserId: string) {
  const members = ownerUserId === memberUserId
    ? [{ userId: ownerUserId, role: "OWNER" as const }]
    : [
        { userId: ownerUserId, role: "OWNER" as const },
        { userId: memberUserId, role: "MEMBER" as const },
      ];

  return prisma.chat.create({
    data: {
      type: "DIRECT",
      title: ownerUserId === memberUserId ? "Избранное" : null,
      createdByUserId: ownerUserId,
      members: {
        create: members,
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
