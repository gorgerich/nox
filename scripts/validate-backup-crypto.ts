/**
 * Proves the backup crypto domain does what Phase C claims:
 * history sealed before a wipe can be reopened afterwards with only the
 * recovery secret, and nothing the server holds is enough on its own.
 *
 *   npm run validate:backup-crypto
 */
import {
  BACKUP_SCHEMA_VERSION,
  buildNonce,
  serializeAad,
  generateRecoverySecret,
  isRecoverySecretWellFormed,
  createBackupRootKey,
  unwrapRootKey,
  createGenerationKey,
  unwrapGenerationKey,
  sealPayload,
  openPayload,
  hashManifest,
  toBase64,
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
async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

const BACKUP_ID = "backup-1";
const ACCOUNT = "acct-binding-opaque";

const aadFor = (generation: number, chunkIndex: number, recordKind: BackupAad["recordKind"], prev: string | null = null): BackupAad => ({
  backupId: BACKUP_ID,
  accountBinding: ACCOUNT,
  generation,
  chunkIndex,
  schemaVersion: BACKUP_SCHEMA_VERSION,
  recordKind,
  previousManifestHash: prev,
});

const HISTORY = [
  { messageId: "m1", chatRef: "c1", body: "Привет! Как дела с поездкой?", createdAt: "2026-07-20T10:00:00Z" },
  { messageId: "m2", chatRef: "c1", body: "Билеты уже посмотрела", createdAt: "2026-07-20T10:01:00Z" },
  { messageId: "m3", chatRef: "c2", body: "Договор во вложении", createdAt: "2026-07-20T11:00:00Z" },
];

async function main() {
  // --- recovery secret ------------------------------------------------------
  const secret = await generateRecoverySecret();
  check("recovery secret is well formed", await isRecoverySecretWellFormed(secret), secret.slice(0, 11) + "…");
  check("a mistyped secret is rejected", !(await isRecoverySecretWellFormed(secret.replace(/.$/, "Z"))));
  check("random text is rejected", !(await isRecoverySecretWellFormed("not-a-real-secret")));

  // --- nonce construction ---------------------------------------------------
  const n1 = toBase64(buildNonce({ generation: 1, recordKind: "chunk", counter: 0 }));
  const n2 = toBase64(buildNonce({ generation: 1, recordKind: "chunk", counter: 1 }));
  const n3 = toBase64(buildNonce({ generation: 2, recordKind: "chunk", counter: 0 }));
  const n4 = toBase64(buildNonce({ generation: 1, recordKind: "manifest", counter: 0 }));
  check("nonce is 96-bit", buildNonce({ generation: 1, recordKind: "chunk", counter: 0 }).length === 12);
  check("counter separates nonces", n1 !== n2);
  check("generation separates nonces", n1 !== n3);
  check("record kind separates manifest from chunk", n1 !== n4);

  const seen = new Set<string>();
  for (let g = 1; g <= 20; g += 1) {
    for (let c = 0; c < 200; c += 1) seen.add(toBase64(buildNonce({ generation: g, recordKind: "chunk", counter: c })));
  }
  check("4000 nonces across 20 generations are unique", seen.size === 4000, `${seen.size}/4000`);

  // --- AAD ------------------------------------------------------------------
  const aadA = serializeAad(aadFor(1, 0, "chunk"));
  const aadB = serializeAad(aadFor(1, 1, "chunk"));
  check("AAD binds chunk index", toBase64(aadA) !== toBase64(aadB));

  // === the actual scenario ==================================================
  // 1. Device A seals history under a fresh key hierarchy.
  const { rootKey, wrapped: wrappedRoot } = await createBackupRootKey(secret);
  const generation = 1;
  const { key: genKey, wrapped: wrappedGen } = await createGenerationKey(rootKey, generation);

  const chunks = await Promise.all(
    HISTORY.map((record, index) =>
      sealPayload({ generationKey: genKey, payload: record, aad: aadFor(generation, index, "chunk"), counter: index }),
    ),
  );
  const manifest = await sealPayload({
    generationKey: genKey,
    payload: { chunkCount: chunks.length, messageIds: HISTORY.map((h) => h.messageId) },
    aad: aadFor(generation, -1, "manifest"),
    counter: 0,
  });

  // What the server is allowed to hold.
  const serverState = {
    wrappedRoot,
    wrappedGen,
    manifest,
    chunks,
    previousManifestHash: await hashManifest(manifest),
  };
  const serverBlob = JSON.stringify(serverState);
  for (const record of HISTORY) {
    check(`server blob does not contain plaintext of ${record.messageId}`, !serverBlob.includes(record.body));
  }
  check("server blob does not contain the recovery secret", !serverBlob.includes(secret.replace(/-/g, "")));

  // 2. Wipe: every local key is dropped. Only `secret` survives, in the user's head.
  //    (Simulated by deriving everything again from scratch below.)

  // 3. Restore on a brand-new install.
  const restoredRoot = await unwrapRootKey(serverState.wrappedRoot, secret);
  const restoredGen = await unwrapGenerationKey(serverState.wrappedGen, restoredRoot, generation);
  const restored = await Promise.all(
    serverState.chunks.map((sealed, index) =>
      openPayload<(typeof HISTORY)[number]>({ generationKey: restoredGen, sealed, aad: aadFor(generation, index, "chunk") }),
    ),
  );
  check(
    "history survives a full local wipe and restores intact",
    JSON.stringify(restored) === JSON.stringify(HISTORY),
  );

  const restoredManifest = await openPayload<{ chunkCount: number }>({
    generationKey: restoredGen,
    sealed: serverState.manifest,
    aad: aadFor(generation, -1, "manifest"),
  });
  check("manifest restores", restoredManifest.chunkCount === HISTORY.length);

  // --- the server alone must not be enough ----------------------------------
  const wrongSecret = await generateRecoverySecret();
  check("a wrong recovery secret cannot unwrap the root key", await throws(() => unwrapRootKey(serverState.wrappedRoot, wrongSecret)));

  // --- tampering ------------------------------------------------------------
  const tamperedChunk = { ...serverState.chunks[0] };
  const raw = Array.from(atob(tamperedChunk.ciphertext), (ch) => ch.charCodeAt(0));
  raw[0] ^= 0xff;
  tamperedChunk.ciphertext = btoa(String.fromCharCode(...raw));
  check(
    "a tampered chunk is rejected",
    await throws(() => openPayload({ generationKey: restoredGen, sealed: tamperedChunk, aad: aadFor(generation, 0, "chunk") })),
  );

  check(
    "a chunk replayed at another index is rejected",
    await throws(() => openPayload({ generationKey: restoredGen, sealed: serverState.chunks[0], aad: aadFor(generation, 5, "chunk") })),
  );
  check(
    "a chunk replayed into another generation is rejected",
    await throws(() => openPayload({ generationKey: restoredGen, sealed: serverState.chunks[0], aad: aadFor(2, 0, "chunk") })),
  );
  check(
    "a chunk replayed into another account is rejected",
    await throws(() =>
      openPayload({
        generationKey: restoredGen,
        sealed: serverState.chunks[0],
        aad: { ...aadFor(generation, 0, "chunk"), accountBinding: "someone-else" },
      }),
    ),
  );
  check(
    "a chunk cannot be opened as a manifest",
    await throws(() => openPayload({ generationKey: restoredGen, sealed: serverState.chunks[0], aad: aadFor(generation, 0, "manifest") })),
  );

  // --- generations are independent -----------------------------------------
  const { key: gen2Key } = await createGenerationKey(restoredRoot, 2);
  check(
    "one generation's key cannot open another's chunks",
    await throws(() => openPayload({ generationKey: gen2Key, sealed: serverState.chunks[0], aad: aadFor(generation, 0, "chunk") })),
  );

  // --- rotating the recovery secret -----------------------------------------
  const { wrapRootKey } = await import("../src/lib/backup/crypto");
  const rotatedSecret = await generateRecoverySecret();
  const rewrapped = await wrapRootKey(restoredRoot, rotatedSecret);
  const afterRotation = await unwrapRootKey(rewrapped, rotatedSecret);
  const stillReadable = await openPayload<(typeof HISTORY)[number]>({
    generationKey: await unwrapGenerationKey(serverState.wrappedGen, afterRotation, generation),
    sealed: serverState.chunks[0],
    aad: aadFor(generation, 0, "chunk"),
  });
  check("rotating the recovery secret keeps history readable", stillReadable.messageId === "m1");
  check("the old secret no longer unwraps the rotated root key", await throws(() => unwrapRootKey(rewrapped, secret)));

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll backup-crypto checks passed.");
}

void main();
