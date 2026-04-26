import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToChat } from "@/lib/realtime";

const groupProfileSchema = z.object({
  title: z.string().trim().min(1).max(64).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const { chatId } = await params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return NextResponse.json({ error: "Нет прав для редактирования группы." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = groupProfileSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Ошибка данных." }, { status: 400 });

  const prisma = getPrisma();
  const chat = await prisma.chat.update({
    where: { id: chatId },
    data: parsed.data
  });

  emitToChat(chatId, "chat:updated", { chatId: chat.id, title: chat.title });

  return NextResponse.json({ chat });
}
