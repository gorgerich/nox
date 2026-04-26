import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers, emitToChat } from "@/lib/realtime";

const addMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const { chatId } = await params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  
  if (!membership) {
    return NextResponse.json({ error: "Нет прав для изменения участников." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = addMembersSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Ошибка данных." }, { status: 400 });

  const prisma = getPrisma();
  
  const existingMembers = await prisma.chatMember.findMany({
    where: { chatId, userId: { in: parsed.data.userIds } },
    select: { userId: true }
  });
  const existingUserIds = existingMembers.map(m => m.userId);
  const newUserIds = parsed.data.userIds.filter(id => !existingUserIds.includes(id));

  if (newUserIds.length === 0) {
    return NextResponse.json({ message: "Участники уже в группе." });
  }

  await prisma.chatMember.createMany({
    data: newUserIds.map(id => ({
      chatId,
      userId: id,
      role: "MEMBER"
    }))
  });

  emitToChat(chatId, "chat:updated", { chatId });
  emitToUsers(newUserIds, "chat:updated", { chatId });

  return NextResponse.json({ success: true });
}
