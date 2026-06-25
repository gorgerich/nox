import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getChatFolderSettings, saveChatFolderSettings } from "@/lib/chat-folders";

const folderSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(28),
  chatIds: z.array(z.string().min(1)).max(200),
  createdAt: z.string().min(1),
});

const saveSchema = z.object({
  folders: z.array(folderSchema).max(12),
  builtIns: z.array(z.object({
    key: z.enum(["personal", "important", "unread"]),
    visible: z.boolean(),
    order: z.number().int().min(0).max(10),
  })).max(3).optional(),
});

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const settings = await getChatFolderSettings(user.id);
  return NextResponse.json(settings);
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = saveSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Некорректные папки." },
      { status: 400 },
    );
  }

  const currentSettings = parsed.data.builtIns ? null : await getChatFolderSettings(user.id);
  const settings = await saveChatFolderSettings(user.id, {
    folders: parsed.data.folders,
    builtIns: parsed.data.builtIns ?? currentSettings?.builtIns,
  });
  return NextResponse.json(settings);
}
