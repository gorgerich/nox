import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { findDirectChatBetween } from "@/lib/direct-chats";
import { getPrisma } from "@/lib/prisma";

const groupChatSchema = z.object({
  title: z.string().trim().min(1).max(120),
  memberIds: z.array(z.string().uuid()).min(1),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = groupChatSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Некорректные данные группового чата." }, { status: 400 });
  }

  const memberIds = Array.from(new Set(parsed.data.memberIds)).filter((id) => id !== user.id);

  if (memberIds.length === 0) {
    return NextResponse.json({ error: "Для группового чата нужны участники." }, { status: 400 });
  }

  const prisma = getPrisma();
  const activeUsers = await prisma.user.findMany({
    where: {
      id: { in: memberIds },
      status: "ACTIVE",
    },
    select: { id: true },
  });

  if (activeUsers.length !== memberIds.length) {
    return NextResponse.json({ error: "Один или несколько пользователей не найдены." }, { status: 400 });
  }

  if (user.role !== "OWNER" && user.role !== "ADMIN") {
    const contactChecks = await Promise.all(memberIds.map((memberId) => findDirectChatBetween(prisma, user.id, memberId)));

    if (contactChecks.some((chat) => !chat)) {
      return NextResponse.json(
        { error: "Группу можно создать только с существующими контактами." },
        { status: 403 },
      );
    }
  }

  const chat = await prisma.chat.create({
    data: {
      type: "GROUP",
      title: parsed.data.title,
      createdByUserId: user.id,
      members: {
        create: [
          { userId: user.id, role: "OWNER" },
          ...memberIds.map((memberId) => ({
            userId: memberId,
            role: "MEMBER" as const,
          })),
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
