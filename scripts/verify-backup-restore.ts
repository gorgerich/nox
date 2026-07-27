/**
 * Proves a production dump can actually be restored.
 *   DATABASE_URL=... npm run verify:backup-restore -- <path-to-dump>
 *
 * An unrestored dump is a file, not a backup. This restores it into a
 * disposable database and checks that what comes back is the schema and the
 * data that went in: tables, row counts, constraints, foreign keys, unique
 * indexes, sequences, no orphans, and a read-only application query.
 *
 * It writes a small evidence file — sizes, checksums, counts, fingerprints —
 * which is what the release gate reads. No message content, no client ids, no
 * credentials are read, printed or stored.
 *
 * Restoring is destructive *to the restore target*, so the target must first
 * prove it is disposable. Without that proof this exits BLOCKED.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, basename } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const PG_BIN = process.env.PG_BIN ?? "/usr/local/Cellar/postgresql@18/18.4/bin";
const RESTORE_DB = process.env.RESTORE_TEST_DB ?? "nox_release_restore_test";
const RESTORE_HOST = process.env.RESTORE_TEST_HOST ?? "127.0.0.1";
const RESTORE_PORT = process.env.RESTORE_TEST_PORT ?? "5432";
const RESTORE_USER = process.env.RESTORE_TEST_USER ?? process.env.USER ?? "postgres";
const EVIDENCE_PATH = join(process.cwd(), "docs/releases/backup-restore-evidence.json");
const PRODUCTION_SERVICE_ID = "2e1fc8de-1001-4962-abe7-657df44987e7";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}${detail ? " :: " + detail : ""}`);
  }
}

function bin(name: string): string {
  const candidate = join(PG_BIN, name);
  return existsSync(candidate) ? candidate : name;
}

function restoreUrl(database = RESTORE_DB): string {
  return `postgresql://${RESTORE_USER}@${RESTORE_HOST}:${RESTORE_PORT}/${database}`;
}

function psql(url: string, sql: string): string {
  return execFileSync(bin("psql"), [url, "-tAc", sql], { encoding: "utf8" }).trim();
}

/**
 * The restore target must be provably disposable before anything is dropped.
 * Getting this wrong once would be catastrophic and unrecoverable, so the
 * checks are conservative and a single failure is terminal.
 */
function assertRestoreIsolation(productionUrl: string): void {
  const reasons: string[] = [];

  const loopback = ["127.0.0.1", "localhost", "::1"].includes(RESTORE_HOST);
  if (!loopback) reasons.push(`restore host ${RESTORE_HOST} is not loopback`);

  if (!/test|disposable|scratch/i.test(RESTORE_DB)) {
    reasons.push(`restore database name "${RESTORE_DB}" carries no test/disposable marker`);
  }

  let productionHost = "";
  let productionDatabase = "";
  try {
    const parsed = new URL(productionUrl);
    productionHost = parsed.hostname;
    productionDatabase = parsed.pathname.replace(/^\//, "");
  } catch {
    reasons.push("production URL could not be parsed");
  }
  if (productionHost && productionHost === RESTORE_HOST && productionDatabase === RESTORE_DB) {
    reasons.push("the restore target and production are the same database");
  }
  if (productionHost && ["127.0.0.1", "localhost", "::1"].includes(productionHost)) {
    reasons.push("production appears to be on loopback — refusing to guess which is which");
  }

  // The restore target must not be the database the app is pointed at.
  if (productionDatabase === RESTORE_DB && productionHost === RESTORE_HOST) {
    reasons.push("the restore target is the configured application database");
  }

  if (reasons.length > 0) {
    console.error("RESTORE_TEST_DB_ISOLATION=FAIL");
    for (const reason of reasons) console.error(`  ${reason}`);
    console.error("\nStatus: BLOCKED — refusing to restore over a database that is not provably disposable.");
    process.exit(1);
  }

  console.log(`RESTORE_TEST_DB_ISOLATION=PASS (${RESTORE_DB}@${RESTORE_HOST}:${RESTORE_PORT})`);
  console.log(`  production service under backup: ${PRODUCTION_SERVICE_ID}`);
  console.log(`  restore target is a different host/database from production\n`);
}

async function tableCounts(url: string): Promise<Record<string, number>> {
  const names = psql(
    url,
    `select table_name from information_schema.tables
      where table_schema='public' and table_type='BASE TABLE' order by table_name`,
  )
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const counts: Record<string, number> = {};
  for (const name of names) {
    counts[name] = Number(psql(url, `select count(*) from "${name}"`));
  }
  return counts;
}

function fingerprint(url: string): string {
  return psql(
    url,
    `select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' order by table_name, column_name))
       from information_schema.columns where table_schema='public'`,
  );
}

async function main() {
  const dumpPath = process.argv[2];
  if (!dumpPath || !existsSync(dumpPath)) {
    console.error("Usage: npm run verify:backup-restore -- <path-to-dump>");
    process.exit(1);
  }
  const productionUrl = process.env.DATABASE_URL;
  if (!productionUrl) {
    console.error("DATABASE_URL is not set — the source evidence cannot be taken.");
    process.exit(1);
  }

  assertRestoreIsolation(productionUrl);

  // --- the artefact --------------------------------------------------------
  const stats = statSync(dumpPath);
  const sha256 = createHash("sha256").update(readFileSync(dumpPath)).digest("hex");
  check("the dump file is not empty", stats.size > 0, `${stats.size} bytes`);
  check("the dump is a plausible size", stats.size > 50_000, `${stats.size} bytes`);
  const mode = (stats.mode & 0o777).toString(8);
  check("the dump is readable only by its owner", mode === "600", `mode ${mode}`);
  check("the dump lives outside the repository", !dumpPath.startsWith(process.cwd()), dirname(dumpPath));

  const toc = execFileSync(bin("pg_restore"), ["--list", dumpPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const tableDataEntries = toc.split("\n").filter((line) => line.includes("TABLE DATA")).length;
  check("the dump contains table data", tableDataEntries > 0, `${tableDataEntries} tables`);

  // --- the source ----------------------------------------------------------
  const sourceFingerprint = fingerprint(productionUrl);
  const sourceVersion = psql(productionUrl, "select current_setting('server_version')");
  const sourceCounts = await tableCounts(productionUrl);
  console.log(`\nsource fingerprint: ${sourceFingerprint}`);
  console.log(`source server: PostgreSQL ${sourceVersion}\n`);

  // --- restore -------------------------------------------------------------
  const adminUrl = restoreUrl("postgres");
  spawnSync(bin("dropdb"), ["--if-exists", "-h", RESTORE_HOST, "-p", RESTORE_PORT, "-U", RESTORE_USER, RESTORE_DB], {
    stdio: "inherit",
  });
  const created = spawnSync(bin("createdb"), ["-h", RESTORE_HOST, "-p", RESTORE_PORT, "-U", RESTORE_USER, RESTORE_DB], {
    stdio: "inherit",
  });
  check("a fresh disposable database was created", created.status === 0);
  void adminUrl;

  const restore = spawnSync(
    bin("pg_restore"),
    [
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "--no-privileges",
      "-h", RESTORE_HOST,
      "-p", RESTORE_PORT,
      "-U", RESTORE_USER,
      "-d", RESTORE_DB,
      dumpPath,
    ],
    { encoding: "utf8" },
  );
  check("pg_restore completed without errors", restore.status === 0, `exit ${restore.status}`);
  if (restore.status !== 0) {
    // The stderr may name objects but never row contents.
    console.error((restore.stderr ?? "").split("\n").slice(0, 20).join("\n"));
  }

  const target = restoreUrl();

  // --- schema parity -------------------------------------------------------
  const restoredFingerprint = fingerprint(target);
  check(
    "the restored schema fingerprint matches production",
    restoredFingerprint === sourceFingerprint,
    restoredFingerprint === sourceFingerprint ? "" : `restored ${restoredFingerprint}`,
  );

  const restoredCounts = await tableCounts(target);
  check(
    "every production table exists in the restore",
    Object.keys(sourceCounts).every((name) => name in restoredCounts),
    Object.keys(sourceCounts).filter((name) => !(name in restoredCounts)).join(","),
  );

  // Production keeps taking writes, so the restore may legitimately hold
  // slightly fewer rows than production does now — but never more, and never
  // fewer than a table that should be non-empty.
  const drift: string[] = [];
  let lost = 0;
  for (const [name, sourceCount] of Object.entries(sourceCounts)) {
    const restored = restoredCounts[name] ?? -1;
    if (restored > sourceCount) drift.push(`${name}: restored ${restored} > source ${sourceCount}`);
    if (restored < sourceCount) drift.push(`${name}: restored ${restored} < source ${sourceCount}`);
    if (sourceCount > 0 && restored === 0) lost += 1;
  }
  check("no table that has rows in production came back empty", lost === 0, `${lost} table(s)`);
  check(
    "row counts are within the drift a live database explains",
    drift.every((entry) => !entry.includes(">")),
    drift.join("; ") || "exact match",
  );
  if (drift.length > 0) console.log(`  note: ${drift.join("; ")}`);

  // --- constraints, indexes, keys ------------------------------------------
  const constraintCount = Number(
    psql(target, `select count(*) from information_schema.table_constraints where table_schema='public'`),
  );
  const sourceConstraintCount = Number(
    psql(productionUrl, `select count(*) from information_schema.table_constraints where table_schema='public'`),
  );
  check("constraints came back", constraintCount === sourceConstraintCount, `${constraintCount} vs ${sourceConstraintCount}`);

  const fkCount = Number(
    psql(target, `select count(*) from information_schema.table_constraints where table_schema='public' and constraint_type='FOREIGN KEY'`),
  );
  const sourceFkCount = Number(
    psql(productionUrl, `select count(*) from information_schema.table_constraints where table_schema='public' and constraint_type='FOREIGN KEY'`),
  );
  check("foreign keys came back", fkCount === sourceFkCount, `${fkCount} vs ${sourceFkCount}`);

  const uniqueCount = Number(psql(target, `select count(*) from pg_index where indisunique and indrelid in (select oid from pg_class where relnamespace='public'::regnamespace)`));
  const sourceUniqueCount = Number(psql(productionUrl, `select count(*) from pg_index where indisunique and indrelid in (select oid from pg_class where relnamespace='public'::regnamespace)`));
  check("unique indexes came back", uniqueCount === sourceUniqueCount, `${uniqueCount} vs ${sourceUniqueCount}`);

  const hasColumn = psql(
    target,
    `select count(*) from information_schema.columns where table_name='Message' and column_name='clientMessageId'`,
  );
  check("Message.clientMessageId survived the round trip", hasColumn === "1");

  const idx = psql(
    target,
    `select indisvalid::text from pg_index where indexrelid = 'public."Message_senderUserId_clientMessageId_key"'::regclass`,
  );
  // `::text` on a boolean renders "true"/"false"; psql's own bool formatting is
  // "t"/"f". Accept either rather than depending on which one this build uses.
  check("the idempotency index survived and is valid", idx === "t" || idx === "true", idx);

  const invalidIndexes = psql(
    target,
    `select count(*) from pg_index where not indisvalid and indrelid in (select oid from pg_class where relnamespace='public'::regnamespace)`,
  );
  check("no index came back invalid", invalidIndexes === "0", invalidIndexes);

  // --- sequences -----------------------------------------------------------
  const badSequences = psql(
    target,
    `select count(*) from pg_sequences where schemaname='public' and last_value is not null and last_value < 0`,
  );
  check("sequences hold sane values", badSequences === "0", badSequences);

  // --- orphans in the relations that matter --------------------------------
  const orphanChecks: { name: string; sql: string }[] = [
    { name: "messages without a chat", sql: `select count(*) from "Message" m left join "Chat" c on c.id = m."chatId" where c.id is null` },
    { name: "messages without a sender", sql: `select count(*) from "Message" m left join "User" u on u.id = m."senderUserId" where u.id is null` },
    { name: "envelopes without a message", sql: `select count(*) from "MessageEnvelope" e left join "Message" m on m.id = e."messageId" where m.id is null` },
    { name: "attachments without a message", sql: `select count(*) from "Attachment" a left join "Message" m on m.id = a."messageId" where m.id is null` },
    { name: "media key envelopes without an attachment", sql: `select count(*) from "MediaKeyEnvelope" k left join "Attachment" a on a.id = k."attachmentId" where a.id is null` },
    { name: "devices without a user", sql: `select count(*) from "UserDevice" d left join "User" u on u.id = d."userId" where u.id is null` },
    { name: "chat members without a chat", sql: `select count(*) from "ChatMember" cm left join "Chat" c on c.id = cm."chatId" where c.id is null` },
  ];
  for (const orphan of orphanChecks) {
    const count = psql(target, orphan.sql);
    check(`no ${orphan.name}`, count === "0", count);
  }

  // --- the application can read it ----------------------------------------
  {
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: target }) });
    try {
      // Read-only: counts and a single relation query, no content selected.
      const users = await prisma.user.count();
      const chats = await prisma.chat.count();
      const withMembers = await prisma.chat.findFirst({ select: { id: true, _count: { select: { members: true } } } });
      check("the application can open the restored database", users >= 0 && chats >= 0, `users=${users} chats=${chats}`);
      check("a relation query works on the restored database", withMembers !== null || chats === 0);
    } catch (error) {
      check("the application can open the restored database", false, error instanceof Error ? error.message : String(error));
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  }

  // --- Prisma's view of the restored schema --------------------------------
  {
    // Prisma 7 dropped `--from-url`; the datasource comes from the config, so
    // the restored database is pointed at through the environment instead.
    const diff = spawnSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-config-datasource", "prisma.config.ts", "--to-schema", "prisma/schema.prisma", "--script"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, DATABASE_URL: target, DIRECT_URL: target } },
    );
    const messageDrift = (diff.stdout ?? "").split("\n").filter((line) => /"Message"|clientMessageId/.test(line));
    check("prisma can diff the restored database", diff.status === 0, (diff.stderr ?? "").split("\n")[2] ?? "");
    check("no Message drift between the schema and the restore", messageDrift.length === 0, messageDrift.slice(0, 2).join(" | "));
  }

  // --- evidence -------------------------------------------------------------
  const evidence = {
    backupType: "postgresql-logical-custom-dump",
    reason: "Railway managed backups are not available on the current plan",
    productionServiceId: PRODUCTION_SERVICE_ID,
    sourceFingerprint,
    sourceServerVersion: sourceVersion,
    dumpFileName: basename(dumpPath),
    // The directory is deliberately not recorded: this file is committed, and a
    // full local path is neither useful to a reader nor something to publish.
    // The gate resolves it from NOX_BACKUP_DIR, defaulting to the same place
    // the backup script writes to.
    dumpDirectoryHint: "NOX_BACKUP_DIR, default ~/.local/share/nox-backups",
    dumpSizeBytes: stats.size,
    dumpSha256: sha256,
    dumpMode: mode,
    dumpCreatedAt: new Date(stats.mtimeMs).toISOString(),
    tableDataEntries,
    restoreTarget: `${RESTORE_DB}@${RESTORE_HOST}:${RESTORE_PORT}`,
    restoreIsolation: "PASS",
    restoreExitCode: restore.status,
    restoredFingerprint,
    sourceCounts,
    restoredCounts,
    constraints: { restored: constraintCount, source: sourceConstraintCount },
    foreignKeys: { restored: fkCount, source: sourceFkCount },
    uniqueIndexes: { restored: uniqueCount, source: sourceUniqueCount },
    verifiedAt: new Date().toISOString(),
    failures,
  };
  mkdirSync(dirname(EVIDENCE_PATH), { recursive: true });
  writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n");
  console.log(`\nevidence written to ${EVIDENCE_PATH.replace(process.cwd() + "/", "")}`);
}

main()
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed. PRODUCTION_BACKUP_VERIFIED must stay NO.`);
      process.exit(1);
    }
    console.log("\nBackup restore verification passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
