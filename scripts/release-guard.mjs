/**
 * Merge gate for MESSAGE DELIVERY P0.
 *   npm run guard:message-delivery-p0
 *
 * It runs every gate and reports the result of running it. Checking that a
 * command exists in package.json proves nothing — the previous round shipped a
 * schema change that no gate ever executed, which is the incident recorded in
 * docs/incidents/20260727-message-client-id-production-migration.md.
 *
 * Exit code 0 means the branch is eligible for merge review. Any non-zero exit
 * means MERGE GATE: BLOCKED.
 */
import { spawnSync } from "node:child_process";

/**
 * The repository does not lint clean today: 9 errors predate this branch
 * (react-hooks/set-state-in-effect in the chats screens and the preview
 * routes). Measured on the merge base and again with this branch applied —
 * both 9 — so the gate is "introduce none", not "fix the backlog", which would
 * be a different change than the one under review. Lower this number when the
 * backlog is cleared; never raise it.
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

const GATES = [
  { name: "typecheck", cmd: "npx", args: ["tsc", "--noEmit"] },
  { name: "lint (no new errors)", run: lintGate },
  { name: "git diff --check", cmd: "git", args: ["diff", "--check"] },
  { name: "validate:message-send-reconciliation", cmd: "npm", args: ["run", "validate:message-send-reconciliation"] },
  { name: "validate:message-local-persistence", cmd: "npm", args: ["run", "validate:message-local-persistence"] },
  { name: "validate:message-client-id-schema", cmd: "npm", args: ["run", "validate:message-client-id-schema"] },
  // These two need the disposable database; they refuse to run against anything
  // that is not marked disposable, and that refusal is itself a failed gate.
  { name: "validate:message-send-idempotency", cmd: "npm", args: ["run", "validate:message-send-idempotency"], needsDb: true },
  { name: "validate:message-send-browser", cmd: "npm", args: ["run", "validate:message-send-browser"], needsDb: true, browser: true },
  { name: "production build", cmd: "npm", args: ["run", "build"] },
];

const results = [];
let blocked = false;

for (const gate of GATES) {
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

// The browser gate is what proves the integration exists rather than the
// layers merely compiling. Its absence alone blocks the merge.
const browserGate = results.find((result) => result.gate.browser);
const browserProven = Boolean(browserGate?.ok);
if (!browserProven) blocked = true;

console.log("\n══════════════════════════════════════════════");
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.gate.name}  (${result.seconds}s)${result.note ? " — " + result.note : ""}`);
}
console.log(`\nMESSAGE_TEST_DB_ISOLATION: ${results.filter((r) => r.gate.needsDb).every((r) => r.ok) ? "PASS" : "FAIL"}`);
console.log(`BROWSER_INTEGRATION: ${browserProven ? "PASS" : "BLOCKED — merge requires a passing browser integration"}`);
console.log(`\nMERGE GATE: ${blocked ? "BLOCKED" : "PASS"}`);
console.log("Passing this gate does not authorise a deploy — see the release order in");
console.log("docs/releases/message-delivery-p0-migration.md.");

process.exit(blocked ? 1 : 0);
