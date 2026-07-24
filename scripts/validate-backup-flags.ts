/**
 * Guards the thing most likely to go wrong by accident: the backup prototype
 * shipping switched on.
 *   npm run validate:backup-flags
 */
import { getBackupFlags, BACKUP_DISABLED_RESPONSE } from "../src/lib/backup/flags";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const KEYS = ["E2EE_BACKUP_ENABLED", "E2EE_BACKUP_WRITE_ENABLED", "E2EE_BACKUP_RESTORE_ENABLED"];
function withEnv(values: Record<string, string | undefined>, fn: () => void) {
  const previous = KEYS.map((key) => [key, process.env[key]] as const);
  for (const key of KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) if (value !== undefined) process.env[key] = value;
  try {
    fn();
  } finally {
    for (const key of KEYS) delete process.env[key];
    for (const [key, value] of previous) if (value !== undefined) process.env[key] = value;
  }
}

// The critical case: nothing configured at all.
withEnv({}, () => {
  const flags = getBackupFlags();
  check("unset environment: backup disabled", flags.enabled === false);
  check("unset environment: write disabled", flags.writeEnabled === false);
  check("unset environment: restore disabled", flags.restoreEnabled === false);
});

// Sub-flags must not be able to switch themselves on behind the master switch.
withEnv({ E2EE_BACKUP_WRITE_ENABLED: "true", E2EE_BACKUP_RESTORE_ENABLED: "true" }, () => {
  const flags = getBackupFlags();
  check("sub-flags are inert while the master switch is off", flags.writeEnabled === false && flags.restoreEnabled === false);
});

withEnv({ E2EE_BACKUP_ENABLED: "true" }, () => {
  const flags = getBackupFlags();
  check("master switch alone does not enable write", flags.writeEnabled === false);
  check("master switch alone does not enable restore", flags.restoreEnabled === false);
});

withEnv({ E2EE_BACKUP_ENABLED: "true", E2EE_BACKUP_WRITE_ENABLED: "true" }, () => {
  const flags = getBackupFlags();
  check("write can be enabled independently of restore", flags.writeEnabled === true && flags.restoreEnabled === false);
});

withEnv({ E2EE_BACKUP_ENABLED: "true", E2EE_BACKUP_RESTORE_ENABLED: "true" }, () => {
  const flags = getBackupFlags();
  check("restore can be enabled independently of write", flags.restoreEnabled === true && flags.writeEnabled === false);
});

// Only explicit opt-in values count.
for (const value of ["false", "0", "yes", "TRUE", ""]) {
  withEnv({ E2EE_BACKUP_ENABLED: value }, () => {
    const flags = getBackupFlags();
    const expected = false;
    check(`"${value}" does not enable the feature`, flags.enabled === expected);
  });
}

check("disabled response carries no capability", BACKUP_DISABLED_RESPONSE.enabled === false);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll backup-flag checks passed.");
