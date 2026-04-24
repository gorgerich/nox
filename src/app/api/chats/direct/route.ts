import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
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

  if (parsed.data.userId === user.id) {
    return NextResponse.json({ error: "Нельзя создать личный чат с собой." }, { status: 400 });
  }

  const prisma = getPrisma();
  const targetUser = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, status: true },
  });

  if (!targetUser || targetUser.status !== "ACTIVE") {
    return NextResponse.json({ error: "Пользователь не найден." }, { status: 404 });
  }

  const existingCandidates = await prisma.chat.findMany({
    where: {
      type: "DIRECT",
      AND: [
        { members: { some: { userId: user.id, status: "ACTIVE" } } },
        { members: { some: { userId: targetUser.id, status: "ACTIVE" } } },
      ],
    },
    include: {
      members: {
        select: {
          userId: true,
          status: true,
        },
      },
    },
  });

  const existingChat = existingCandidates.find((chat) => {
    const activeMemberIds = chat.members
      .filter((member) => member.status === "ACTIVE")
      .map((member) => member.userId);

    return (
      activeMemberIds.length === 2 &&
      activeMemberIds.includes(user.id) &&
      activeMemberIds.includes(targetUser.id)
    );
  });

  if (existingChat) {
    return NextResponse.json({ chat: existingChat });
  }

  const chat = await prisma.chat.create({
    data: {
      type: "DIRECT",
      createdByUserId: user.id,
      members: {
        create: [
          { userId: user.id, role: "OWNER" },
          { userId: targetUser.id, role: "MEMBER" },
        ],
      },
    },
    include: {
      members: {
        select: {
          userId: true,
          role: true,
          status: true,
        },
      },
    },
  });

  return NextResponse.json({ chat }, { status: 201 });
}
