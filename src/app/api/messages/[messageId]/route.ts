import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { messageId } = await context.params;
  const prisma = getPrisma();
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      chat: {
        include: {
          members: {
            where: { userId: user.id },
            select: {
              role: true,
              status: true,
            },
          },
        },
      },
    },
  });

  const membership = message?.chat.members[0];

  if (!message || !membership || membership.status !== "ACTIVE") {
    return NextResponse.json({ error: "Сообщение не найдено." }, { status: 404 });
  }

  const canDelete = message.senderUserId === user.id || isChatAdminRole(membership.role);

  if (!canDelete) {
    return NextResponse.json({ error: "Доступ запрещён." }, { status: 403 });
  }

  const deletedMessage = await prisma.message.update({
    where: { id: message.id },
    data: { deletedAt: message.deletedAt ?? new Date() },
  });

  return NextResponse.json({ message: deletedMessage });
}
