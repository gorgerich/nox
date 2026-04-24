import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";

function getContentDisposition(mimeType: string, fileName: string) {
  const safeName = fileName.replace(/["\r\n]/g, "_");
  const encodedName = encodeURIComponent(fileName);
  const disposition = mimeType.startsWith("image/") ? "inline" : "attachment";

  return `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Требуется вход." }, { status: 401 });
  }

  const { attachmentId } = await context.params;
  const prisma = getPrisma();
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      message: {
        include: {
          chat: {
            include: {
              members: {
                where: { userId: user.id },
                select: {
                  status: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const membership = attachment?.message.chat.members[0];

  if (
    !attachment ||
    attachment.message.deletedAt ||
    !membership ||
    membership.status !== "ACTIVE"
  ) {
    return NextResponse.json({ error: "Файл не найден." }, { status: 404 });
  }

  const object = await getObject(attachment.storageKey);

  if (!object) {
    return NextResponse.json({ error: "Файл не найден." }, { status: 404 });
  }

  return new Response(Readable.toWeb(object.stream) as BodyInit, {
    headers: {
      "content-disposition": getContentDisposition(attachment.mimeType, attachment.fileName),
      "content-length": String(object.sizeBytes),
      "content-type": attachment.mimeType,
      "x-content-type-options": "nosniff",
    },
  });
}
