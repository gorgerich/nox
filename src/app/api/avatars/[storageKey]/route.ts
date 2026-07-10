import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getObject, getStoredImageMimeType } from "@/lib/storage";

export async function GET(
  request: Request,
  context: { params: Promise<{ storageKey: string }> },
) {
  const { storageKey } = await context.params;

  const object = await getObject(storageKey);

  if (!object) {
    return NextResponse.json({ error: "Аватар не найден." }, { status: 404 });
  }

  const mimeType = await getStoredImageMimeType(object.path).catch(() => null);
  if (!mimeType) {
    object.stream.destroy();
    return NextResponse.json({ error: "Некорректный формат аватара." }, { status: 415 });
  }

  return new Response(Readable.toWeb(object.stream) as BodyInit, {
    headers: {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
