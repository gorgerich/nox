/**
 * Proves the backup integration path targets a throwaway database, never
 * production. Prints BACKUP_TEST_DB_ISOLATION=PASS only when every check holds.
 *
 *   npm run validate:backup-db-isolation
 */
import { assertIsolation, createTestDatabase, testDatabaseUrl, TEST_DB_NAME } from "./backup-test-db";

function redact(url: string): string {
  return url.replace(/\/\/[^@]*@/, "//***@");
}

async function main() {
  console.log(`test target      : ${redact(testDatabaseUrl())}`);
  if (process.env.DATABASE_URL) {
    console.log(`production target: ${redact(process.env.DATABASE_URL)}`);
  }

  await createTestDatabase();
  const report = await assertIsolation();

  console.log(`database         : ${report.database}`);
  console.log(`host             : ${report.host}`);
  console.log(`fingerprint      : ${report.fingerprint ?? "n/a"}`);

  if (!report.ok) {
    for (const reason of report.reasons) console.error(`FAIL  ${reason}`);
    console.error("\nBACKUP_TEST_DB_ISOLATION=FAIL");
    console.error("Refusing to run backup integration tests. Status: BLOCKED.");
    process.exit(1);
  }

  console.log(`\nok    host is loopback`);
  console.log(`ok    database name carries the disposable marker (${TEST_DB_NAME})`);
  console.log(`ok    distinct from DATABASE_URL`);
  console.log(`ok    carries the disposable marker table`);
  console.log("\nBACKUP_TEST_DB_ISOLATION=PASS");
}

void main().catch((error) => {
  console.error("BACKUP_TEST_DB_ISOLATION=FAIL");
  console.error(error);
  process.exit(1);
});
