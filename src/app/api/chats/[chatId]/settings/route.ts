import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToUser } from "@/lib/realtime";

const settingsSchema = z.object({
  mutedUntil: z.string().datetime().nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  deleted: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) {
    return NextResponse.json({ error: "Чат не найден." }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные настройки." }, { status: 400 });
  }

  const { mutedUntil, pinned, archived, deleted } = parsed.data;
  const now = new Date();
  const prisma = getPrisma();

  const updatedMembership = await prisma.chatMember.update({
    where: {
      chatId_userId: {
        chatId,
        userId: user.id,
      },
    },
    data: {
      mutedUntil: mutedUntil === undefined ? undefined : mutedUntil ? new Date(mutedUntil) : null,
      pinnedAt: pinned === undefined ? undefined : pinned ? now : null,
      archivedAt: archived === undefined ? undefined : archived ? now : null,
      deletedAt: deleted === undefined ? undefined : deleted ? now : null,
    },
    select: {
      chatId: true,
      mutedUntil: true,
      pinnedAt: true,
      archivedAt: true,
      deletedAt: true,
    },
  });

  emitToUser(user.id, "chat:updated", { chatId, settingsUpdated: true });

  return NextResponse.json({
    membership: {
      chatId: updatedMembership.chatId,
      mutedUntil: updatedMembership.mutedUntil?.toISOString() ?? null,
      pinnedAt: updatedMembership.pinnedAt?.toISOString() ?? null,
      archivedAt: updatedMembership.archivedAt?.toISOString() ?? null,
      deletedAt: updatedMembership.deletedAt?.toISOString() ?? null,
    },
  });
}
