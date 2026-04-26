import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { saveObject } from "@/lib/storage";
import { requireActiveChatMembership } from "@/lib/chats";
import { emitToChat } from "@/lib/realtime";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { chatId } = await params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return NextResponse.json({ error: "Нет прав для редактирования группы." }, { status: 403 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Выберите файл." }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Разрешены только изображения." }, { status: 400 });
  }

  // Max 5MB for avatars
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 5МБ)." }, { status: 400 });
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const { storageKey } = await saveObject(fileBuffer);
    
    const prisma = getPrisma();
    const chat = await prisma.chat.update({
      where: { id: chatId },
      data: { avatarUrl: storageKey },
    });

    emitToChat(chatId, "chat:updated", { 
        chatId: chat.id, 
        title: chat.title,
        avatarUrl: chat.avatarUrl 
    });

    return NextResponse.json({ success: true, avatarUrl: storageKey });
  } catch (error) {
    console.error("Group avatar upload failed", error);
    return NextResponse.json({ error: "Не удалось загрузить аватар." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { chatId } = await params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  
  if (!membership || (membership.role !== "OWNER" && membership.role !== "ADMIN")) {
    return NextResponse.json({ error: "Нет прав для редактирования группы." }, { status: 403 });
  }

  const prisma = getPrisma();
  try {
    const chat = await prisma.chat.update({
      where: { id: chatId },
      data: { avatarUrl: null },
    });

    emitToChat(chatId, "chat:updated", { 
        chatId: chat.id, 
        title: chat.title,
        avatarUrl: null
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Group avatar deletion failed", error);
    return NextResponse.json({ error: "Не удалось удалить аватар." }, { status: 500 });
  }
}
