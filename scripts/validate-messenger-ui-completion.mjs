/**
 * The whole messenger UI gate.
 *   npm run validate:messenger-ui-completion
 *
 * Runs each suite and reports what running it produced. Listing the commands
 * without executing them is how a gate ends up green while the thing it guards
 * is broken — this repository has already paid for that lesson once.
 *
 * The browser suites share one disposable database and one set of ports, so
 * they run in sequence, not in parallel.
 */
import { spawnSync } from "node:child_process";

const SUITES = [
  { name: "group sender preview", script: "validate:group-chat-sender-preview" },
  { name: "appearance sheet", script: "validate:appearance-sheet" },
  { name: "appearance persistence", script: "validate:appearance-persistence" },
  { name: "light canvas", script: "validate:messenger-light-canvas" },
  { name: "dock first paint", script: "validate:dock-first-paint" },
  { name: "timestamp hydration", script: "validate:timestamp-hydration" },
  { name: "chat theme consistency", script: "validate:chat-theme-consistency" },
  { name: "chat scroll anchor", script: "validate:chat-scroll-anchor" },
  { name: "message reconciliation", script: "validate:message-send-reconciliation" },
  { name: "message local persistence", script: "validate:message-local-persistence" },
  { name: "message send, browser", script: "validate:message-send-browser" },
  { name: "message send, E2EE", script: "validate:message-send-browser-e2ee" },
];

const results = [];
for (const suite of SUITES) {
  process.stdout.write(`\n── ${suite.name} ────────────────────────────────\n`);
  const started = Date.now();
  const run = spawnSync("npm", ["run", "--silent", suite.script], { stdio: "inherit" });
  results.push({ ...suite, ok: run.status === 0, seconds: Math.round((Date.now() - started) / 1000) });
}

console.log("\n══════════════════════════════════════════════");
for (const result of results) {
  console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}  (${result.seconds}s)`);
}

const blocked = results.some((result) => !result.ok);
console.log(`\nMESSENGER UI COMPLETION: ${blocked ? "BLOCKED" : "PASS"}`);
console.log("Real-device dock smoke is tracked separately — see");
console.log("docs/testing/real-device-dock-smoke.md.");
process.exit(blocked ? 1 : 0);
