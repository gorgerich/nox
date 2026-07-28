# Release log — MESSAGE DELIVERY P0

```
MERGE:  DONE
DEPLOY: DONE, verified
SMOKE:  NOT RUN — production registration is invite-only (see below)
```

## What shipped

| | |
| --- | --- |
| RC | `rc/message-delivery-p0-3` → `8021ab6` |
| Merge commit on `main` | `bbe2ba5` (`--no-ff`, feature branch preserved) |
| Deployed SHA | `bbe2ba576e9aad0e87af035f0c245506f18dccac` — matches `main` exactly |
| Deployment | Railway, service `nox`, environment `production`, status SUCCESS |
| Previous runtime | `059803a` (the rollback target) |
| Migration in this release | none |

## Pre-merge confirmations

- Backup retained and re-checked at merge time: SHA-256
  `f56f346…4a84`, 227 367 bytes, mode `0600` — all three match the recorded
  evidence.
- Worktree clean at exactly the RC commit.
- `npm run guard:production-release` → **PASS**: 13 merge gates (288 checks
  across eight browser and unit suites, typecheck, lint budget, production
  build) plus the backup and production-schema gates.

## Post-deploy verification

| Check | Result |
| --- | --- |
| Deployed SHA equals the merge commit | yes |
| Container started | `Ready on http://0.0.0.0:8080` |
| `deploy.sql` applied | yes, no errors |
| Login page served | HTTP 200 |
| Schema fingerprint | `2ff98e9b1be919eb0cf9e7843d45d915` — unchanged |
| `Message.clientMessageId` | present, `text`, nullable, no default |
| `Message_senderUserId_clientMessageId_key` | unique, valid, ready, correct columns |
| Duplicate `(senderUserId, clientMessageId)` pairs | 0 |
| Prisma ↔ production `Message` drift | none |
| Errors in the deploy logs | none |
| Rows changed by the release | none — `Message` 261, `User` 8, unchanged |

## Smoke — not run

The controlled smoke was **not** executed. Production registration is
invite-only (`src/app/api/auth/register/route.ts` requires a valid
`inviteCode`), so creating the two test accounts the smoke plan calls for would
mean writing an `Invite` row straight into the production database. That is a
direct data write outside the application, which is a different thing from
"smoke on a test account" and was not what the release plan authorised.

What that leaves unverified in production, as opposed to in the browser suites:

- an ordinary E2EE text send;
- a send with the socket down;
- a replayed request with the same `clientMessageId`;
- leaving and returning, and reloading;
- an attachment and a voice message;
- absence of duplicates from a second device's point of view.

All of the above are covered by the browser suites against a disposable
database, which is why the release gate passed — but that is not the same as
having seen it on production hardware.

To run the smoke, one of:

- existing test-account credentials, or
- an invite code from the admin UI, or
- explicit confirmation to mint one invite row directly.

## Rollback readiness

- Rollback target: `059803a` — redeploy that SHA.
- **Leave `clientMessageId` and its index in place.** A runtime that does not
  write the column is unaffected by a nullable one.
- No schema rollback is part of this plan.
- The backup remains retained until the rollback window closes.
- Messages held on a device by this runtime stay in IndexedDB across a runtime
  rollback; the older runtime ignores them and they are re-sent if this runtime
  returns. Nothing is lost by rolling back.

## Incident during this release

`railway domain`, run with no arguments to *read* the service's domain, instead
**created** one — Railway's no-subcommand behaviour is create, not list. It
attached a service domain to the **Postgres** service:
`postgres-production-f3ce.up.railway.app`.

- It routes nothing: target port is unset and the address does not answer.
  Postgres speaks its own wire protocol, not HTTP, and a Railway HTTP domain is
  not the TCP proxy that would expose the database port. Practical exposure is
  low.
- It is still an unintended change to production infrastructure and should be
  removed: `railway domain delete postgres-production-f3ce.up.railway.app`.
- The deletion was attempted and blocked by the local permission policy, so it
  is outstanding.
- Lesson, recorded because it is the second time a "read" turned out to write:
  read-only intent is not read-only behaviour. Use the explicit subcommand
  (`railway domain list`), never the bare verb.
