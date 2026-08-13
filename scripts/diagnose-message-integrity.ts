/**
 * Read-only census of the message table, for the states users report as
 * "stuck loading", "photos never appear" and "a duplicate after sending".
 *
 *   railway run --service nox --environment production -- npx tsx scripts/diagnose-message-integrity.ts
 *
 * Strictly read-only: counts and aggregates only. It never writes, and it
 * never selects a message body, a client id, a ciphertext, a device id or a
 * username — the questions it asks are all answerable from shapes and dates.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Run this through `railway run`, which injects it.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** Prints a month-by-month spread so a defect can be tied to a release. */
function byMonth(rows: { createdAt: Date }[]): string {
  const buckets = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.createdAt.getUTCFullYear()}-${String(row.createdAt.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].sort().map(([k, v]) => `${k}:${v}`).join("  ") || "—";
}

async function main() {
  const total = await prisma.message.count();
  const live = await prisma.message.count({ where: { deletedAt: null } });
  console.log(`\nmessages: ${total} total, ${live} not deleted\n`);

  // --- 1. The empty bubble --------------------------------------------------
  // No body, no attachment, not encrypted: nothing to render and nothing still
  // to arrive. This is what appears beside a caption as a phantom duplicate.
  const empty = await prisma.message.findMany({
    where: { deletedAt: null, isEncrypted: false, body: null, attachments: { none: {} } },
    select: { createdAt: true, type: true },
  });
  console.log(`empty messages (no body, no attachment, not encrypted): ${empty.length}`);
  if (empty.length > 0) {
    const types = new Map<string, number>();
    for (const row of empty) types.set(row.type, (types.get(row.type) ?? 0) + 1);
    console.log(`  by type   ${[...types.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`);
    console.log(`  by month  ${byMonth(empty)}`);
  }

  // --- 2. Media messages with no media --------------------------------------
  // A row typed as media whose attachment never attached: the upload failed
  // after the message was committed, or the two were never in one transaction.
  const mediaTypes = ["IMAGE", "VIDEO", "FILE", "VOICE", "VIDEO_NOTE"] as const;
  const medialess = await prisma.message.findMany({
    where: { deletedAt: null, type: { in: [...mediaTypes] }, attachments: { none: {} } },
    select: { createdAt: true, type: true, isEncrypted: true },
  });
  console.log(`\nmedia-typed messages with no attachment row: ${medialess.length}`);
  if (medialess.length > 0) {
    const types = new Map<string, number>();
    for (const row of medialess) types.set(`${row.type}${row.isEncrypted ? "/e2ee" : ""}`, (types.get(`${row.type}${row.isEncrypted ? "/e2ee" : ""}`) ?? 0) + 1);
    console.log(`  by type   ${[...types.entries()].map(([k, v]) => `${k}:${v}`).join("  ")}`);
    console.log(`  by month  ${byMonth(medialess)}`);
  }

  // --- 3. Encrypted messages nobody can open --------------------------------
  // No envelope at all means no recipient device can read it — distinct from
  // "not addressed to my device", which is expected for history predating a
  // device and is counted separately below.
  const noEnvelopes = await prisma.message.findMany({
    where: { deletedAt: null, isEncrypted: true, envelopes: { none: {} } },
    select: { createdAt: true, type: true },
  });
  console.log(`\nencrypted messages with zero envelopes: ${noEnvelopes.length}`);
  if (noEnvelopes.length > 0) {
    console.log(`  by month  ${byMonth(noEnvelopes)}`);
  }

  // --- 4. Attachments that cannot be decrypted anywhere ----------------------
  const attachmentsTotal = await prisma.attachment.count();
  const encryptedAttachments = await prisma.attachment.count({ where: { isEncrypted: true } });
  const attachmentsNoKey = await prisma.attachment.count({
    where: { isEncrypted: true, mediaKeyEnvelopes: { none: {} } },
  });
  console.log(`\nattachments: ${attachmentsTotal} total, ${encryptedAttachments} encrypted`);
  console.log(`  encrypted with no media-key envelope: ${attachmentsNoKey}`);

  // --- 5. Devices, and how much history predates them -----------------------
  // Expected, not a defect: a device cannot read what was sealed before it
  // existed. Counted so the "unavailable on this device" bubbles have a size.
  // `Device` is the push-token registry and is unrelated to encryption; the
  // keys live in `DeviceKeyBundle`, keyed to a `UserDevice`. Counting the wrong
  // one reports zero devices next to messages that plainly have envelopes.
  const pushDevices = await prisma.device.count();
  const keyBundles = await prisma.deviceKeyBundle.count();
  const liveBundles = await prisma.deviceKeyBundle.count({ where: { revokedAt: null } });
  const userDevices = await prisma.userDevice.count();
  console.log(`\npush-token devices: ${pushDevices}`);
  console.log(`user devices: ${userDevices}`);
  console.log(`E2EE key bundles: ${keyBundles} total, ${liveBundles} not revoked`);

  const bundlesPerUser = await prisma.deviceKeyBundle.groupBy({
    by: ["userId"],
    where: { revokedAt: null },
    _count: { _all: true },
  });
  const spread = new Map<number, number>();
  for (const row of bundlesPerUser) spread.set(row._count._all, (spread.get(row._count._all) ?? 0) + 1);
  console.log(`  devices per user  ${[...spread.entries()].sort().map(([k, v]) => `${k}dev:${v}users`).join("  ") || "—"}`);

  const encryptedLive = await prisma.message.count({ where: { deletedAt: null, isEncrypted: true } });
  console.log(`encrypted messages (not deleted): ${encryptedLive}`);

  // --- 6. Delivery bookkeeping ----------------------------------------------
  // A message with no receipt row for anyone but its sender never reported
  // delivery — which is what a client shows as permanently "sending".
  const noReceipts = await prisma.message.count({
    where: { deletedAt: null, receipts: { none: {} } },
  });
  console.log(`\nmessages with no receipt rows at all: ${noReceipts}`);

  const undelivered = await prisma.message.findMany({
    where: { deletedAt: null, receipts: { some: {}, every: { deliveredAt: null } } },
    select: { createdAt: true },
  });
  console.log(`messages whose every receipt is undelivered: ${undelivered.length}`);
  if (undelivered.length > 0) console.log(`  by month  ${byMonth(undelivered)}`);

  console.log("");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
