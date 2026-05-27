import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { emitToUsers } from "@/lib/realtime";

// Allowed disappearing timers (seconds). null = off.
const ALLOWED = new Set([0, 3600, 86400, 604800]); // off, 1h, 1d, 1w

const schema = z.object({
  seconds: z.number().int().nonnegative().nullable(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Требуется вход." }, { status: 401 });

  const { chatId } = await context.params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) return NextResponse.json({ error: "Чат не найден." }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success || (parsed.data.seconds !== null && !ALLOWED.has(parsed.data.seconds))) {
    return NextResponse.json({ error: "Некорректный таймер." }, { status: 400 });
  }

  const seconds = parsed.data.seconds && parsed.data.seconds > 0 ? parsed.data.seconds : null;
  const prisma = getPrisma();

  await prisma.chat.update({
    where: { id: chatId },
    data: { disappearingSeconds: seconds },
  });

  const members = await prisma.chatMember.findMany({
    where: { chatId, status: "ACTIVE" },
    select: { userId: true },
  });
  emitToUsers(members.map((m) => m.userId), "chat:disappearing-updated", { chatId, disappearingSeconds: seconds });

  return NextResponse.json({ disappearingSeconds: seconds });
}
