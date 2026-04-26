import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const { messageId } = await params;
  const prisma = getPrisma();

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: {
      chat: {
        include: { members: { include: { user: { include: { profile: true } } } } }
      },
      receipts: {
        where: { readAt: { not: null } },
        include: { user: { include: { profile: true } } }
      }
    }
  });

  if (!message || message.chat.type !== "GROUP") {
    return NextResponse.json({ error: "Группа не найдена." }, { status: 404 });
  }

  const readers = message.receipts
    .filter(r => r.userId !== user.id)
    .map(r => ({
      userId: r.userId,
      name: r.user.profile?.displayName ?? r.user.username,
      username: r.user.username,
      avatarUrl: r.user.profile?.avatarUrl ?? null,
      readAt: r.readAt?.toISOString() ?? null,
      isSelf: false
    }));

  return NextResponse.json({
    messageId,
    readers,
    total: readers.length
  });
}
