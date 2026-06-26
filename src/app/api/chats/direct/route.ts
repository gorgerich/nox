import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createDirectChat, findDirectChatBetween } from "@/lib/direct-chats";
import { getPrisma } from "@/lib/prisma";

const directChatSchema = z.object({
  userId: z.string().uuid(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = directChatSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные личного чата." }, { status: 400 });
  }

  const prisma = getPrisma();
  const targetUser = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, status: true },
  });

  if (!targetUser || targetUser.status !== "ACTIVE") {
    return NextResponse.json({ error: "Пользователь не найден." }, { status: 404 });
  }

  const existingChat = await findDirectChatBetween(prisma, user.id, targetUser.id);

  if (existingChat) {
    await prisma.chatMember.update({
      where: {
        chatId_userId: {
          chatId: existingChat.id,
          userId: user.id,
        },
      },
      data: {
        deletedAt: null,
        archivedAt: null,
      },
    });
    return NextResponse.json({ chat: existingChat });
  }

  if (user.role !== "OWNER" && user.role !== "ADMIN" && user.id !== targetUser.id) {
    const acceptedRequest = await prisma.chatRequest.findFirst({
      where: {
        status: "ACCEPTED",
        OR: [
          { fromUserId: user.id, toUserId: targetUser.id },
          { fromUserId: targetUser.id, toUserId: user.id },
        ],
      },
    });

    if (!acceptedRequest) {
      return NextResponse.json({ error: "Сначала нужен принятый запрос на общение." }, { status: 403 });
    }
  }

  const chat = await createDirectChat(prisma, user.id, targetUser.id);

  await prisma.chatRequest.updateMany({
    where: {
      status: "ACCEPTED",
      chatId: null,
      OR: [
        { fromUserId: user.id, toUserId: targetUser.id },
        { fromUserId: targetUser.id, toUserId: user.id },
      ],
    },
    data: { chatId: chat.id },
  });

  return NextResponse.json({ chat }, { status: 201 });
}
