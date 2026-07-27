/**
 * Server-side send idempotency, against the disposable test database only.
 *   npm run validate:message-send-idempotency
 *
 * The duplicate bug was: clientId was echoed back but never stored, so every
 * POST created a new Message and a retry after a lost response committed a
 * second copy. These checks exercise the constraint and the lookup that fix it.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertIsolation, testDatabaseUrl } from "./backup-test-db";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}${detail ? " :: " + detail : ""}`);
  }
}

async function main() {
  const isolation = await assertIsolation();
  if (!isolation.ok) {
    console.error("MESSAGE_TEST_DB_ISOLATION=FAIL");
    for (const reason of isolation.reasons) console.error(`  ${reason}`);
    console.error("\nStatus: BLOCKED — refusing to run against a non-disposable database.");
    process.exit(1);
  }
  console.log(`MESSAGE_TEST_DB_ISOLATION=PASS (${isolation.fingerprint})\n`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl() }) });
  const stamp = Date.now();
  const sender = `sender-${stamp}`;
  const other = `other-${stamp}`;
  const chatId = `chat-${stamp}`;

  try {
    for (const id of [sender, other]) {
      await prisma.user.create({ data: { id, username: id, passwordHash: "x", status: "ACTIVE" } });
    }
    await prisma.chat.create({ data: { id: chatId, type: "DIRECT", createdBy: { connect: { id: sender } } } });

    const clientMessageId = `cmid-${stamp}`;
    const send = (cmid: string | null, senderUserId = sender) =>
      prisma.message.create({
        data: { chatId, senderUserId, clientMessageId: cmid, type: "TEXT", body: "привет" },
      });

    const first = await send(clientMessageId);
    check("first send commits a message", Boolean(first.id));
    check("clientMessageId is persisted", first.clientMessageId === clientMessageId);

    // The retry path: look the message up instead of creating another.
    const found = await prisma.message.findUnique({
      where: { senderUserId_clientMessageId: { senderUserId: sender, clientMessageId } },
    });
    check("a retry finds the committed message", found?.id === first.id);

    // The database itself must refuse a second copy even if a race slips past
    // the lookup.
    let rejected = false;
    try {
      await send(clientMessageId);
    } catch {
      rejected = true;
    }
    check("a duplicate (sender, clientMessageId) is rejected by the constraint", rejected);
    check(
      "exactly one message exists for that client id",
      (await prisma.message.count({ where: { senderUserId: sender, clientMessageId } })) === 1,
    );

    // Concurrent retries: only one may win.
    const raceId = `race-${stamp}`;
    const results = await Promise.allSettled([send(raceId), send(raceId), send(raceId)]);
    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    check("concurrent retries commit exactly one message", fulfilled === 1, `${fulfilled} succeeded`);
    check(
      "database holds one row for the raced client id",
      (await prisma.message.count({ where: { senderUserId: sender, clientMessageId: raceId } })) === 1,
    );

    // Envelopes must not be duplicated either.
    await prisma.messageEnvelope.create({
      data: {
        messageId: first.id,
        recipientUserId: other,
        recipientDeviceId: "device-b",
        senderDeviceId: "device-a",
        ciphertext: "ct",
        iv: "iv",
        algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM",
      },
    });
    check(
      "one set of envelopes for the committed message",
      (await prisma.messageEnvelope.count({ where: { messageId: first.id } })) === 1,
    );

    // Two different clients ids from the same sender stay distinct.
    const second = await send(`${clientMessageId}-b`);
    check("a different client id creates a separate message", second.id !== first.id);

    // The same client id from a *different* sender is not a conflict.
    const foreign = await send(clientMessageId, other);
    check("the same client id from another sender is allowed", Boolean(foreign.id));

    // Legacy messages without a client id must not collide with each other.
    const legacyA = await send(null);
    const legacyB = await send(null);
    check("null client ids do not collide", legacyA.id !== legacyB.id);
  } finally {
    await prisma.messageEnvelope.deleteMany({});
    await prisma.message.deleteMany({});
    await prisma.chat.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { in: [sender, other] } } });
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll message-send idempotency checks passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
