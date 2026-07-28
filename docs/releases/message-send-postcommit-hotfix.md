# Hotfix — a committed message reported as an HTTP 500

```
MESSAGE SEND POST-COMMIT HOTFIX: PASS
```

| | |
| --- | --- |
| Branch | `hotfix/message-send-postcommit-p2028` |
| Base | `bbe2ba5` — the SHA production is running. Not based on the UI branch. |
| Migration | none |
| UI RC | `rc/messenger-shell-ui-1` → `4fd8f60`, frozen and untouched |

## The defect

`POST /api/chats/[chatId]/messages` committed the message, then bumped
`chat.updatedAt` and cleared members' `deletedAt` in a **second, separate
transaction**. When that transaction failed, the route threw and the sender got
a 500 — for a message that was already durably in Postgres.

That is the worst failure available in a messenger. The sender sees an error and
retries or gives up; the recipient already has the message; nothing in the
product can tell the two states apart afterwards.

### Root cause, measured

| Question | Answer |
| --- | --- |
| Where the transaction was opened | `prisma.$transaction([...])`, both branches of the route (encrypted and plaintext) |
| Where the message actually commits | `prisma.message.create` with nested `receipts` and `envelopes` — its own implicit transaction, earlier |
| What ran after the commit | `chat.update`, `chatMember.updateMany`, `logRealtime`, `emitToUser`/`emitToChat`, dynamic `import("@/lib/push")` and the push send |
| Transaction client used after the callback | no — the batch form was used, `tx` never escaped |
| Socket publish inside the transaction callback | no; but its failure still failed the request |
| Database work after long crypto or a network call | no |
| `timeout` / `maxWait` | 5000 ms / 2000 ms — the defaults, never set explicitly |
| Prisma error | `P2028`, `meta: {"modelName":"Chat","operation":"rollback","timeout":5000,"timeTaken":59943}`, raised from `prisma.chat.update()` |
| Route branch | both |

The timing detail that matters: **P2028 is raised when the transaction commits
or rolls back, not when it starts**. The five-second budget elapsed while
`chat.update` waited — on a lock, or on a database busy enough to make the wait
that long — and by then the message had been committed for seconds.

"Pool pressure" is the condition that made the wait long enough. It is not the
cause. The cause is a post-commit write inside a transaction whose failure was
allowed to fail the request.

### How it was reproduced

Deterministically, with no sleep standing in for synchronisation:

1. a second connection holds `SELECT … FOR NO KEY UPDATE` on the chat row —
   that mode blocks the bookkeeping `UPDATE` while still permitting the
   key-share lock the message insert takes for its foreign key (plain
   `FOR UPDATE` would block the insert as well, which is a pre-commit failure
   and a different scenario);
2. the database is given `lock_timeout = 1500ms`, so the blocked write fails
   fast instead of hanging;
3. the app runs against a pool of exactly one connection.

Before the fix: `status 500 after 1740ms`, with `the message held behind the
lock is committed` passing in the same run. After the fix: `201`, the canonical
message, one row.

The bare `P2028` above was captured the same way, from a standalone client
running the exact `$transaction([chat.update, chatMember.updateMany])` the route
used.

## The fix

**Inside the transaction** — only what the message's durability requires: the
message, its receipts, its envelopes (and, in the attachment route, the
attachment and its media-key envelopes). That nested create *is* the commit, and
it is the only failure that fails the request.

**After the commit** — `afterCommit()` in `src/lib/messages/after-commit.ts`
wraps chat bookkeeping, the socket publish and the push notification. It never
throws. A failure is recorded as a structured warning naming the stage, the chat
and the message id, plus the error name and code and a truncated first line —
never a request payload, so a warning cannot carry message text, ciphertext or
key material into the logs.

So:

```text
commit succeeded → the message is sent → the request does not fail
```

The response after a successful commit always carries the canonical `Message`,
the `clientMessageId` echoed back, and the server timestamp on the message.

Errors *before* the commit are untouched: they still fail the request, because
there the message really is not sent. They answer with a plain sentence, not a
driver error.

### Socket publish

Published only after the commit. If it fails, the message stays committed, the
sender gets 2xx, a repeat POST with the same `clientMessageId` returns the same
canonical message, and the recipient still picks it up through history/sync. No
second message or envelope is created to force a second event.

A durable event outbox would make delivery notification retryable rather than
best-effort. That is a real further hardening and deliberately **not** in this
hotfix, which is meant to be small enough to reason about in one sitting.

### Idempotency under an ambiguous answer

A lost race on the `(senderUserId, clientMessageId)` unique index now returns
the winner's message instead of a 500. The check is on the error code alone —
which field the violated index names is not reliably reported through the driver
adapter, `meta.target` came back empty — and is confirmed by looking the client
id up: found means it was that race; anything else stays a genuine failure.

## Validation

`npm run validate:message-send-postcommit` — twelve scenarios, deterministic
barriers throughout:

ordinary send · a single-connection pool · concurrent sends · a database
operation blocked behind a real row lock · post-commit socket-publish failure ·
post-commit notification and bookkeeping failure · client disconnect after the
commit · retry after a lost response · racing duplicates · attachment ·
E2EE text · E2EE attachment.

It asserts: no `P2028` anywhere in the run, a commit never becomes a 500,
pre-commit errors still fail, one message and one envelope set per client id, no
driver error in any response body, no connection left idle in transaction.

The post-commit failure scenarios use `POSTCOMMIT_FAULT_STAGES`, which is inert
unless set and is set by nothing in production.

`DATABASE_POOL_MAX` was added so the suite can run the route against the
smallest pool the driver allows. It is unset in production, where the driver
default applies exactly as before.

### Gate of record

| | |
| --- | --- |
| `validate:message-send-postcommit` | 40 checks, 0 failures |
| `validate:message-send-reconciliation` | PASS |
| `validate:message-local-persistence` | PASS |
| `validate:message-send-idempotency` | PASS |
| `validate:message-send-browser` | PASS |
| `validate:message-send-browser-e2ee` | PASS |
| `validate:message-attachment-delivery` | PASS |
| `validate:message-attachment-delivery-e2ee` | PASS |
| `validate:connection-notice-hydration` | PASS |
| typecheck | clean |
| lint | 9 errors — unchanged from `bbe2ba5`, all pre-existing and in files this branch does not touch |
| production build | clean |
| `git diff --check` | clean |

The new suite is not a rubber stamp: run against the unfixed route it fails on
exactly the checks that describe the defect — the locked-chat send returns 500
while `the message held behind the lock is committed` passes in the same run,
and a racing duplicate answers 500 instead of the winner's message.

Two delivery suites also carry a test-determinism change ported from the UI
branch, without which this branch's own gate is unreliable: `data-composer-ready`
on the composer textarea (a data attribute, no visual effect), waits on
conditions rather than fixed sleeps, and a `signIn()` that fails the run instead
of leaving a context silently unauthenticated.

### Backup artifact, re-verified before the merge

| | |
| --- | --- |
| dump | `nox-production-20260727-230834.dump` |
| size | 227367 bytes, mode 600 |
| sha256 | matches `backup-restore-evidence.json` exactly |

## Rollback

Runtime only: redeploy the previous `main` SHA. No schema change is involved, so
nothing needs to be reverted in the database.
