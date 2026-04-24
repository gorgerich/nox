import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { findDirectChatBetween } from "@/lib/direct-chats";
import { getPrisma } from "@/lib/prisma";

const createRequestSchema = z.object({
  targetUsername: z
    .string()
    .trim()
    .min(1, "Введите username.")
    .max(32, "Username слишком длинный.")
    .regex(/^[a-zA-Z0-9_]+$/, "Username может содержать только латинские буквы, цифры и _.")
    .transform((value) => value.toLowerCase()),
  message: z.string().trim().max(500, "Сообщение слишком длинное.").optional(),
});

const requestUserSelect = {
  id: true,
  username: true,
  profile: {
    select: {
      displayName: true,
    },
  },
};

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const prisma = getPrisma();
  const [incoming, outgoing] = await Promise.all([
    prisma.chatRequest.findMany({
      where: { toUserId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        fromUser: { select: requestUserSelect },
        toUser: { select: requestUserSelect },
      },
    }),
    prisma.chatRequest.findMany({
      where: { fromUserId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        fromUser: { select: requestUserSelect },
        toUser: { select: requestUserSelect },
      },
    }),
  ]);

  return NextResponse.json({ incoming, outgoing });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createRequestSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректные данные запроса." }, { status: 400 });
  }

  const prisma = getPrisma();
  const targetUser = await prisma.user.findUnique({
    where: { username: parsed.data.targetUsername },
    select: { id: true, status: true },
  });

  if (!targetUser || targetUser.status !== "ACTIVE") {
    return NextResponse.json({ error: "Пользователь с таким username не найден." }, { status: 404 });
  }

  if (targetUser.id === user.id) {
    return NextResponse.json({ error: "Нельзя отправить запрос самому себе." }, { status: 400 });
  }

  const existingChat = await findDirectChatBetween(prisma, user.id, targetUser.id);

  if (existingChat) {
    return NextResponse.json({ error: "Чат уже существует.", chat: existingChat }, { status: 409 });
  }

  const existingPendingRequest = await prisma.chatRequest.findFirst({
    where: {
      fromUserId: user.id,
      toUserId: targetUser.id,
      status: "PENDING",
    },
  });

  if (existingPendingRequest) {
    return NextResponse.json({ error: "Запрос уже отправлен.", request: existingPendingRequest }, { status: 409 });
  }

  const incomingPendingRequest = await prisma.chatRequest.findFirst({
    where: {
      fromUserId: targetUser.id,
      toUserId: user.id,
      status: "PENDING",
    },
  });

  if (incomingPendingRequest) {
    return NextResponse.json({ error: "Этот пользователь уже отправил вам запрос." }, { status: 409 });
  }

  const chatRequest = await prisma.chatRequest.create({
    data: {
      fromUserId: user.id,
      toUserId: targetUser.id,
      message: parsed.data.message || null,
    },
    include: {
      fromUser: { select: requestUserSelect },
      toUser: { select: requestUserSelect },
    },
  });

  return NextResponse.json({ request: chatRequest }, { status: 201 });
}
