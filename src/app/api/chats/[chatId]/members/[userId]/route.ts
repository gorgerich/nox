import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers, emitToChat } from "@/lib/realtime";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ chatId: string; userId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const { chatId, userId } = await params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN" && user.id !== userId)) {
    return NextResponse.json({ error: "Нет прав для удаления участника." }, { status: 403 });
  }

  const prisma = getPrisma();
  
  // Hard delete member for MVP, or set status to LEFT/REMOVED
  await prisma.chatMember.update({
    where: { chatId_userId: { chatId, userId } },
    data: { status: user.id === userId ? "LEFT" : "REMOVED" }
  });

  emitToChat(chatId, "chat:updated", { chatId });
  emitToUsers([userId], "chat:updated", { chatId });

  return NextResponse.json({ success: true });
}
