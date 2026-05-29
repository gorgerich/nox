import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const searchSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, "Введите username.")
    .max(32, "Username слишком длинный.")
    .regex(/^[\p{L}\p{N}_]+$/u, "Username может содержать буквы, цифры и _.")
    .transform((value) => value.toLowerCase()),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = searchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Некорректный username." }, { status: 400 });
  }

  const prisma = getPrisma();
  const foundUser = await prisma.user.findUnique({
    where: { username: parsed.data.username },
    select: {
      id: true,
      username: true,
      status: true,
      profile: {
        select: {
          displayName: true,
        },
      },
    },
  });

  if (!foundUser || foundUser.status !== "ACTIVE") {
    return NextResponse.json({ error: "Пользователь с таким username не найден." }, { status: 404 });
  }

  return NextResponse.json({
    user: {
      id: foundUser.id,
      username: foundUser.username,
      displayName: foundUser.profile?.displayName ?? foundUser.username,
      isSelf: foundUser.id === user.id,
    },
  });
}
