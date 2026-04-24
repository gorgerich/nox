import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export async function POST(_request: Request, context: { params: Promise<{ requestId: string }> }) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { requestId } = await context.params;
  const prisma = getPrisma();
  const chatRequest = await prisma.chatRequest.findUnique({
    where: { id: requestId },
  });

  if (!chatRequest || chatRequest.toUserId !== user.id) {
    return NextResponse.json({ error: "Запрос не найден." }, { status: 404 });
  }

  if (chatRequest.status !== "PENDING") {
    return NextResponse.json({ error: "Запрос уже обработан." }, { status: 400 });
  }

  const updatedRequest = await prisma.chatRequest.update({
    where: { id: requestId },
    data: {
      status: "DECLINED",
      respondedAt: new Date(),
    },
  });

  return NextResponse.json({ request: updatedRequest });
}
