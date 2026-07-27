# Production backup prerequisite — MESSAGE DELIVERY P0

```
PRODUCTION_BACKUP_VERIFIED = YES
```

**Mechanism: a PostgreSQL logical custom-format dump, restored and verified.**

Railway's managed backups and point-in-time recovery are not available on the
current plan, and buying a higher plan was declined. The prerequisite is
therefore met the other way: a dump was taken from production, checksummed,
restored into a disposable database, and checked against the source — schema,
row counts, constraints, foreign keys, unique indexes, sequences, orphans, and a
read-only application query.

An unrestored dump would be a file, not a backup. This one was restored.

## Evidence

Machine-readable form: `docs/releases/backup-restore-evidence.json`, written by
`npm run verify:backup-restore`. It contains no credentials and no row content —
only counts, checksums and fingerprints.

| Field | Value |
| --- | --- |
| Backup type | PostgreSQL logical dump, custom archive (`pg_dump -Fc --no-owner --no-privileges`) |
| Reason for this mechanism | Railway managed backup/PITR unavailable on the current plan |
| Production service | `2e1fc8de-1001-4962-abe7-657df44987e7` (`Postgres`, project `ingenious-encouragement`, environment `production`) |
| Source database | `railway` |
| Source server | PostgreSQL 18.4 (Debian 18.4-1.pgdg13+1) |
| Source schema fingerprint | `2ff98e9b1be919eb0cf9e7843d45d915` |
| Created at (UTC) | 2026-07-27T23:09:01Z |
| `pg_dump` exit code | 0 |
| File name | `nox-production-20260727-230834.dump` |
| Size | 227 367 bytes |
| SHA-256 | `f56f3465e70bddce10997723caeec4f4e6373a2781b913465d8e74b42cb24a84` |
| File mode | `0600`, in a `0700` directory |
| Storage | local encrypted volume (FileVault), outside the repository and outside any cloud-synced folder; path not recorded here |
| Table data entries in the archive | 25 |
| Restore target | `nox_release_restore_test` on loopback |
| `RESTORE_TEST_DB_ISOLATION` | PASS |
| `pg_restore` exit code | 0 (`--exit-on-error --single-transaction --no-owner --no-privileges`) |
| Restored schema fingerprint | `2ff98e9b1be919eb0cf9e7843d45d915` — identical to source |
| Verified at | 2026-07-27 (same session as the dump) |
| Verified by | the release gate `npm run verify:backup-restore`, run against the artefact |

### Row counts — source vs restored

Exact match on all 25 tables. The critical ones:

| Table | Source | Restored |
| --- | --- | --- |
| `User` | 8 | 8 |
| `Chat` | 11 | 11 |
| `ChatMember` | 21 | 21 |
| `Message` | 261 | 261 |
| `MessageEnvelope` | 272 | 272 |
| `MessageReceipt` | 231 | 231 |
| `Attachment` | 37 | 37 |
| `MediaKeyEnvelope` | 67 | 67 |
| `UserDevice` | 55 | 55 |
| `DeviceKeyBundle` | 55 | 55 |

No row content was read. Counts only.

### Structure

| Check | Source | Restored |
| --- | --- | --- |
| Constraints | 226 | 226 |
| Foreign keys | 39 | 39 |
| Unique indexes | 46 | 46 |
| `Message.clientMessageId` | present | present |
| `Message_senderUserId_clientMessageId_key` | valid | valid |
| Invalid indexes | — | 0 |
| Sequences with impossible values | — | 0 |

Orphan checks, all zero on the restore: messages without a chat, messages
without a sender, envelopes without a message, attachments without a message,
media key envelopes without an attachment, devices without a user, chat members
without a chat.

The application opens the restored database: Prisma connects, counts users and
chats, and executes a relation query. `prisma migrate diff` reports no `Message`
drift against the restored schema.

## Isolation of the restore target

`RESTORE_TEST_DB_ISOLATION=PASS` requires all of:

- the restore host is loopback;
- the restore database name carries a `test`/`disposable`/`scratch` marker;
- the restore target is not the production host and database;
- production is not itself on loopback (otherwise the two cannot be told apart);
- the restore target is not the database the application is configured with.

A single failure is terminal and nothing is dropped. The restore drops and
recreates its target, so this check runs before any destructive step.

## Handling

- The dump was taken with `umask 077` into a directory created at `0700`.
- Connection details were passed through environment variables and a temporary
  `0600` `.pgpass`, never as a command-line argument — `argv` is world-readable
  in the process list, so a URL there would leak the password to every user on
  the machine. The `.pgpass` is removed on exit.
- `pg_dump` reads; it performs no writes against production.
- The dump, its log, and the connection details are not in git. This repository
  holds only timestamps, sizes, checksums, fingerprints, counts and results.
- Retained until the production deploy, its smoke test and the rollback window
  are all complete.

## Limitations — real ones

- **This is a point-in-time logical snapshot, not continuous PITR.** Anything
  written to production after 2026-07-27T23:09:01Z is not in it. Recovering to a
  moment between this dump and a failure is not possible.
- Restoring it over production would lose every change since that timestamp.
  That is an explicit, separately-confirmed operation with its own procedure —
  see the rollback section of the release candidate — and is not something the
  release plan does on its own.
- The restore was verified on PostgreSQL 18 locally, matching the production
  major version. A restore onto a different major version is not covered by this
  evidence.
- The row counts were taken from a live database, so they are a consistent view
  of the dump, not a freeze of production. They matched exactly here, which
  means no writes landed during the dump window; that is luck, not a guarantee.
- Deleting the file later does not guarantee erasure on an SSD. When the
  retention window closes, the file is removed; that is a deletion, not a
  destruction claim.

## Reproducing this

```bash
DATABASE_URL=... bash scripts/backup-production.sh
DATABASE_URL=... npm run verify:backup-restore -- <path-to-dump>
```

The second command is what the production release gate runs against the recorded
evidence. It refuses to pass on a dump that is missing, empty, world-readable,
inside the repository, or that fails to restore.
