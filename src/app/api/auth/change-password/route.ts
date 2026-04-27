import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import crypto from "crypto";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Введите текущий пароль"),
  newPassword: z.string().min(8, "Новый пароль должен быть не менее 8 символов"),
  revokeOtherDevices: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = changePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const prisma = getPrisma();
    const { currentPassword, newPassword, revokeOtherDevices } = parsed.data;

    // Verify current password
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    if (!dbUser || !dbUser.passwordHash) {
       return NextResponse.json({ error: "Пользователь не найден или пароль не установлен" }, { status: 400 });
    }

    const isValid = await bcrypt.compare(currentPassword, dbUser.passwordHash);
    if (!isValid) {
      return NextResponse.json({ error: "Неверный текущий пароль" }, { status: 400 });
    }

    // Hash new password
    const newPasswordHash = await bcrypt.hash(newPassword, 10);

    // Get current device info (if available via headers or a dedicated mechanism in the future)
    // For now, if revokeOtherDevices is requested, we might revoke all or implement a way to keep current.
    // In this MVP, we will only log the action. Revoking specific devices requires knowing the current device ID
    // making the request.

    await prisma.$transaction(async (tx) => {
       await tx.user.update({
         where: { id: user.id },
         data: { passwordHash: newPasswordHash },
       });

       const ip = request.headers.get("x-forwarded-for") || "unknown";
       const ipHash = crypto.createHash("sha256").update(ip).digest("hex");

       await tx.adminActionLog.create({
         data: {
           adminUserId: user.id,
           action: "PASSWORD_CHANGE",
           targetType: "USER",
           targetId: user.id,
           metadata: {
             revokeOtherDevices,
           },
           ipHash,
         },
       });

       // Note: E2EE local keys remain untouched as this is an authenticated change.
    });

    return NextResponse.json({ message: "Пароль успешно изменен" });

  } catch (error) {
    console.error("Change password error:", error);
    return NextResponse.json({ error: "Внутренняя ошибка сервера" }, { status: 500 });
  }
}
