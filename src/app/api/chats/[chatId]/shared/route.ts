import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { requireActiveChatMembership } from "@/lib/chats";

export async function GET(
  request: Request,
  context: { params: Promise<{ chatId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { chatId } = await context.params;
  const membership = await requireActiveChatMembership(chatId, user.id);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const prisma = getPrisma();

  // Get attachments and links
  const messages = await prisma.message.findMany({
    where: { 
      chatId,
      deletedAt: null,
      ...(membership.clearedAt ? { createdAt: { gt: membership.clearedAt } } : {}),
    },
    include: {
      attachments: {
        include: {
          mediaKeyEnvelopes: {
            where: { recipientUserId: user.id },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100, // Limit for MVP
  });

  const photos = [];
  const audio = [];
  const files = [];
  const links = [];

  const urlRegex = /(https?:\/\/[^\s]+)/g;

  for (const msg of messages) {
    // Collect attachments
    for (const att of msg.attachments) {
      if (att.mimeType.startsWith("image/") || att.mimeType.startsWith("video/")) {
        photos.push({
          id: att.id,
          url: `/api/attachments/${att.id}/download`,
          type: att.mimeType.startsWith("image/") ? "IMAGE" : "VIDEO",
          createdAt: att.createdAt,
          mimeType: att.mimeType,
          senderUserId: msg.senderUserId,
          isEncrypted: att.isEncrypted,
          fileIv: att.fileIv,
          fileAlgorithm: att.fileAlgorithm,
          mediaKeyEnvelopes: att.mediaKeyEnvelopes,
        });
      } else if (att.mimeType.startsWith("audio/") || msg.type === "VOICE") {
        audio.push({ id: att.id, url: `/api/attachments/${att.id}/download`, fileName: att.fileName, createdAt: att.createdAt });
      } else {
        files.push({ id: att.id, fileName: att.fileName, size: att.sizeBytes, createdAt: att.createdAt });
      }
    }

    // Extract links from text
    if (msg.body) {
      const foundLinks = msg.body.match(urlRegex);
      if (foundLinks) {
        for (const link of foundLinks) {
          links.push({ url: link, createdAt: msg.createdAt });
        }
      }
    }
  }

  return NextResponse.json({ photos, audio, files, links });
}
