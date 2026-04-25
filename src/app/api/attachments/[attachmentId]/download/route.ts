import { createReadStream } from "fs";
import { Readable } from "stream";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getObject } from "@/lib/storage";

function getContentDisposition(mimeType: string, fileName: string) {
  const safeName = fileName.replace(/["\r\n]/g, "_");
  const encodedName = encodeURIComponent(fileName);
  const disposition =
    mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("audio/")
      ? "inline"
      : "attachment";

  return `${disposition}; filename="${safeName}"; filename*=UTF-8''${encodedName}`;
}

export async function GET(
  request: Request,
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

  const rangeHeader = request.headers.get("range");
  const baseHeaders = {
    "Accept-Ranges": "bytes",
    "Content-Disposition": getContentDisposition(attachment.mimeType, attachment.fileName),
    "Content-Type": attachment.mimeType,
    "X-Content-Type-Options": "nosniff",
  };

  if (!rangeHeader) {
    return new Response(Readable.toWeb(object.stream) as BodyInit, {
      headers: {
        ...baseHeaders,
        "Content-Length": String(object.sizeBytes),
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());

  if (!match) {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${object.sizeBytes}`,
      },
    });
  }

  const [, startText, endText] = match;
  const parsedStart = startText ? Number.parseInt(startText, 10) : Number.NaN;
  const parsedEnd = endText ? Number.parseInt(endText, 10) : Number.NaN;

  let start = Number.isFinite(parsedStart) ? parsedStart : 0;
  let end = Number.isFinite(parsedEnd) ? parsedEnd : object.sizeBytes - 1;

  if (!startText && Number.isFinite(parsedEnd)) {
    start = Math.max(object.sizeBytes - parsedEnd, 0);
    end = object.sizeBytes - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= object.sizeBytes) {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${object.sizeBytes}`,
      },
    });
  }

  end = Math.min(end, object.sizeBytes - 1);
  const chunkSize = end - start + 1;
  const rangeStream = createReadStream(object.path, { start, end });

  return new Response(Readable.toWeb(rangeStream) as BodyInit, {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(chunkSize),
      "Content-Range": `bytes ${start}-${end}/${object.sizeBytes}`,
    },
  });
}
