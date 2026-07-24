/**
 * Feature flags for the E2EE backup prototype.
 *
 * All three default to **off**. An unset environment therefore behaves exactly
 * as before this feature existed: no backup UI, no backup endpoints doing
 * work, no change to message delivery.
 *
 * Write and restore are separate so a staging environment can, for example,
 * accept uploads while restore is still being validated.
 */

function readFlag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return raw === "true" || raw === "1";
}

export type BackupFlags = {
  /** Master switch. When false the other two are irrelevant. */
  enabled: boolean;
  /** Allow clients to upload new generations. */
  writeEnabled: boolean;
  /** Allow clients to download and restore a generation. */
  restoreEnabled: boolean;
};

export function getBackupFlags(): BackupFlags {
  const enabled = readFlag("E2EE_BACKUP_ENABLED");
  return {
    enabled,
    // Sub-flags can never be active while the master switch is off.
    writeEnabled: enabled && readFlag("E2EE_BACKUP_WRITE_ENABLED"),
    restoreEnabled: enabled && readFlag("E2EE_BACKUP_RESTORE_ENABLED"),
  };
}

/** Shape returned by backup endpoints when the feature is off. Never an error. */
export const BACKUP_DISABLED_RESPONSE = {
  enabled: false,
  writeEnabled: false,
  restoreEnabled: false,
  reason: "feature_disabled",
} as const;
