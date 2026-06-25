import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getChatFolders, saveChatFolders } from "@/lib/chat-folders";

const folderSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(1).max(28),
  chatIds: z.array(z.string().min(1)).max(200),
  createdAt: z.string().min(1),
});

const saveSchema = z.object({
  folders: z.array(folderSchema).max(12),
});

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  return NextResponse.json({ folders: await getChatFolders(user.id) });
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

  const folders = await saveChatFolders(user.id, parsed.data.folders);
  return NextResponse.json({ folders });
}
