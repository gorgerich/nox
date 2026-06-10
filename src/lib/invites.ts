import { createHash } from "crypto";
import { randomBytes } from "crypto";
import { getPrisma } from "@/lib/prisma";

export function createInviteCode() {
  return randomBytes(18).toString("base64url");
}

export function hashInviteCode(code: string) {
  return createHash("sha256")
    .update(code.trim(), "utf8")
    .digest("hex");
}

export async function validateInvite(input: {
  inviteCode: string;
  email?: string | null;
  username: string;
}) {
  const prisma = getPrisma();
  const codeHash = hashInviteCode(input.inviteCode);
  const email = input.email?.trim().toLowerCase() ?? "";
  const username = input.username.trim().toLowerCase();

  const invite = await prisma.invite.findUnique({
    where: { codeHash },
  });

  if (!invite || invite.status !== "ACTIVE") {
    return { ok: false as const, reason: "Приглашение недействительно." };
  }

  if (invite.expiresAt && invite.expiresAt <= new Date()) {
    return { ok: false as const, reason: "Срок действия приглашения истёк." };
  }

  if (invite.usedCount >= invite.maxUses) {
    return { ok: false as const, reason: "Приглашение уже использовано." };
  }

  if (invite.targetEmail && invite.targetEmail.toLowerCase() !== email) {
    return { ok: false as const, reason: "Приглашение не подходит для этой электронной почты." };
  }

  if (invite.targetUsername && invite.targetUsername.toLowerCase() !== username) {
    return { ok: false as const, reason: "Приглашение не подходит для этого имени пользователя." };
  }

  return { ok: true as const, invite };
}
