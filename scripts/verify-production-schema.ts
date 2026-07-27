/**
 * Read-only production schema verification, for the release gate only.
 *   npx tsx scripts/verify-production-schema.ts
 *
 * It answers exactly three questions and touches nothing:
 *   - does production still have the column and index the runtime writes?
 *   - does the Prisma schema still agree with production about `Message`?
 *   - has the schema fingerprint changed since the backup evidence was written?
 *
 * Only `information_schema`, `pg_index` and aggregate counts are read. No
 * message content and no client id is read, printed or logged.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}${detail ? " :: " + detail : ""}`);
  }
}

const RECORDED_FINGERPRINT = (() => {
  try {
    const text = readFileSync("docs/releases/message-delivery-p0-production-backup.md", "utf8");
    return /Schema fingerprint \| `([0-9a-f]{32})`/.exec(text)?.[1] ?? null;
  } catch {
    return null;
  }
})();

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. This gate is for the production release only.");
    process.exit(1);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const columns = await prisma.$queryRawUnsafe<{ data_type: string; is_nullable: string; column_default: string | null }[]>(
      `select data_type, is_nullable, column_default
         from information_schema.columns
        where table_name = 'Message' and column_name = 'clientMessageId'`,
    );
    check("Message.clientMessageId exists", columns.length === 1);
    check("clientMessageId is text", columns[0]?.data_type === "text", columns[0]?.data_type);
    check("clientMessageId is nullable", columns[0]?.is_nullable === "YES", columns[0]?.is_nullable);
    check("clientMessageId has no default", columns[0]?.column_default === null);

    const indexes = await prisma.$queryRawUnsafe<
      { relname: string; indisunique: boolean; indisvalid: boolean; indisready: boolean; cols: string }[]
    >(
      `select i.relname, ix.indisunique, ix.indisvalid, ix.indisready,
              string_agg(a.attname, ',' order by a.attnum) as cols
         from pg_index ix
         join pg_class i on i.oid = ix.indexrelid
         join pg_class t on t.oid = ix.indrelid
         join pg_attribute a on a.attrelid = t.oid and a.attnum = any(ix.indkey)
        where t.relname = 'Message' and i.relname = 'Message_senderUserId_clientMessageId_key'
        group by 1,2,3,4`,
    );
    check("the idempotency index exists", indexes.length === 1);
    check("the index is unique", indexes[0]?.indisunique === true);
    check("the index is valid and ready", indexes[0]?.indisvalid === true && indexes[0]?.indisready === true);
    check("the index covers (senderUserId, clientMessageId)", indexes[0]?.cols === "senderUserId,clientMessageId", indexes[0]?.cols);

    const duplicates = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*)::bigint as count
         from (select "senderUserId", "clientMessageId"
                 from "Message"
                where "clientMessageId" is not null
                group by 1,2 having count(*) > 1) d`,
    );
    check("no duplicate (senderUserId, clientMessageId) pairs", Number(duplicates[0].count) === 0);

    const fingerprint = await prisma.$queryRawUnsafe<{ md5: string }[]>(
      `select md5(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' order by table_name, column_name)) as md5
         from information_schema.columns
        where table_schema = 'public'`,
    );
    const current = fingerprint[0]?.md5;
    console.log(`schema fingerprint: ${current}`);
    if (RECORDED_FINGERPRINT) {
      check(
        "the schema fingerprint matches the recorded one",
        current === RECORDED_FINGERPRINT,
        current === RECORDED_FINGERPRINT ? "" : `recorded ${RECORDED_FINGERPRINT}`,
      );
    } else {
      check("a fingerprint is recorded in the backup evidence", false, "none found");
    }

    // Prisma's own view of the drift. Only `Message` matters for this release;
    // the backup tables are a separate, unshipped feature.
    const diff = execFileSync(
      "npx",
      ["prisma", "migrate", "diff", "--from-config-datasource", "prisma.config.ts", "--to-schema", "prisma/schema.prisma", "--script"],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const messageDrift = diff
      .split("\n")
      .filter((line) => /"Message"|clientMessageId/.test(line));
    check("no Message drift between the schema and production", messageDrift.length === 0, messageDrift.slice(0, 3).join(" | "));
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

main()
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nProduction schema verification passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
