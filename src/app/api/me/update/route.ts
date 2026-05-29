import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const updateSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, "Введите имя.")
    .max(50, "Имя не должно быть длиннее 50 символов."),
  username: z
    .string()
    .trim()
    .min(3, "Username должен содержать минимум 3 символа.")
    .max(32, "Username не должен быть длиннее 32 символов.")
    .regex(/^[\p{L}\p{N}_]+$/u, "Username может содержать буквы, цифры и _.")
    .transform((value) => value.toLowerCase()),
  bio: z
    .string()
    .trim()
    .max(200, "Раздел «О себе» не должен быть длиннее 200 символов.")
    .optional()
    .transform((value) => value ?? ""),
  login: z
    .string()
    .trim()
    .min(3, "Логин должен содержать минимум 3 символа.")
    .max(64, "Логин не должен быть длиннее 64 символов.")
    .regex(/^[a-zA-Z0-9_@.-]+$/, "Логин содержит недопустимые символы.")
    .transform((value) => value.toLowerCase())
    .optional(),
  theme: z.enum(["dark", "light", "system"]).optional(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные данные профиля." },
      { status: 400 },
    );
  }

  const { displayName, username, bio, login } = parsed.data;
  const prisma = getPrisma();

  try {
    const currentUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        login: true,
        username: true,
        status: true,
      },
    });

    if (!currentUser) {
      return NextResponse.json({ error: "Пользователь не найден." }, { status: 404 });
    }

    if (currentUser.status === "BLOCKED" || currentUser.status === "REVOKED") {
      return NextResponse.json({ error: "Доступ к профилю ограничен." }, { status: 403 });
    }

    if (login && login !== (currentUser.login ?? "")) {
      return NextResponse.json({ error: "Изменение логина пока недоступно." }, { status: 400 });
    }

    if (username !== currentUser.username) {
      const existing = await prisma.user.findFirst({
        where: {
          id: { not: currentUser.id },
          OR: [{ username }, { login: username }],
        },
        select: { id: true },
      });

      if (existing) {
        return NextResponse.json({ error: "Этот username уже занят." }, { status: 400 });
      }
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: {
        username,
        profile: {
          upsert: {
            create: { displayName, bio },
            update: { displayName, bio },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      user: {
        username,
        displayName,
        bio,
      },
    });
  } catch (error) {
    console.error("Profile update failed", error);
    return NextResponse.json({ error: "Не удалось обновить профиль." }, { status: 500 });
  }
}
