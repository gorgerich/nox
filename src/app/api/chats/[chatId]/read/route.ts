import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  context: { params: Promise<{ chatId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const prisma = getPrisma();

  // Update lastReadAt for this user in this chat
  await prisma.chatMember.updateMany({
    where: {
      chatId,
      userId: user.id,
      status: "ACTIVE",
    },
    data: {
      lastReadAt: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
