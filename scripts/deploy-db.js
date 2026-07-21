// Release-phase DB migration runner.
//
// Runs prisma/deploy.sql against DATABASE_URL using the `pg` driver directly.
// Deliberately avoids the Prisma CLI, prisma.config.ts and dotenv: the release
// command runs in Railway's production install (devDependencies omitted), and
// any of those loading a dev-only or undeclared module aborts the whole
// `&& node server.js` chain — which took the site down (Railway "train has not
// arrived"). `pg` is a production dependency and DATABASE_URL is a real env
// var in production, so this path has nothing to prune away.
//
// The SQL is expected to be idempotent (IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS), so re-running on every deploy is safe.

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("[deploy-db] DATABASE_URL is not set — cannot run migrations.");
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, "..", "prisma", "deploy.sql");
  const sql = fs.readFileSync(sqlPath, "utf8").trim();
  if (!sql) {
    console.log("[deploy-db] deploy.sql is empty — nothing to run.");
    return;
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    // node-postgres sends the whole string as one simple-query batch, so the
    // semicolon-separated statements in deploy.sql all run in order.
    await client.query(sql);
    console.log("[deploy-db] deploy.sql applied successfully.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("[deploy-db] failed:", err);
  process.exit(1);
});
