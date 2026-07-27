/**
 * Static guard on the send-idempotency schema contract.
 *   npm run validate:message-client-id-schema
 *
 * Two failures this catches, both of which have already happened once:
 *  - the runtime writing a column the deployed database does not have;
 *  - a schema migration slipping into prisma/deploy.sql, which Railway applies
 *    on every boot with no gate (see docs/incidents/20260727-…).
 *
 * It reads files only. It never connects to a database.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname ?? __dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

// --- the model ---------------------------------------------------------------
const schema = read("prisma/schema.prisma");
const messageModel = schema.slice(schema.indexOf("model Message {"), schema.indexOf("model Message {") + 4000).split("\n}")[0];

check("Message declares clientMessageId", /\bclientMessageId\s+String\?/.test(messageModel));
check(
  "clientMessageId is optional, so legacy rows stay valid",
  /\bclientMessageId\s+String\?/.test(messageModel) && !/\bclientMessageId\s+String\s/.test(messageModel),
);
check(
  "the idempotency key is (senderUserId, clientMessageId)",
  /@@unique\(\[senderUserId,\s*clientMessageId\]\)/.test(messageModel),
);

// --- the deploy pipeline -----------------------------------------------------
const deploySql = read("prisma/deploy.sql");
check(
  "prisma/deploy.sql does not carry the clientMessageId migration",
  !/clientMessageId/i.test(deploySql),
  "deploy.sql runs on every production boot with no release gate",
);

const manualPath = "prisma/migrations/manual/20260727_message_client_id.sql";
check("the migration exists as a gated manual file", existsSync(join(root, manualPath)));
if (existsSync(join(root, manualPath))) {
  const manual = read(manualPath);
  check("the manual migration adds the column", /ALTER TABLE[\s\S]*clientMessageId/i.test(manual));
  check("the manual migration creates the unique index", /CREATE UNIQUE INDEX/i.test(manual));
  check("the manual migration documents a rollback", /rollback/i.test(manual));
}

// --- the runtime that depends on it ------------------------------------------
const route = read("src/app/api/chats/[chatId]/messages/route.ts");
check(
  "the send route looks the message up by the idempotency key",
  /senderUserId_clientMessageId/.test(route),
  "without this a retry creates a second message",
);
check("the send route persists clientMessageId", /clientMessageId/.test(route));

// --- the client half ---------------------------------------------------------
const controller = read("src/lib/messages/delivery-controller.ts");
check(
  "a retry reuses the client id rather than minting a new one",
  /retry\(clientMessageId: string\)/.test(controller) && !/retry[\s\S]{0,400}newClientMessageId\(\)/.test(controller),
);

const chat = read("src/app/(app)/chats/[chatId]/ChatMessages.tsx");
check("the conversation sends through the delivery controller", /delivery\.send\(/.test(chat));
check("the conversation retries through the delivery controller", /delivery\.retry\(/.test(chat));
check("the send request carries the client id", /clientMessageId/.test(chat));

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll clientMessageId schema-contract checks passed.");
