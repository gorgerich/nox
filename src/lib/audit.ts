import { getPrisma } from "@/lib/prisma";

type AuditInput = {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  ipHash?: string;
};

export async function logAdminAction(input: AuditInput) {
  const prisma = getPrisma();

  await prisma.adminActionLog.create({
    data: {
      adminUserId: input.adminUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadata: input.metadata,
      ipHash: input.ipHash,
    },
  });
}
