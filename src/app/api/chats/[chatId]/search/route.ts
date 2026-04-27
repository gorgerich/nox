import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { requireActiveChatMembership } from "@/lib/chats";
import { Prisma } from "@prisma/client";

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await context.params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const query = searchParams.get("q");

  if (!query || query.length < 2) {
    return NextResponse.json({ messages: [] });
  }

  const prisma = getPrisma();
  const mode: Prisma.QueryMode = "insensitive";
  const messages = await prisma.message.findMany({
    where: {
      chatId,
      body: { contains: query, mode },
      isEncrypted: false,
      deletedAt: null,
    },
    include: {
      sender: {
        select: {
          username: true,
          profile: { select: { displayName: true } }
        }
      }
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    messages: messages.map(m => ({
      id: m.id,
      body: m.body,
      createdAt: m.createdAt,
      senderName: m.sender.profile?.displayName || m.sender.username,
    }))
  });
}
