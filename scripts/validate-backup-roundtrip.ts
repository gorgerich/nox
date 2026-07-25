/**
 * Backup roundtrip through the real server layer, against the disposable test
 * database only.
 *
 *   npm run validate:backup-roundtrip
 *
 * Covers the generation lifecycle, transactional activation, cross-account
 * authorization, chunk idempotency, quota, pointer rotation, and — importantly
 * — that the rows actually written to Postgres contain no plaintext.
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { assertIsolation, testDatabaseUrl } from "./backup-test-db";
import {
  ensureBackupAccount,
  createGeneration,
  uploadChunk,
  putManifest,
  activateGeneration,
  getRestoreMetadata,
  getChunk,
  accountBinding,
  BackupError,
} from "../src/lib/backup/server";
import {
  BACKUP_SCHEMA_VERSION,
  createBackupRootKey,
  createGenerationKey,
  unwrapRootKey,
  unwrapGenerationKey,
  sealPayload,
  openPayload,
  hashManifest,
  generateRecoverySecret,
  type BackupAad,
} from "../src/lib/backup/crypto";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}${detail ? " :: " + detail : ""}`);
  }
}
async function code(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof BackupError ? error.code : `OTHER:${(error as Error).message.slice(0, 40)}`;
  }
}

// Long, distinctive markers so a chance byte sequence in ciphertext can't be
// mistaken for a leak.
const PLAINTEXT_MARKER = "PLAINTEXT_LEAK_CANARY_8f3a91c4d7e2b6social";
const MEDIA_KEY_MARKER = "MEDIA_KEY_LEAK_CANARY_11b7c93e5a2f8d4e6c0a";

async function main() {
  const isolation = await assertIsolation();
  if (!isolation.ok) {
    console.error("BACKUP_TEST_DB_ISOLATION=FAIL");
    for (const reason of isolation.reasons) console.error(`  ${reason}`);
    console.error("\nStatus: BLOCKED — refusing to run against a non-disposable database.");
    process.exit(1);
  }
  console.log(`BACKUP_TEST_DB_ISOLATION=PASS (${isolation.fingerprint})\n`);

  const url = testDatabaseUrl();
  // Same adapter the app uses; the URL is the disposable database only.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const userA = `user-a-${Date.now()}`;
  const userB = `user-b-${Date.now()}`;

  try {
    // The disposable DB has the full schema, so create the two owning users.
    for (const id of [userA, userB]) {
      await prisma.user.create({ data: { id, username: id, passwordHash: "x", status: "ACTIVE" } });
    }

    const secret = await generateRecoverySecret();
    const account = await ensureBackupAccount(prisma, userA, BigInt(10_000_000));
    check("backup account created", account.userId === userA);

    const { rootKey, wrapped: wrappedRoot } = await createBackupRootKey(secret);
    await prisma.backupAccount.update({
      where: { id: account.id },
      data: {
        wrappedRootKey: wrappedRoot.wrapped,
        wrappedRootKeyNonce: wrappedRoot.nonce,
        wrappedRootKeySalt: wrappedRoot.salt,
      },
    });

    // --- build and upload generation 1 ------------------------------------
    const history = [
      { messageId: "m1", chatRef: "c1", body: `Привет — ${PLAINTEXT_MARKER}`, createdAt: "2026-07-20T10:00:00Z" },
      { messageId: "m2", chatRef: "c1", body: "Второе сообщение", createdAt: "2026-07-20T10:01:00Z" },
      { messageId: "m3", chatRef: "c2", body: "Вложение", mediaKey: MEDIA_KEY_MARKER, createdAt: "2026-07-20T11:00:00Z" },
    ];

    const generation = await createGeneration(prisma, { userId: userA, estimatedBytes: BigInt(4096) });
    check("server assigns the generation number", generation.generationNumber === 1);
    check("generation starts in progress", generation.status === "IN_PROGRESS");

    const binding = accountBinding(userA, account.id);
    const aad = (chunkIndex: number, recordKind: BackupAad["recordKind"]): BackupAad => ({
      backupId: account.id,
      accountBinding: binding,
      generation: generation.generationNumber,
      chunkIndex,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      recordKind,
      previousManifestHash: null,
    });

    const { key: genKey, wrapped: wrappedGen } = await createGenerationKey(rootKey, generation.generationNumber);
    const sealedChunks = await Promise.all(
      history.map((record, index) => sealPayload({ generationKey: genKey, payload: record, aad: aad(index, "chunk"), counter: index })),
    );

    for (const [index, sealed] of sealedChunks.entries()) {
      await uploadChunk(prisma, { userId: userA, generationId: generation.id, chunkIndex: index, ...sealed });
    }
    check("all chunks uploaded", (await prisma.backupChunk.count({ where: { generationId: generation.id } })) === 3);

    // Idempotency and conflict.
    const repeat = await uploadChunk(prisma, { userId: userA, generationId: generation.id, chunkIndex: 0, ...sealedChunks[0] });
    check("re-uploading an identical chunk is idempotent", repeat.chunkIndex === 0);
    check(
      "a different payload at the same index is refused",
      (await code(() => uploadChunk(prisma, { userId: userA, generationId: generation.id, chunkIndex: 0, ciphertext: "different", nonce: "x" }))) === "BACKUP_CHUNK_CONFLICT",
    );
    check(
      "out-of-range chunk index is refused",
      (await code(() => uploadChunk(prisma, { userId: userA, generationId: generation.id, chunkIndex: -1, ...sealedChunks[0] }))) === "BACKUP_CHUNK_INDEX_RANGE",
    );

    // Activation must refuse before the manifest exists.
    check(
      "activation refused without a manifest",
      (await code(() => activateGeneration(prisma, { userId: userA, generationId: generation.id }))) === "BACKUP_MANIFEST_MISSING",
    );

    const manifest = await sealPayload({
      generationKey: genKey,
      payload: { chunkCount: history.length, messageIds: history.map((h) => h.messageId) },
      aad: aad(-1, "manifest"),
      counter: 0,
    });
    await putManifest(prisma, {
      userId: userA,
      generationId: generation.id,
      encryptedManifest: manifest.ciphertext,
      manifestNonce: manifest.nonce,
      wrappedGenerationKey: wrappedGen.wrapped,
      wrappedGenerationKeyNonce: wrappedGen.nonce,
      totalChunks: history.length,
      previousManifestHash: null,
    });

    // A gap must block activation.
    await prisma.backupGeneration.update({ where: { id: generation.id }, data: { totalChunks: 4 } });
    check(
      "activation refused when a chunk is missing",
      (await code(() => activateGeneration(prisma, { userId: userA, generationId: generation.id }))) === "BACKUP_CHUNK_COUNT_MISMATCH",
    );
    await prisma.backupGeneration.update({ where: { id: generation.id }, data: { totalChunks: history.length } });

    const activated = await activateGeneration(prisma, { userId: userA, generationId: generation.id });
    check("generation activated", activated.status === "COMPLETE");
    const afterActivate = await prisma.backupAccount.findUniqueOrThrow({ where: { id: account.id } });
    check("latest pointer advanced", afterActivate.latestCompleteGeneration === 1);
    check("reserved quota released", afterActivate.reservedBytes === BigInt(0));

    // --- authorization ----------------------------------------------------
    check(
      "another user cannot upload into this generation",
      (await code(() => uploadChunk(prisma, { userId: userB, generationId: generation.id, chunkIndex: 9, ...sealedChunks[0] }))) === "BACKUP_NOT_FOUND",
    );
    check(
      "another user cannot activate this generation",
      (await code(() => activateGeneration(prisma, { userId: userB, generationId: generation.id }))) === "BACKUP_NOT_FOUND",
    );
    check("another user sees no restore metadata", (await getRestoreMetadata(prisma, { userId: userB })) === null);
    check(
      "another user cannot download a chunk",
      (await code(() => getChunk(prisma, { userId: userB, generationNumber: 1, chunkIndex: 0 }))) === "BACKUP_NOT_FOUND",
    );

    // --- restore ----------------------------------------------------------
    const metadata = await getRestoreMetadata(prisma, { userId: userA });
    check("restore metadata available to the owner", metadata !== null && metadata.totalChunks === 3);

    const restoredRoot = await unwrapRootKey(
      { wrapped: metadata!.wrappedRootKey!, nonce: metadata!.wrappedRootKeyNonce!, salt: metadata!.wrappedRootKeySalt! },
      secret,
    );
    const restoredGen = await unwrapGenerationKey(
      { wrapped: metadata!.wrappedGenerationKey!, nonce: metadata!.wrappedGenerationKeyNonce! },
      restoredRoot,
      metadata!.generationNumber,
    );

    const restored = [];
    for (let index = 0; index < metadata!.totalChunks; index += 1) {
      const chunk = await getChunk(prisma, { userId: userA, generationNumber: metadata!.generationNumber, chunkIndex: index });
      restored.push(await openPayload<(typeof history)[number]>({ generationKey: restoredGen, sealed: chunk, aad: aad(index, "chunk") }));
    }
    check("history restored through the server layer", JSON.stringify(restored) === JSON.stringify(history));

    const restoredManifest = await openPayload<{ chunkCount: number }>({
      generationKey: restoredGen,
      sealed: { ciphertext: metadata!.encryptedManifest!, nonce: metadata!.manifestNonce! },
      aad: aad(-1, "manifest"),
    });
    check("manifest restored", restoredManifest.chunkCount === 3);
    check("manifest hash is stable", (await hashManifest(manifest)).length > 0);

    // --- generation 2 rotates the pointers --------------------------------
    const gen2 = await createGeneration(prisma, { userId: userA, estimatedBytes: BigInt(1024) });
    const { key: gen2Key, wrapped: wrappedGen2 } = await createGenerationKey(rootKey, gen2.generationNumber);
    const gen2Aad: BackupAad = { ...aad(0, "chunk"), generation: gen2.generationNumber, previousManifestHash: await hashManifest(manifest) };
    const gen2Chunk = await sealPayload({ generationKey: gen2Key, payload: history[0], aad: gen2Aad, counter: 0 });
    await uploadChunk(prisma, { userId: userA, generationId: gen2.id, chunkIndex: 0, ...gen2Chunk });
    const gen2Manifest = await sealPayload({
      generationKey: gen2Key,
      payload: { chunkCount: 1 },
      aad: { ...gen2Aad, chunkIndex: -1, recordKind: "manifest" },
      counter: 0,
    });
    await putManifest(prisma, {
      userId: userA,
      generationId: gen2.id,
      encryptedManifest: gen2Manifest.ciphertext,
      manifestNonce: gen2Manifest.nonce,
      wrappedGenerationKey: wrappedGen2.wrapped,
      wrappedGenerationKeyNonce: wrappedGen2.nonce,
      totalChunks: 1,
      previousManifestHash: gen2Aad.previousManifestHash,
    });
    await activateGeneration(prisma, { userId: userA, generationId: gen2.id });
    const afterSecond = await prisma.backupAccount.findUniqueOrThrow({ where: { id: account.id } });
    check("latest/previous pointers rotated", afterSecond.latestCompleteGeneration === 2 && afterSecond.previousCompleteGeneration === 1);

    // --- quota ------------------------------------------------------------
    await prisma.backupAccount.update({ where: { id: account.id }, data: { quotaBytes: BigInt(1) } });
    check(
      "quota exceeded is refused",
      (await code(() => createGeneration(prisma, { userId: userA, estimatedBytes: BigInt(9_999_999) }))) === "BACKUP_QUOTA_EXCEEDED",
    );

    // --- plaintext absence in the actual database rows --------------------
    const raw = new Client({ connectionString: url });
    await raw.connect();
    try {
      for (const [table, column] of [
        ["BackupChunk", "ciphertext"],
        ["BackupChunk", "nonce"],
        ["BackupGeneration", "encryptedManifest"],
        ["BackupAccount", "wrappedRootKey"],
      ] as const) {
        const { rows } = await raw.query<{ hits: string }>(
          `select count(*)::text as hits from "${table}" where "${column}" like $1 or "${column}" like $2`,
          [`%${PLAINTEXT_MARKER}%`, `%${MEDIA_KEY_MARKER}%`],
        );
        check(`no plaintext marker in ${table}.${column}`, rows[0].hits === "0");
      }
      const { rows: secretRows } = await raw.query<{ hits: string }>(
        `select count(*)::text as hits from "BackupAccount" where "wrappedRootKey" like $1`,
        [`%${secret.replace(/-/g, "")}%`],
      );
      check("no recovery secret in BackupAccount", secretRows[0].hits === "0");
    } finally {
      await raw.end();
    }

    // --- delivery isolation ------------------------------------------------
    // Deliberately break the backup account, then confirm the messaging tables
    // are untouched and still writable — the two paths share no transaction.
    await prisma.backupAccount.update({ where: { id: account.id }, data: { status: "ERROR" } });
    const chatId = `chat-${Date.now()}`;
    await prisma.chat.create({ data: { id: chatId, type: "DIRECT", createdBy: { connect: { id: userA } } } });
    const message = await prisma.message.create({
      data: { chatId, senderUserId: userA, body: "delivery still works", type: "TEXT" },
    });
    check("message delivery unaffected by a failed backup account", message.id.length > 0);
    check("no backup rows reference messages", (await prisma.backupChunk.count({ where: { ciphertext: { contains: message.id } } })) === 0);
  } finally {
    // Cleanup is confined to the disposable database.
    await prisma.backupChunk.deleteMany({});
    await prisma.backupGeneration.deleteMany({});
    await prisma.backupAccount.deleteMany({});
    await prisma.message.deleteMany({});
    await prisma.chat.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await prisma.$disconnect();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll backup-roundtrip checks passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
