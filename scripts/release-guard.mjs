/**
 * Gates for MESSAGE DELIVERY P0.
 *   npm run guard:message-delivery-p0     — merge CI gate
 *   npm run guard:production-release      — production release gate
 *
 * Two separate gates, deliberately.
 *
 * The merge gate is what an ordinary pull request has to pass. It runs entirely
 * against the disposable test database and never needs production access —
 * making everyday CI depend on production credentials would be both a security
 * problem and a reliability one.
 *
 * The release gate is the merge gate plus the things that can only be checked
 * against production: a confirmed backup, schema parity, and the column and
 * index the runtime depends on.
 *
 * Every gate is executed, not merely listed. The previous round shipped a
 * schema change that no gate ever ran — see
 * docs/incidents/20260727-message-client-id-production-migration.md.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, statSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const RELEASE_MODE = process.argv.includes("--release");

/**
 * The repository does not lint clean today: 9 errors predate this work
 * (react-hooks/set-state-in-effect in the chat screens and the preview routes,
 * plus deploy-db.js). Measured on the merge base and again with this branch
 * applied — both 9 — so the gate is "introduce none", not "fix the backlog",
 * which would be a different change than the one under review. Lower this
 * number when the backlog is cleared; never raise it.
 */
const LINT_ERROR_BASELINE = 9;

function lintGate() {
  const run = spawnSync("npx", ["eslint", ".", "-f", "json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let errors = 0;
  try {
    for (const file of JSON.parse(run.stdout)) errors += file.errorCount;
  } catch {
    console.error(run.stdout?.slice(0, 2000) ?? "");
    console.error(run.stderr?.slice(0, 2000) ?? "");
    return { ok: false, note: "eslint did not produce parsable output" };
  }
  const ok = errors <= LINT_ERROR_BASELINE;
  console.log(`eslint errors: ${errors} (baseline ${LINT_ERROR_BASELINE})`);
  if (!ok) console.error(`This branch adds ${errors - LINT_ERROR_BASELINE} lint error(s).`);
  return { ok, note: `${errors} errors, baseline ${LINT_ERROR_BASELINE}` };
}

/**
 * A production backup must be verified by one of two mechanisms:
 *
 *   A. a managed Railway backup or snapshot, confirmed by the workspace owner;
 *   B. a logical dump that has actually been restored into a disposable
 *      database and checked against the source.
 *
 * The flag in the document is not sufficient on its own. For B the gate goes
 * back to the artefact: the file must still exist, still match its recorded
 * checksum and size, still be owner-only, and the recorded restore must have
 * succeeded against the schema production has right now. A backup that was
 * verified last week and has since been deleted or altered is not a backup.
 */
function backupGate() {
  const docPath = "docs/releases/message-delivery-p0-production-backup.md";
  let text;
  try {
    text = readFileSync(docPath, "utf8");
  } catch {
    return { ok: false, note: `${docPath} is missing` };
  }
  const flag = /PRODUCTION_BACKUP_VERIFIED\s*=\s*(YES|NO)/.exec(text)?.[1];
  if (!flag) return { ok: false, note: "no PRODUCTION_BACKUP_VERIFIED flag found" };
  console.log(`PRODUCTION_BACKUP_VERIFIED=${flag} (${docPath})`);
  if (flag !== "YES") {
    console.error("A confirmed production backup is a prerequisite for deploying.");
    return { ok: false, note: "flag is NO" };
  }

  // Mechanism A: a managed backup, confirmed by a person. Nothing here can
  // re-check it, so it is accepted on the recorded confirmation alone — and
  // only when the document says that is what happened.
  if (/Backup type \| (Railway )?managed/i.test(text)) {
    console.log("mechanism A: managed Railway backup, confirmed in the evidence document");
    return { ok: true, note: "managed backup" };
  }

  // Mechanism B: verify the artefact, not the claim.
  let evidence;
  try {
    evidence = JSON.parse(readFileSync("docs/releases/backup-restore-evidence.json", "utf8"));
  } catch {
    return { ok: false, note: "backup-restore-evidence.json is missing or unreadable" };
  }

  const problems = [];
  if (evidence.failures !== 0) problems.push(`the recorded verification had ${evidence.failures} failure(s)`);
  if (evidence.restoreExitCode !== 0) problems.push(`pg_restore exited ${evidence.restoreExitCode}`);
  if (evidence.restoreIsolation !== "PASS") problems.push("the restore target was not proven disposable");
  if (!(evidence.dumpSizeBytes > 0)) problems.push("the recorded dump size is not positive");
  if (!/^[0-9a-f]{64}$/.test(evidence.dumpSha256 ?? "")) problems.push("no usable SHA-256 was recorded");
  if (evidence.sourceFingerprint !== evidence.restoredFingerprint) {
    problems.push("the restored schema does not match the source schema");
  }

  // The evidence file is committed, so it names the dump but not where it
  // lives. The directory comes from the environment, defaulting to where the
  // backup script writes.
  const backupDir = process.env.NOX_BACKUP_DIR ?? join(process.env.HOME ?? "", ".local/share/nox-backups");
  const dumpPath = evidence.dumpFileName ? join(backupDir, evidence.dumpFileName) : null;
  if (!dumpPath || !existsSync(dumpPath)) {
    problems.push("the dump file named in the evidence no longer exists");
  } else {
    const stats = statSync(dumpPath);
    if (stats.size !== evidence.dumpSizeBytes) problems.push("the dump size no longer matches the evidence");
    const mode = (stats.mode & 0o777).toString(8);
    if (mode !== "600") problems.push(`the dump is not owner-only (mode ${mode})`);
    const sha = createHash("sha256").update(readFileSync(dumpPath)).digest("hex");
    if (sha !== evidence.dumpSha256) problems.push("the dump checksum no longer matches the evidence");
  }

  // The backup has to describe the database being released, not an older shape.
  if (process.env.DATABASE_URL) {
    const probe = spawnSync(
      "npx",
      ["tsx", "-e", `
        import { PrismaClient } from "@prisma/client";
        import { PrismaPg } from "@prisma/adapter-pg";
        const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
        const r = await p.$queryRawUnsafe(\`select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' order by table_name, column_name)) as md5 from information_schema.columns where table_schema='public'\`);
        console.log(r[0].md5);
        await p.$disconnect();
      `],
      { encoding: "utf8" },
    );
    const current = (probe.stdout ?? "").trim().split("\n").pop();
    if (current && current !== evidence.sourceFingerprint) {
      problems.push(`production schema has changed since the backup (${current} vs ${evidence.sourceFingerprint})`);
    }
  }

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    return { ok: false, note: `${problems.length} problem(s) with the logical backup` };
  }

  const counted = Object.keys(evidence.sourceCounts ?? {}).length;
  console.log(`mechanism B: logical dump verified by restore — ${counted} tables, checksum matches, artefact retained`);
  return { ok: true, note: `logical dump + restore, ${counted} tables` };
}

/** Read-only production checks. Release mode only; never part of PR CI. */
function productionSchemaGate() {
  const run = spawnSync("npx", ["tsx", "scripts/verify-production-schema.ts"], { stdio: "inherit" });
  return { ok: run.status === 0 };
}

/**
 * Next writes route and validator types into `.next/dev`, and tsconfig picks
 * them up. A dev server killed mid-write leaves them truncated, and the gate
 * then reports a syntax error in a generated file as if the branch did not
 * compile. Removing them costs nothing — Next regenerates them — and keeps the
 * gate measuring the source it is supposed to measure.
 */
function typecheckGate() {
  rmSync(join(process.cwd(), ".next/dev/types"), { recursive: true, force: true });
  return { ok: spawnSync("npx", ["tsc", "--noEmit"], { stdio: "inherit" }).status === 0 };
}

const MERGE_GATES = [
  { name: "typecheck", run: typecheckGate },
  { name: "lint (no new errors)", run: lintGate },
  { name: "git diff --check", cmd: "git", args: ["diff", "--check"] },
  { name: "validate:message-send-reconciliation", cmd: "npm", args: ["run", "validate:message-send-reconciliation"] },
  { name: "validate:message-local-persistence", cmd: "npm", args: ["run", "validate:message-local-persistence"] },
  { name: "validate:message-client-id-schema", cmd: "npm", args: ["run", "validate:message-client-id-schema"] },
  // The rest need the disposable database. They refuse to run against anything
  // not marked disposable, and that refusal is itself a failed gate.
  { name: "validate:message-send-idempotency", cmd: "npm", args: ["run", "validate:message-send-idempotency"], needsDb: true },
  // A committed message must never come back as a 500. Production shipped that
  // failure once; the gate now runs the suite that would have caught it.
  { name: "validate:message-send-postcommit", cmd: "npm", args: ["run", "validate:message-send-postcommit"], needsDb: true },
  { name: "validate:message-send-browser", cmd: "npm", args: ["run", "validate:message-send-browser"], needsDb: true, browser: true },
  { name: "validate:message-send-browser-e2ee", cmd: "npm", args: ["run", "validate:message-send-browser-e2ee"], needsDb: true, browser: true },
  { name: "validate:message-attachment-delivery", cmd: "npm", args: ["run", "validate:message-attachment-delivery"], needsDb: true, browser: true },
  { name: "validate:message-attachment-delivery-e2ee", cmd: "npm", args: ["run", "validate:message-attachment-delivery-e2ee"], needsDb: true, browser: true },
  { name: "validate:connection-notice-hydration", cmd: "npm", args: ["run", "validate:connection-notice-hydration"], needsDb: true, browser: true },
  { name: "validate:dialog-focus-trap", cmd: "npm", args: ["run", "validate:dialog-focus-trap"], needsDb: true, browser: true },
  { name: "validate:a11y-basics", cmd: "npm", args: ["run", "validate:a11y-basics"], needsDb: true, browser: true },
  { name: "production build", cmd: "npm", args: ["run", "build"] },
];

const RELEASE_GATES = [
  { name: "production backup verified", run: backupGate, production: true },
  { name: "production schema parity + column/index", run: productionSchemaGate, production: true },
];

const gates = RELEASE_MODE ? [...MERGE_GATES, ...RELEASE_GATES] : MERGE_GATES;

const results = [];
let blocked = false;

for (const gate of gates) {
  process.stdout.write(`\n── ${gate.name} ────────────────────────────────\n`);
  const started = Date.now();
  let ok;
  let note = "";
  if (gate.run) {
    const outcome = gate.run();
    ok = outcome.ok;
    note = outcome.note ?? "";
  } else {
    const run = spawnSync(gate.cmd, gate.args, { stdio: "inherit", shell: process.platform === "win32" });
    ok = run.status === 0;
  }
  const seconds = Math.round((Date.now() - started) / 1000);
  if (!ok) blocked = true;
  results.push({ gate, ok, seconds, note });
}

// The browser suites are what prove the integration exists rather than the
// layers merely compiling. Any of them missing or failing blocks the merge.
const browserGates = results.filter((result) => result.gate.browser);
const browserProven = browserGates.length >= 5 && browserGates.every((result) => result.ok);
if (!browserProven) blocked = true;

console.log("\n══════════════════════════════════════════════");
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.gate.name}  (${result.seconds}s)${result.note ? " — " + result.note : ""}`);
}

const dbGatesPass = results.filter((r) => r.gate.needsDb).every((r) => r.ok);
console.log(`\nMESSAGE_TEST_DB_ISOLATION: ${dbGatesPass ? "PASS" : "FAIL"}`);
console.log(`BROWSER_INTEGRATION: ${browserProven ? "PASS" : "BLOCKED — merge requires passing browser integration suites"}`);

const mergeBlocked = results.filter((r) => !r.gate.production).some((r) => !r.ok) || !browserProven;
console.log(`\nMERGE CI GATE: ${mergeBlocked ? "BLOCKED" : "PASS"}`);

if (RELEASE_MODE) {
  const releaseBlocked = blocked;
  console.log(`PRODUCTION RELEASE GATE: ${releaseBlocked ? "BLOCKED" : "PASS"}`);
} else {
  console.log("PRODUCTION RELEASE GATE: not evaluated (run `npm run guard:production-release`)");
  console.log("Passing the merge gate does not authorise a deploy — see");
  console.log("docs/releases/message-delivery-p0-migration.md.");
}

process.exit(blocked ? 1 : 0);
