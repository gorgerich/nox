import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/admin";
import { logAdminAction } from "@/lib/audit";
import { hashInviteCode } from "@/lib/invites";
import { getPrisma } from "@/lib/prisma";

const createInviteSchema = z.object({
  maxUses: z.coerce.number().int().min(1).max(100),
  expiresAt: z.string().trim().nullable().optional(),
  targetEmail: z.string().trim().toLowerCase().nullable().optional(),
  targetUsername: z.string().trim().toLowerCase().nullable().optional(),
});

function createInviteCode() {
  return randomBytes(18).toString("base64url");
}

function parseOptionalDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date;
}

export async function GET() {
  const { response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const prisma = getPrisma();
  const invites = await prisma.invite.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      status: true,
      usedCount: true,
      maxUses: true,
      expiresAt: true,
      createdAt: true,
      targetEmail: true,
      targetUsername: true,
      createdBy: {
        select: {
          username: true,
          profile: { select: { displayName: true } },
        },
      },
    },
  });

  return NextResponse.json({ invites });
}

export async function POST(request: Request) {
  const { user: admin, response } = await requireAdminUser();

  if (response) {
    return response;
  }

  const body = await request.json().catch(() => null);
  const parsed = createInviteSchema.safeParse(body);

  if (!parsed.success) {
    const hasMaxUsesError = parsed.error.issues.some((issue) => issue.path[0] === "maxUses");

    return NextResponse.json(
      {
        error: hasMaxUsesError
          ? "Количество использований должно быть не меньше 1."
          : "Некорректные данные приглашения.",
      },
      { status: 400 },
    );
  }

  const expiresAt = parseOptionalDate(parsed.data.expiresAt);

  if (expiresAt === undefined) {
    return NextResponse.json({ error: "Некорректная дата окончания приглашения" }, { status: 400 });
  }

  const rawInviteCode = createInviteCode();
  const prisma = getPrisma();
  const invite = await prisma.invite.create({
    data: {
      codeHash: hashInviteCode(rawInviteCode),
      createdByUserId: admin.id,
      maxUses: parsed.data.maxUses,
      expiresAt,
      targetEmail: parsed.data.targetEmail || null,
      targetUsername: parsed.data.targetUsername || null,
      status: "ACTIVE",
    },
    select: {
      id: true,
      status: true,
      usedCount: true,
      maxUses: true,
      expiresAt: true,
      createdAt: true,
      targetEmail: true,
      targetUsername: true,
    },
  });

  await logAdminAction({
    adminUserId: admin.id,
    action: "INVITE_CREATED",
    targetType: "Invite",
    targetId: invite.id,
    metadata: {
      maxUses: invite.maxUses,
      hasExpiresAt: Boolean(invite.expiresAt),
      hasTargetEmail: Boolean(invite.targetEmail),
      hasTargetUsername: Boolean(invite.targetUsername),
    },
  });

  return NextResponse.json({
    invite,
    rawInviteCode,
    notice: "Скопируйте код сейчас. Потом он не будет доступен.",
  }, { status: 201 });
}
