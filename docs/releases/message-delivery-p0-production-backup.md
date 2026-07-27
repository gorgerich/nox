# Production backup prerequisite — MESSAGE DELIVERY P0

```
PRODUCTION_BACKUP_VERIFIED = NO
```

A backup could not be verified with the tooling available in this session.
Nothing here is a substitute for that verification, and the production release
gate stays BLOCKED until it is done.

**This is the only remaining production release blocker.** Encrypted attachments
are now proven end to end by `npm run validate:message-attachment-delivery-e2ee`,
so the "Checklist for the Railway workspace owner" below is the last thing
standing between the release candidate and a deploy.

## What was checked

| Check | Result |
| --- | --- |
| Railway CLI exposes a backup or snapshot command | no — `railway --help` lists `volume` only, with `list/add/delete/update/detach/files/browse/attach`; no backup, restore or snapshot verb |
| `railway volume list --json` reports backup history | no — it reports `currentSizeMB`, `sizeMB`, `status`, `mountPath`, nothing about backups |
| `railway status --json` reports backup state | no |
| A backup was created during this work | no |
| Any destructive or restore operation was run against production | no |

Read-only commands only. No `pg_dump`, no restore drill, no write of any kind.

## Database this applies to

| | |
| --- | --- |
| Service | `Postgres` (`2e1fc8de-1001-4962-abe7-657df44987e7`) |
| Project / environment | `ingenious-encouragement` / `production` |
| Volume | `postgres-volume`, `/var/lib/postgresql/data`, 500 MB |
| Schema fingerprint | `2ff98e9b1be919eb0cf9e7843d45d915` |
| Runtime SHA at time of writing | `059803ad24fe588e56bd0ce5086c76b6565e0be4` |

Fingerprint is `md5` over `table_name.column_name:data_type:is_nullable` for
every column in schema `public`, ordered by table then column. Re-computing it
at release time and getting the same value is what proves the schema has not
drifted since this was written.

No credentials, connection string or user data is recorded in this file, and no
dump belongs in this repository.

## Accepted ways to satisfy this

Any one of these closes the gate. Whoever performs it fills in the evidence
table below and flips the flag at the top of this file to `YES`.

1. **Railway managed backup / snapshot.** Visible in the Railway dashboard under
   the Postgres service. Record the backup's timestamp, retention and the
   restore path Railway offers.
2. **Verified manual logical dump.** `pg_dump` from a trusted machine, stored
   outside this repository, with a restore verified into a scratch database —
   an unrestored dump is not a verified backup. Record where it lives and who
   holds it; do not record the path to any secret.
3. **Infrastructure snapshot** of the volume, with a documented restore
   procedure.
4. **Another approved mechanism** — record what it is and how restore was
   demonstrated.

## Checklist for the Railway workspace owner

Only someone with access to the Railway workspace can confirm a managed backup;
the CLI available here cannot. Below is exactly what is needed. Send the values,
not screenshots of secrets — **no connection string, no password, no dump, and
no message content**.

Copy this block, fill it in, and it can be pasted straight into the evidence
table below.

```
1.  Backup type ................. managed backup | snapshot | logical dump | other:
2.  Created at (UTC) ............ YYYY-MM-DDTHH:MM:SSZ
3.  Created by .................. automatic schedule | manual | CI job (name it)
4.  Target project .............. must read: ingenious-encouragement
5.  Target environment .......... must read: production
6.  Target service .............. must read: Postgres  (id 2e1fc8de-1001-4962-abe7-657df44987e7)
7.  Confirms it is production ... yes | no   (how was this confirmed?)
8.  Size or sanity check ........ e.g. "118 MB", or a row count for a known table
9.  Encrypted at rest ........... yes | no | unknown
10. Storage location ............ e.g. "Railway managed, us-west" — no credentials
11. Retention ................... e.g. "7 daily, 4 weekly"
12. Restore procedure ........... one or two sentences, or a link to the runbook
13. Restore demonstrated ........ yes (when, into what) | no
14. Confirmed by ................ person or system that verified items 1–13
```

Notes on the fields that matter most:

- **7** is the one that is easy to get wrong. A backup of the wrong environment
  is not a backup. Confirm it by the service id above, not by the display name.
- **13**: an unrestored dump is a file, not a backup. If a restore has never been
  demonstrated, say `no` — that is still useful information and it is recorded
  honestly rather than assumed.
- **8** exists so that an empty or truncated backup is caught. A backup a
  fraction of the database's size is a failed backup.

If the answer to **1** is a logical dump taken locally, add where it is stored
and who holds it. The dump itself must not enter this repository.

## Evidence — to be completed before release

| Field | Value |
| --- | --- |
| Backup type | _pending_ |
| Timestamp (UTC) | _pending_ |
| Created by | _pending_ |
| Database target | Railway `Postgres` (`2e1fc8de-1001-4962-abe7-657df44987e7`), project `ingenious-encouragement`, environment `production` |
| Confirmed to be production | _pending — how?_ |
| Size / sanity check | _pending_ |
| Encrypted at rest | _pending_ |
| Storage location | _pending — no credentials_ |
| Schema fingerprint at backup time | _pending — must match the value above, or the difference must be explained_ |
| Restore procedure | _pending_ |
| Restore actually demonstrated | _pending_ |
| Retention | _pending_ |
| Verified by | _pending_ |

## Limitations

- The absence of a backup command in the CLI is not evidence that no backup
  exists — Railway may well be taking them. It is evidence that **this session
  cannot see them**, which is not the same thing and must not be reported as a
  pass.
- The schema change that reached production outside its gate
  (`docs/incidents/20260727-message-client-id-production-migration.md`) was
  applied with no confirmed backup in place. It was additive and nullable, and
  no regression was observed, but the absence of a safety net at that moment is
  part of why this prerequisite now exists.
- This file records only what was verified. It is not a claim that the data is
  safe.
