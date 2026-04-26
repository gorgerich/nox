import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { emitToUser } from "@/lib/realtime";

const groupChatSchema = z.object({
  title: z.string().trim().min(1).max(64),
  memberIds: z.array(z.string().uuid()).min(1),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = groupChatSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Ошибка данных." }, { status: 400 });

  const prisma = getPrisma();
  const memberIds = [...new Set([...parsed.data.memberIds, user.id])];

  const chat = await prisma.chat.create({
    data: {
      type: "GROUP",
      title: parsed.data.title,
      createdByUserId: user.id,
      members: {
        create: memberIds.map(id => ({ userId: id, role: id === user.id ? "OWNER" : "MEMBER" })),
      },
    },
    include: { members: { include: { user: true } } }
  });

  for (const id of memberIds) {
    emitToUser(id, "chat:updated", { chatId: chat.id });
  }

  return NextResponse.json({ chat }, { status: 201 });
}
