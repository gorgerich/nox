import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { detectImageMimeType, saveObject } from "@/lib/storage";

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Выберите файл." }, { status: 400 });
  }

  // Max 5MB for avatars
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "Файл слишком большой (макс. 5МБ)." }, { status: 400 });
  }

  try {
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const detectedMimeType = detectImageMimeType(fileBuffer);
    if (!detectedMimeType) {
      return NextResponse.json({ error: "Разрешены JPEG, PNG и WebP." }, { status: 400 });
    }
    const { storageKey } = await saveObject(fileBuffer);
    
    // We store the storage key in the avatarUrl field. 
    // We'll need a route to serve it.
    const prisma = getPrisma();
    await prisma.profile.upsert({
      where: { userId: user.id },
      create: { 
        userId: user.id,
        displayName: user.username,
        avatarUrl: storageKey 
      },
      update: { avatarUrl: storageKey },
    });

    return NextResponse.json({ success: true, avatarUrl: storageKey });
  } catch (error) {
    console.error("Avatar upload failed", error);
    return NextResponse.json({ error: "Не удалось загрузить аватар." }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const prisma = getPrisma();
  try {
    await prisma.profile.update({
      where: { userId: user.id },
      data: { avatarUrl: null },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Avatar deletion failed", error);
    return NextResponse.json({ error: "Не удалось удалить аватар." }, { status: 500 });
  }
}
