import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";

export async function GET(
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

  return NextResponse.json({ chat: membership.chat, membership });
}
