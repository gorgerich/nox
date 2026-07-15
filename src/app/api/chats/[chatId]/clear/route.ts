import { NextResponse } from "next/server";

import { requireActiveChatMembership } from "@/lib/chats";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { emitToUser } from "@/lib/realtime";

export async function DELETE(
  _request: Request,
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

  const prisma = getPrisma();
  const now = new Date();
  await prisma.chatMember.update({
    where: {
      chatId_userId: { chatId, userId: user.id },
    },
    data: {
      clearedAt: now,
      lastReadAt: now,
      lastReadMessageId: null,
    },
  });

  emitToUser(user.id, "chat:cleared", { chatId, clearedAt: now.toISOString() });

  return NextResponse.json({ clearedAt: now.toISOString() });
}
