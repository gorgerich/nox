import { NextResponse } from "next/server";
import { requireAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/audit";
import { getPrisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  context: { params: Promise<{ inviteId: string }> },
) {
  const { user: admin, response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const { inviteId } = await context.params;
  const prisma = getPrisma();
  const invite = await prisma.invite.findUnique({
    where: { id: inviteId },
    select: { id: true, status: true },
  });

  if (!invite) {
    return NextResponse.json({ error: "Приглашение не найдено." }, { status: 404 });
  }

  const updatedInvite = await prisma.invite.update({
    where: { id: invite.id },
    data: { status: "REVOKED" },
    select: {
      id: true,
      status: true,
      usedCount: true,
      maxUses: true,
      expiresAt: true,
      createdAt: true,
      targetEmail: true,
      targetUsername: true,
    },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "INVITE_REVOKED",
    targetType: "Invite",
    targetId: invite.id,
    metadata: { previousStatus: invite.status, nextStatus: updatedInvite.status },
  });

  return NextResponse.json({ invite: updatedInvite });
}

