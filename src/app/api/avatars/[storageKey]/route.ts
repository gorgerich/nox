import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getObject } from "@/lib/storage";

export async function GET(
  request: Request,
  context: { params: Promise<{ storageKey: string }> },
) {
  const { storageKey } = await context.params;

  const object = await getObject(storageKey);

  if (!object) {
    return NextResponse.json({ error: "Аватар не найден." }, { status: 404 });
  }

  return new Response(Readable.toWeb(object.stream) as BodyInit, {
    headers: {
      "Content-Type": "image/jpeg", // Fallback, browser will detect correct type
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
