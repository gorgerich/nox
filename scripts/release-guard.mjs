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
import { readFileSync } from "node:fs";

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
 * Reads the flag out of the backup evidence document. A document that still
 * says NO is a failed gate — "we could not check" is not a pass.
 */
function backupGate() {
  const path = "docs/releases/message-delivery-p0-production-backup.md";
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return { ok: false, note: `${path} is missing` };
  }
  const match = /PRODUCTION_BACKUP_VERIFIED\s*=\s*(YES|NO)/.exec(text);
  if (!match) return { ok: false, note: "no PRODUCTION_BACKUP_VERIFIED flag found" };
  const verified = match[1] === "YES";
  console.log(`PRODUCTION_BACKUP_VERIFIED=${match[1]} (${path})`);
  if (!verified) console.error("A confirmed production backup is a prerequisite for deploying.");
  return { ok: verified, note: `flag is ${match[1]}` };
}

/** Read-only production checks. Release mode only; never part of PR CI. */
function productionSchemaGate() {
  const run = spawnSync("npx", ["tsx", "scripts/verify-production-schema.ts"], { stdio: "inherit" });
  return { ok: run.status === 0 };
}

const MERGE_GATES = [
  { name: "typecheck", cmd: "npx", args: ["tsc", "--noEmit"] },
  { name: "lint (no new errors)", run: lintGate },
  { name: "git diff --check", cmd: "git", args: ["diff", "--check"] },
  { name: "validate:message-send-reconciliation", cmd: "npm", args: ["run", "validate:message-send-reconciliation"] },
  { name: "validate:message-local-persistence", cmd: "npm", args: ["run", "validate:message-local-persistence"] },
  { name: "validate:message-client-id-schema", cmd: "npm", args: ["run", "validate:message-client-id-schema"] },
  // The rest need the disposable database. They refuse to run against anything
  // not marked disposable, and that refusal is itself a failed gate.
  { name: "validate:message-send-idempotency", cmd: "npm", args: ["run", "validate:message-send-idempotency"], needsDb: true },
  { name: "validate:message-send-browser", cmd: "npm", args: ["run", "validate:message-send-browser"], needsDb: true, browser: true },
  { name: "validate:message-send-browser-e2ee", cmd: "npm", args: ["run", "validate:message-send-browser-e2ee"], needsDb: true, browser: true },
  { name: "validate:message-attachment-delivery", cmd: "npm", args: ["run", "validate:message-attachment-delivery"], needsDb: true, browser: true },
  { name: "validate:message-attachment-delivery-e2ee", cmd: "npm", args: ["run", "validate:message-attachment-delivery-e2ee"], needsDb: true, browser: true },
  { name: "validate:connection-notice-hydration", cmd: "npm", args: ["run", "validate:connection-notice-hydration"], needsDb: true, browser: true },
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
