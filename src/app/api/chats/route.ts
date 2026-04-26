import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getChatsPageData } from "@/lib/chat-list";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const data = await getChatsPageData(user.id);
  return NextResponse.json(data);
}
