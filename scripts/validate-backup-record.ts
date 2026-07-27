/**
 * Checks the backup record serializer and validator:
 * expired dropped, deleted reduced to a tombstone, forbidden data never
 * serialised, untrusted JSON rejected, restore policy re-applied, dedup.
 *   npm run validate:backup-record
 */
import {
  serializeToBackupRecords,
  validateBackupRecord,
  validateRecordBatch,
  applyRestorePolicy,
  deduplicateRecords,
  FORBIDDEN_KEYS,
  BACKUP_RECORD_VERSION,
  MAX_BODY_CHARS,
  type DecryptedLocalMessage,
} from "../src/lib/backup/record";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const now = Date.parse("2026-07-26T12:00:00Z");
const msg = (over: Partial<DecryptedLocalMessage> & { messageId: string }): DecryptedLocalMessage => ({
  chatId: "c1",
  senderId: "u1",
  createdAt: "2026-07-26T10:00:00Z",
  type: "TEXT",
  body: "hello",
  ...over,
});

// --- serialization ----------------------------------------------------------
const input: DecryptedLocalMessage[] = [
  msg({ messageId: "m1", body: "обычное сообщение" }),
  msg({ messageId: "m2", body: "истекло", expiresAt: "2026-07-26T09:00:00Z" }),
  msg({ messageId: "m3", body: "секрет удалён", deletedAt: "2026-07-26T11:00:00Z", reactions: [{ emoji: "🔥", userId: "u2" }] }),
  msg({ messageId: "m4", body: "с реакцией", reactions: [{ emoji: "👍", userId: "u2" }] }),
  msg({ messageId: "m5", chatId: null, body: "no chat" }),
  msg({ messageId: "m6", type: "WEIRD_TYPE", body: "unknown type collapses to TEXT" }),
];
const records = serializeToBackupRecords(input, now);

check("expired message is dropped", !records.some((r) => r.messageId === "m2"));
check("message with no conversation is dropped", !records.some((r) => r.messageId === "m5"));
const tombstone = records.find((r) => r.messageId === "m3");
check("deleted message keeps only a tombstone", Boolean(tombstone) && tombstone!.body === null && tombstone!.reactions.length === 0);
check("normal message keeps its body", records.find((r) => r.messageId === "m1")?.body === "обычное сообщение");
check("reactions preserved on live messages", records.find((r) => r.messageId === "m4")?.reactions.length === 1);
check("unknown message type collapses to TEXT", records.find((r) => r.messageId === "m6")?.type === "TEXT");

// --- forbidden data never appears -------------------------------------------
const serialized = JSON.stringify(records);
for (const key of FORBIDDEN_KEYS) {
  check(`serialized records contain no "${key}"`, !serialized.includes(`"${key}"`));
}
// even if a forbidden field is present on the input, it is not carried through
const dirty = serializeToBackupRecords(
  [{ ...msg({ messageId: "m7" }), privateKey: "SHOULD_NOT_LEAK", token: "SECRET" } as unknown as DecryptedLocalMessage],
  now,
);
check("input-level secret fields are not carried into records", !JSON.stringify(dirty).includes("SHOULD_NOT_LEAK") && !JSON.stringify(dirty).includes("SECRET"));

// --- validation of untrusted JSON -------------------------------------------
check("valid record passes", validateBackupRecord(records[0]).ok);
check("non-object rejected", !validateBackupRecord("nope" as unknown).ok);
check("wrong version rejected", !validateBackupRecord({ ...records[0], v: 99 }).ok);
check("missing id rejected", !validateBackupRecord({ ...records[0], messageId: undefined }).ok);
check("invalid timestamp rejected", !validateBackupRecord({ ...records[0], createdAt: "not-a-date" }).ok);
check("disallowed type rejected", !validateBackupRecord({ ...records[0], type: "EXE" }).ok);
check("oversized body rejected", !validateBackupRecord({ ...records[0], body: "x".repeat(MAX_BODY_CHARS + 1) }).ok);
check("malformed reaction rejected", !validateBackupRecord({ ...records[0], reactions: [{ emoji: 1 }] }).ok);
check("malformed attachment rejected", !validateBackupRecord({ ...records[0], attachments: [{ attachmentId: 1 }] }).ok);

// --- batch, restore policy, dedup -------------------------------------------
check("batch of valid records passes", validateRecordBatch(records).ok);
check("batch with one bad record fails", !validateRecordBatch([records[0], { v: BACKUP_RECORD_VERSION }]).ok);

const stale = [
  { ...records[0], messageId: "s1", expiresAt: "2026-07-26T09:00:00Z" },
  { ...records[0], messageId: "s2", deletedAt: "2026-07-26T11:00:00Z", body: "should be stripped" },
  { ...records[0], messageId: "s3" },
];
const afterPolicy = applyRestorePolicy(stale, now);
check("restore policy drops newly-expired records", !afterPolicy.some((r) => r.messageId === "s1"));
check("restore policy strips resurrected deleted content", afterPolicy.find((r) => r.messageId === "s2")?.body === null);
check("restore policy keeps live records", afterPolicy.some((r) => r.messageId === "s3"));

const dupes = [records[0], { ...records[0] }, { ...records[0], messageId: "unique" }];
check("duplicate restore does not double a message", deduplicateRecords(dupes).length === 2);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll backup-record checks passed.");
