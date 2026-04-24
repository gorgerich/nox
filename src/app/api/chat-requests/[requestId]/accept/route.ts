import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createDirectChat, findDirectChatBetween } from "@/lib/direct-chats";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers } from "@/lib/realtime";

export async function POST(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { requestId } = await context.params;
  const prisma = getPrisma();

  const result = await prisma.$transaction(async (tx) => {
    const chatRequest = await tx.chatRequest.findUnique({
      where: { id: requestId },
    });

    if (!chatRequest || chatRequest.toUserId !== user.id) {
      return { status: 404 as const, body: { error: "Запрос не найден." } };
    }

    if (chatRequest.status !== "PENDING") {
      return { status: 400 as const, body: { error: "Запрос уже обработан." } };
    }

    const [fromUser, toUser] = await Promise.all([
      tx.user.findUnique({ where: { id: chatRequest.fromUserId }, select: { status: true } }),
      tx.user.findUnique({ where: { id: chatRequest.toUserId }, select: { status: true } }),
    ]);

    if (!fromUser || !toUser || fromUser.status !== "ACTIVE" || toUser.status !== "ACTIVE") {
      return { status: 403 as const, body: { error: "Нет доступа." } };
    }

    const existingChat = await findDirectChatBetween(tx, chatRequest.fromUserId, chatRequest.toUserId);
    const chat = existingChat ?? (await createDirectChat(tx, chatRequest.fromUserId, chatRequest.toUserId));

    const updatedRequest = await tx.chatRequest.update({
      where: { id: chatRequest.id },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
        chatId: chat.id,
      },
    });

    return { status: 200 as const, body: { request: updatedRequest, chat } };
  });

  if (result.status === 200 && "request" in result.body && "chat" in result.body) {
    const { request, chat } = result.body;
    emitToUsers(
      [request.fromUserId, request.toUserId],
      "chat-request:accepted",
      {
        request,
        chat,
      },
    );

    emitToUsers(
      [request.fromUserId, request.toUserId],
      "chat:updated",
      { chatId: chat.id },
    );
  }

  return NextResponse.json(result.body, { status: result.status });
}
