/**
 * Disposable test-database guard for the backup prototype.
 *
 * Nothing in the backup integration path may run against the production
 * database. This module refuses to hand back a connection string unless it can
 * positively prove the target is a throwaway local database, and it is the only
 * place allowed to create or drop one.
 *
 *   npm run validate:backup-db-isolation
 */
import { Client } from "pg";

/** Hosts that are never acceptable, however the URL is spelled. */
const FORBIDDEN_HOST_FRAGMENTS = ["rlwy.net", "railway", "neon.tech", "supabase", "amazonaws.com", "azure", "render.com"];

/** Only a loopback host may be used for tests. */
const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** The test database name must carry this marker so it can never be confused with a real one. */
export const TEST_DB_NAME = "nox_backup_disposable_test";
const TEST_DB_MARKER = "disposable_test";

export type IsolationReport = {
  ok: boolean;
  reasons: string[];
  host: string | null;
  database: string | null;
  fingerprint: string | null;
};

function parse(url: string): { host: string; port: string; database: string } | null {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || "5432",
      database: parsed.pathname.replace(/^\//, ""),
    };
  } catch {
    return null;
  }
}

export function testDatabaseUrl(): string {
  const explicit = process.env.BACKUP_TEST_DATABASE_URL;
  if (explicit) return explicit;
  const user = process.env.USER || process.env.LOGNAME || "postgres";
  return `postgresql://${user}@127.0.0.1:5432/${TEST_DB_NAME}`;
}

/**
 * Static checks on the URL, plus a live check that the production URL and the
 * test URL are genuinely different servers.
 */
export async function assertIsolation(): Promise<IsolationReport> {
  const reasons: string[] = [];
  const url = testDatabaseUrl();
  const parts = parse(url);

  if (!parts) {
    return { ok: false, reasons: ["test database url is unparseable"], host: null, database: null, fingerprint: null };
  }

  const { host, database } = parts;

  if (!ALLOWED_HOSTS.has(host)) {
    reasons.push(`test host must be loopback, got "${host}"`);
  }
  for (const fragment of FORBIDDEN_HOST_FRAGMENTS) {
    if (host.includes(fragment)) reasons.push(`test host looks like managed infrastructure ("${fragment}")`);
  }
  if (!database.includes(TEST_DB_MARKER)) {
    reasons.push(`test database name must contain "${TEST_DB_MARKER}", got "${database}"`);
  }

  // The production URL, if present, must not be the same server *or* database.
  const productionUrl = process.env.DATABASE_URL;
  if (productionUrl) {
    const prod = parse(productionUrl);
    if (prod) {
      if (prod.host === host && prod.port === parts.port && prod.database === database) {
        reasons.push("test url is identical to DATABASE_URL");
      }
      if (prod.database === database) {
        reasons.push("test database name matches the production database name");
      }
      if (ALLOWED_HOSTS.has(prod.host) && prod.host === host && prod.database === database) {
        reasons.push("test and production point at the same local database");
      }
    }
  }

  // Live fingerprint: the test database must be reachable and must NOT contain
  // the production messaging tables, which would mean we are pointed at real data.
  let fingerprint: string | null = null;
  if (reasons.length === 0) {
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      const { rows } = await client.query<{ current_database: string; inet_server_addr: string | null }>(
        "select current_database(), inet_server_addr()::text as inet_server_addr",
      );
      fingerprint = `${rows[0].current_database}@${rows[0].inet_server_addr ?? "local"}`;

      // Positive proof rather than a guess: the disposable database carries a
      // marker table written only by createTestDatabase. Inferring "this is
      // production" from the mere presence of the messaging *schema* would be
      // wrong — the integration test needs those tables for foreign keys and
      // for the delivery-isolation check.
      const { rows: marker } = await client.query<{ count: string }>(
        `select count(*)::text as count from information_schema.tables
         where table_schema = 'nox_test_guard' and table_name = 'disposable_marker'`,
      );
      if (marker[0].count === "0") {
        reasons.push("test database is missing the disposable marker table — refusing to treat it as disposable");
      }
    } catch (error) {
      reasons.push(`cannot connect to the test database: ${(error as Error).message}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  return { ok: reasons.length === 0, reasons, host, database, fingerprint };
}

/** Creates the disposable database. Refuses if the name lacks the marker. */
export async function createTestDatabase(): Promise<void> {
  const parts = parse(testDatabaseUrl());
  if (!parts || !parts.database.includes(TEST_DB_MARKER)) {
    throw new Error("REFUSING_TO_CREATE_NON_DISPOSABLE_DATABASE");
  }
  const admin = new Client({ connectionString: testDatabaseUrl().replace(/\/[^/]*$/, "/postgres") });
  await admin.connect();
  try {
    const { rows } = await admin.query("select 1 from pg_database where datname = $1", [parts.database]);
    if (rows.length === 0) {
      await admin.query(`CREATE DATABASE "${parts.database}"`);
    }
  } finally {
    await admin.end();
  }

  // Stamp the marker that assertIsolation requires. It lives in its own schema
  // rather than `public` so `prisma db push` — which prunes anything not in the
  // Prisma schema — cannot delete it. Production databases will never have it,
  // because nothing else creates it.
  const marked = new Client({ connectionString: testDatabaseUrl() });
  await marked.connect();
  try {
    await marked.query(`CREATE SCHEMA IF NOT EXISTS "nox_test_guard"`);
    await marked.query(`CREATE TABLE IF NOT EXISTS "nox_test_guard"."disposable_marker" (note text primary key)`);
    await marked.query(
      `INSERT INTO "nox_test_guard"."disposable_marker" (note) VALUES ($1) ON CONFLICT DO NOTHING`,
      ["disposable backup test database — safe to drop"],
    );
  } finally {
    await marked.end();
  }
}

/** Drops the disposable database. Only ever the marked name, and only after re-checking. */
export async function dropTestDatabase(): Promise<void> {
  const parts = parse(testDatabaseUrl());
  if (!parts || !parts.database.includes(TEST_DB_MARKER) || !ALLOWED_HOSTS.has(parts.host)) {
    throw new Error("REFUSING_TO_DROP_NON_DISPOSABLE_DATABASE");
  }
  const admin = new Client({ connectionString: testDatabaseUrl().replace(/\/[^/]*$/, "/postgres") });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${parts.database}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
}
