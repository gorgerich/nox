# Deployment incident — `Message.clientMessageId` reached production outside the migration gate

- **Date:** 2026-07-27
- **Severity:** process violation. Additive nullable schema change with low observed risk; no regressions found at the time of the read-only verification.
- **Status:** closed for the schema; production schema **accepted as-is**, no rollback.

## Summary

A migration adding `Message.clientMessageId` and a unique index on
`("senderUserId", "clientMessageId")` was applied to the production database
automatically, before the separate migration gate that was supposed to authorise
it. The change was never reviewed under that gate, never preceded by a confirmed
backup check, and was not intended to ship in that round.

## What happened

1. Commit `2c835da` added the `ALTER TABLE` to `prisma/deploy.sql`.
2. `prisma/deploy.sql` is executed by `scripts/deploy-db.js`, which runs as part
   of the Railway start command declared in `railway.json`:

   ```json
   "startCommand": "node scripts/deploy-db.js && node server.js"
   ```

3. `main` is the auto-deploy branch. Every deployment ever recorded for the
   `nox` service was built from `main` — see *Deploy history* below.
4. Pushing `2c835da` to `main` triggered a Railway deployment at
   `2026-07-27T12:38:55Z`. `deploy-db.js` executed `deploy.sql`, which applied
   the ALTER to the production database.
5. The ALTER was removed from `deploy.sql` in `059803a` and moved to
   `prisma/migrations/manual/20260727_message_client_id.sql`. That removal
   prevented *future* automatic applications. It did not undo the one that had
   already run — the production schema was already changed.

The reason this was not caught earlier: removing the statement from
`deploy.sql` was treated as equivalent to "the migration has not been applied".
It is not. `deploy.sql` is a forward-only apply-on-boot script with no ledger,
so the only authority on what production contains is production itself.

## What was changed in production

| Object | Value |
| --- | --- |
| Column | `Message.clientMessageId` |
| Type | `text` |
| Nullable | `YES` |
| Default | none |
| Index | `Message_senderUserId_clientMessageId_key` |
| Index columns | `senderUserId, clientMessageId` |
| Unique | `true` |
| `indisvalid` / `indisready` / `indislive` | `t` / `t` / `t` |

## Read-only verification (2026-07-27, after discovery)

Only `SELECT`s against `information_schema`, `pg_index`, `pg_class` and
aggregate counts over `Message` were executed. No message content and no
`clientMessageId` value was read or recorded.

| Check | Result |
| --- | --- |
| Column type | `text` |
| Column nullable | yes |
| Column default | none |
| Index exists | yes |
| Index valid / ready / live | yes / yes / yes |
| Index columns | `senderUserId, clientMessageId` |
| Index unique | yes |
| Rows total in `Message` | 260 |
| Rows with non-NULL `clientMessageId` | 0 |
| Duplicate `(senderUserId, clientMessageId)` groups among non-NULL | 0 |
| Prisma schema ↔ production diff, `Message` | empty — no drift |
| Production runtime SHA | `059803ad24fe588e56bd0ce5086c76b6565e0be4` |
| Production schema fingerprint | `2ff98e9b1be919eb0cf9e7843d45d915` |

Schema fingerprint is `md5` over
`table_name.column_name:data_type:is_nullable` for every column in schema
`public`, ordered by table then column.

The remaining Prisma ↔ production diff consists only of the `BackupAccount`,
`BackupGeneration` and `BackupChunk` tables, which exist in `schema.prisma` but
not in production. They are unreached at runtime — the E2EE backup feature is
behind flags that all default to off — and are outside the scope of this
incident.

`clientMessageId` is non-NULL on zero rows because no deployed runtime writes
it yet. Postgres treats NULLs as distinct in a unique index, so the 260 existing
rows cannot collide with each other or with future writes.

### Deploy history (Railway service `nox`, environment `production`)

```
2026-07-27T12:47:02Z SUCCESS branch=main 059803a   <- current production runtime
2026-07-27T12:38:55Z REMOVED branch=main 2c835da   <- applied the migration
2026-07-27T12:21:22Z REMOVED branch=main bab44ec
...  (every earlier deployment: branch=main)
```

## Data impact

- User messages were **not** modified. The change is additive; no row was
  rewritten, no column dropped, no type altered.
- Message content was not read during the investigation.
- The production seed was **not** run.
- No test message was sent to production.
- Only read-only queries were executed after discovery.

## Backup status

Railway's database backup/snapshot state could not be confirmed through the
read-only tooling available in this session — `railway volume list` reports
volume size and status but not backup history, and the backup view is a
dashboard feature. **An up-to-date production backup is therefore unconfirmed.**
No backup was created as part of this investigation. Confirming a current
backup is step 1 of the release gate in
`docs/releases/message-delivery-p0-migration.md`.

## Decision: no schema rollback

The production schema change is **accepted as-is**. `DROP INDEX` / `DROP COLUMN`
would be an additional, unnecessary production change:

- the change is additive and the column is nullable;
- legacy rows with `NULL` are valid and remain valid;
- existing content was never rewritten;
- Prisma schema and production currently agree on `Message`;
- a runtime rollback does not require removing the column — a runtime that does
  not know about `clientMessageId` runs unaffected against a nullable column.

Schema rollback is reserved for a separate, confirmed incident in which the
column or index is demonstrated to cause a production problem. It is not part
of the standard release plan and is not performed to restore process hygiene.

## Corrective actions

| # | Action | Status |
| --- | --- | --- |
| 1 | Remove the ALTER from `prisma/deploy.sql`; move it to `prisma/migrations/manual/` with an explicit release prerequisite and rollback plan | done (`059803a`) |
| 2 | Verify the production schema by direct read-only inspection rather than by reading repository files | done (this document) |
| 3 | Freeze production deploys for the duration of MESSAGE DELIVERY P0 development | in force |
| 4 | Move all P0 work off `main` onto `p0-message-delivery`; no partial cherry-picks into `main` | in force |
| 5 | Add a merge guard that executes the P0 validations rather than checking that the commands exist (`scripts/release-guard.mjs`, `npm run guard:message-delivery-p0`) | done |
| 6 | Treat "the statement is no longer in `deploy.sql`" as saying nothing about what production contains — the database is the only authority | recorded here |
| 7 | Any future schema change reaches `deploy.sql` only after its migration gate has been explicitly approved | policy |

## Rollback policy after this incident

**Runtime rollback — permitted.** Redeploy a previous runtime. The column stays
in place and unused; a nullable column does not interfere with a runtime that
ignores it.

**Schema rollback — gated.** Only on a separate confirmed incident proving the
column or index itself causes a production problem. The reverse script lives in
`prisma/migrations/manual/20260727_message_client_id.sql`; dropping the column
loses idempotency keys only, never message content. It is not to be run to make
the migration history look tidy.

---

# Second incident, same session — an accidental public domain on the database service

- **Date:** 2026-07-28
- **Severity:** unintended production infrastructure change. No data exposure
  found; the endpoint never routed.
- **Status:** removed and verified.

## What happened

`railway domain` was run with no subcommand, intending to read the service's
domain. Railway's no-subcommand behaviour is **create**, not list. The linked
service at the time was `Postgres`, so it created a service domain on the
**database** service:

```
postgres-production-f3ce.up.railway.app
```

The mistake is the same shape as the first incident in this document: an action
believed to be read-only was not.

## Timeline

| | |
| --- | --- |
| Created | 2026-07-28, during post-deploy verification of `bbe2ba5` |
| Noticed | immediately — the command printed "Service domain created" |
| Assessed | same minute: target port unset, endpoint did not answer |
| Deletion attempted by tooling | blocked by the local permission policy |
| Removed | by the workspace owner, via the Railway dashboard |
| Verified removed | 2026-07-28, read-only |

## Exposure assessment

Low, and specifically not a database exposure:

- A Railway *HTTP* domain proxies HTTP to a container port. PostgreSQL speaks
  its own wire protocol; an HTTP proxy in front of it does not carry a `psql`
  connection.
- Exposing the database port is a different feature — the TCP proxy — which was
  not touched.
- The domain had no target port set and the address did not answer
  (`curl` returned no response).

No credential was published, and no configuration of the database service itself
was modified.

## Post-delete verification (read-only)

| Check | Result |
| --- | --- |
| `railway domain list -s Postgres -e production` | "No domains found" |
| `nox` service domains | unchanged — `nox-production-6f54.up.railway.app` (8080) and `noxchat.ru` (8080), both ACTIVE |
| PostgreSQL TCP proxy | unchanged — `shuttle.proxy.rlwy.net:12720` → app port 5432, ACTIVE |
| Application connects to the database | yes |
| Application serving | HTTP 200 on `/login` |
| Deployment restarted by this | no — still the `bbe2ba5` deployment from 2026-07-27T23:58:22Z |
| Schema fingerprint | `2ff98e9b1be919eb0cf9e7843d45d915` — unchanged |
| New errors in the runtime log | none |

```
ACCIDENTAL_POSTGRES_HTTP_DOMAIN_REMOVED = YES
```

## Corrective action

Never invoke `railway domain` (or any CLI verb with a create-by-default bare
form) without an explicit subcommand. Reading domains is
`railway domain list -s <service> -e <environment>`, with the service named
rather than inherited from whatever happens to be linked — the linked service
here was the database, not the app, which is what turned a misread command into
a change on the wrong service entirely.
