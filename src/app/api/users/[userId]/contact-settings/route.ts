import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

const patchSchema = z.object({
  nickname: z.string().max(50).optional().nullable(),
  isBlocked: z.boolean().optional(),
  mutedUntil: z.string().datetime().optional().nullable(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: targetUserId } = await context.params;
  const prisma = getPrisma();

  const [settings, membership] = await Promise.all([
    prisma.contactSettings.findUnique({
      where: {
        ownerId_targetUserId: {
          ownerId: user.id,
          targetUserId,
        },
      },
    }),
    prisma.chatMember.findFirst({
      where: {
        userId: user.id,
        chat: {
          type: "DIRECT",
          members: { some: { userId: targetUserId } }
        }
      }
    })
  ]);

  return NextResponse.json({
    nickname: settings?.nickname || null,
    isBlocked: settings?.isBlocked || false,
    mutedUntil: membership?.mutedUntil || null,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { userId: targetUserId } = await context.params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const { nickname, isBlocked, mutedUntil } = parsed.data;
  const prisma = getPrisma();

  // Update ContactSettings (Nickname, Block)
  if (nickname !== undefined || isBlocked !== undefined) {
    await prisma.contactSettings.upsert({
      where: {
        ownerId_targetUserId: {
          ownerId: user.id,
          targetUserId,
        },
      },
      create: {
        ownerId: user.id,
        targetUserId,
        nickname,
        isBlocked: isBlocked || false,
      },
      update: {
        nickname,
        isBlocked,
      },
    });
  }

  // Update Mute status in ChatMember for the direct chat
  if (mutedUntil !== undefined) {
    const directChat = await prisma.chat.findFirst({
      where: {
        type: "DIRECT",
        members: {
          every: { userId: { in: [user.id, targetUserId] } }
        }
      }
    });

    if (directChat) {
      await prisma.chatMember.update({
        where: {
          chatId_userId: {
            chatId: directChat.id,
            userId: user.id,
          }
        },
        data: { mutedUntil: mutedUntil ? new Date(mutedUntil) : null }
      });
    }
  }

  return NextResponse.json({ success: true });
}
