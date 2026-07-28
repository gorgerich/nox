# Release log — MESSAGE DELIVERY P0

```
MERGE:  DONE
DEPLOY: DONE, verified
SMOKE:  DONE — 52 checks, 0 failures
STATUS: MESSAGE DELIVERY P0 PRODUCTION RELEASE: PASS
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

## Smoke — run on production, PASS

`npx tsx scripts/production-smoke.ts <credentials-file>` — 52 checks, 0
failures, against the deployed runtime with two dedicated accounts and a
conversation created for this purpose. No real user's conversation was touched,
no seed was run, and no production service was stopped: the two induced failures
were an aborted socket and an aborted upload **inside the smoke browser only**.

| Scenario | Result |
| --- | --- |
| Both devices register through the real E2EE flow | PASS |
| Contact request sent and accepted (the product's own rule for a one-to-one chat) | PASS |
| E2EE text: one message, one envelope per device, no duplicates | PASS |
| HTTP 2xx alone marks it sent; recipient decrypts it | PASS |
| Delivery acknowledgement | PASS |
| Read acknowledgement | PASS |
| Send with the sender's socket blocked | PASS — reaches the server, one bubble, nothing stuck |
| Socket restored afterwards | PASS — no duplicate |
| Replay of the captured payload with the same client id | PASS — 200, no second message, no second envelope set |
| Leave the conversation and return | PASS |
| Reload, sender | PASS |
| Reload, recipient — still decrypts | PASS |
| Photo, file, voice, video circle | PASS — one message and one attachment each |
| Caption | PASS — a second adjacent message, visible once |
| Recipient opens the decrypted media | PASS |
| Failed upload, then retry | PASS — one message, no duplicate attachment, outbox emptied |

Counts created by the final run, scoped to that run: 9 messages, 24 envelopes,
6 attachments, 48 media key envelopes.

### Read-only post-smoke verification

| Check | Result |
| --- | --- |
| Duplicate `(senderUserId, clientMessageId)` anywhere in production | 0 |
| Messages with two attachments | 0 |
| Smoke messages with neither an envelope nor an attachment | 0 |
| Smoke attachments without a media key envelope | 0 |
| Messages left in `sending`/`uploading` on the device | 0 |
| Unhandled exceptions in the runtime log | 0 |
| Schema fingerprint | `2ff98e9b1be919eb0cf9e7843d45d915` — unchanged |

No message text, ciphertext, client id, media key, credential or invite code was
printed at any point.

### One finding — a production hydration warning

Three React hydration warnings (minified #418) appeared on the sender's pages.
They are cosmetic: React discards the server markup for that subtree and
re-renders on the client, and every functional check passed.

They are **not** the two mismatches fixed in this release — those are covered by
`validate:connection-notice-hydration`, which passes. The remaining one only
appears on production because the server renders in UTC and the viewer's browser
renders in its own timezone, so a rendered timestamp differs between the two. A
suite where the server and the browser share a machine cannot reproduce it,
which is exactly why it survived to production.

Not fixed here — it is presentation, it is pre-existing, and the fix belongs
with the UI work rather than inside a delivery release. It is the first item on
the follow-up branch.

## Smoke accounts

Two dedicated accounts, `p0smokea…` / `p0smokeb…`, kept for future releases.
Both invites are consumed (`USED`, 1 of 1) so neither can be redeemed again.
Credentials live in a `0600` file outside the repository and are not recorded
here. The accounts were not deleted: removing a user by hand would mean deleting
device and transport records manually, which is riskier than leaving two inert
accounts in place.

## Rollback readiness

- Rollback target: `059803a` — redeploy that SHA.
- **Leave `clientMessageId` and its index in place.** A runtime that does not
  write the column is unaffected by a nullable one.
- No schema rollback is part of this plan.
- The backup remains retained until the rollback window closes.
- Messages held on a device by this runtime stay in IndexedDB across a runtime
  rollback; the older runtime ignores them and they are re-sent if this runtime
  returns. Nothing is lost by rolling back.

## Incident during this release — closed

`railway domain`, run with no arguments to *read* a domain, **created** one on
the Postgres service. Removed by the workspace owner and verified gone; the TCP
proxy, the app's domains, the deployment and the schema fingerprint are all
untouched. Full account, exposure assessment and post-delete verification:
`docs/incidents/20260727-message-client-id-production-migration.md`.

```
ACCIDENTAL_POSTGRES_HTTP_DOMAIN_REMOVED = YES
```
