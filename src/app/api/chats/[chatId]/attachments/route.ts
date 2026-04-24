import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isChatAdminRole, requireActiveChatMembership } from "@/lib/chats";
import { getPrisma } from "@/lib/prisma";
import { getAttachmentRule, saveObject } from "@/lib/storage";

export async function POST(
  request: Request,
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

  if (membership.chat.isLocked && !isChatAdminRole(membership.role)) {
    return NextResponse.json({ error: "Чат закрыт." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Выберите файл." }, { status: 400 });
  }

  const rule = getAttachmentRule(file.type);

  if (!rule) {
    return NextResponse.json({ error: "Тип файла не разрешён." }, { status: 400 });
  }

  if (file.size <= 0 || file.size > rule.maxSizeBytes) {
    return NextResponse.json({ error: "Размер файла не разрешён." }, { status: 400 });
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const { storageKey } = await saveObject(fileBuffer);
  const prisma = getPrisma();
  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        chatId,
        senderUserId: user.id,
        type: rule.kind,
        attachments: {
          create: {
            uploaderUserId: user.id,
            storageKey,
            fileName: file.name || "файл",
            mimeType: file.type,
            sizeBytes: file.size,
          },
        },
      },
      include: {
        sender: {
          select: {
            id: true,
            username: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
        attachments: true,
      },
    });

    await tx.chat.update({
      where: { id: chatId },
      data: { updatedAt: new Date() },
    });

    return createdMessage;
  });

  return NextResponse.json({ message }, { status: 201 });
}
