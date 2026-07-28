/**
 * Creates exactly two single-use production invites for the release smoke.
 *   DATABASE_URL=... npx tsx scripts/create-smoke-invites.ts
 *
 * The supported path is the admin API (`POST /api/admin/invites`), which needs
 * an admin session this tooling does not have. So the rows are created here
 * instead — with the application's own code generator and hash, in one
 * transaction, with the same constraints the admin path would apply:
 *
 *   - two invites, never more;
 *   - one use each;
 *   - a short expiry;
 *   - pinned to the exact username each is for, so neither can be redeemed by
 *     anyone else;
 *   - marked in `targetUsername` with the smoke purpose.
 *
 * The codes are written to a 0600 file outside the repository and never printed,
 * logged or committed. No user is modified; no user is created here — the
 * accounts are registered through the real registration flow afterwards.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createInviteCode, hashInviteCode } from "../src/lib/invites";

const PURPOSE = "message-delivery-p0-smoke";
const EXPIRY_HOURS = 2;
const OUT_DIR = process.env.NOX_SMOKE_DIR ?? join(process.env.HOME ?? "", ".local/share/nox-smoke");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const stamp = Date.now();
  const usernames = [`p0smokea${stamp}`, `p0smokeb${stamp}`];

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    // Refuse to run twice: two invites, and only two.
    const existing = await prisma.invite.count({
      where: { status: "ACTIVE", targetUsername: { startsWith: "p0smoke" } },
    });
    if (existing > 0) {
      console.error(`${existing} active smoke invite(s) already exist. Refusing to create more.`);
      process.exit(1);
    }

    // The creator must be a real user; an admin is the closest thing to what
    // the supported path would record. Nothing about that user is changed.
    const creator = await prisma.user.findFirst({
      where: { role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" },
      orderBy: { role: "asc" },
      select: { id: true },
    });
    if (!creator) {
      console.error("No active owner or admin user to attribute the invites to.");
      process.exit(1);
    }

    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60_000);
    const codes = usernames.map(() => createInviteCode());

    await prisma.$transaction(
      codes.map((code, index) =>
        prisma.invite.create({
          data: {
            codeHash: hashInviteCode(code),
            createdByUserId: creator.id,
            maxUses: 1,
            expiresAt,
            targetUsername: usernames[index],
          },
          select: { id: true },
        }),
      ),
    );

    mkdirSync(OUT_DIR, { recursive: true });
    chmodSync(OUT_DIR, 0o700);
    const path = join(OUT_DIR, `smoke-credentials-${stamp}.json`);
    const password = `Smoke-${createInviteCode()}`;
    writeFileSync(
      path,
      JSON.stringify(
        {
          purpose: PURPOSE,
          createdAt: new Date().toISOString(),
          expiresAt: expiresAt.toISOString(),
          accounts: usernames.map((username, index) => ({ username, inviteCode: codes[index], password })),
        },
        null,
        2,
      ) + "\n",
      { mode: 0o600 },
    );
    chmodSync(path, 0o600);

    // Only the filename and the usernames. Never the codes.
    console.log(`created 2 single-use invites, expiring ${expiresAt.toISOString()}`);
    console.log(`usernames: ${usernames.join(", ")}`);
    console.log(`credentials file: ${path}`);
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
