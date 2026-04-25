import { getPrisma } from "./prisma";

/**
 * Resolves the effective display name for a user from the perspective of the current user.
 * Priority: Custom nickname > Profile displayName > Username
 */
export async function getEffectiveName(ownerId: string, targetUserId: string, fallbackUsername: string) {
  const prisma = getPrisma();
  
  const [settings, profile] = await Promise.all([
    prisma.contactSettings.findUnique({
      where: {
        ownerId_targetUserId: {
          ownerId,
          targetUserId,
        }
      },
      select: { nickname: true }
    }),
    prisma.profile.findUnique({
      where: { userId: targetUserId },
      select: { displayName: true }
    })
  ]);

  return settings?.nickname || profile?.displayName || fallbackUsername;
}

/**
 * Checks if targetUserId has blocked ownerId or vice versa.
 */
export async function checkBlockStatus(userA: string, userB: string) {
  const prisma = getPrisma();
  const blocks = await prisma.contactSettings.findMany({
    where: {
      OR: [
        { ownerId: userA, targetUserId: userB, isBlocked: true },
        { ownerId: userB, targetUserId: userA, isBlocked: true }
      ]
    }
  });
  
  return blocks.length > 0;
}
