# Release candidate — MESSAGE DELIVERY P0

```
CODE RELEASE CANDIDATE = PASS
PRODUCTION RELEASE     = BLOCKED (no verified backup)
```

Not merged. Not deployed. Nothing was pushed to `main` and no deploy was
triggered.

| | |
| --- | --- |
| Branch | `p0-message-delivery` |
| RC SHA | the commit tagged `rc/message-delivery-p0` — a file cannot name the SHA of the commit that contains it, so the tag is the authority |
| Base | `059803a` — the SHA production is currently running |
| `main` | unchanged, still `059803a` |
| Production runtime | unchanged, still `059803a` |
| Production schema | unchanged since the incident — fingerprint `2ff98e9b1be919eb0cf9e7843d45d915`, re-verified read-only |
| Worktree | clean |

## Included

| Area | Files |
| --- | --- |
| Reconciliation (pure) | `src/lib/messages/reconcile.ts` |
| Durable pending storage + outbox | `src/lib/messages/pending-repository.ts`, `src/lib/e2ee/indexed-db.ts` |
| Delivery controller | `src/lib/messages/delivery-controller.ts` |
| React binding | `src/app/(app)/chats/[chatId]/useMessageDelivery.ts` |
| Attachment upload transport | `src/app/(app)/chats/[chatId]/attachment-transport.ts` |
| Conversation wiring | `src/app/(app)/chats/[chatId]/ChatMessages.tsx` |
| Persist-before-clear | `src/app/(app)/chats/[chatId]/ChatComposer.tsx` |
| Hydration-safe client reads | `src/lib/use-client-value.ts`, `InlineConnectionNotice.tsx`, `ChatHeader.tsx` |
| History page size | `src/app/api/chats/[chatId]/messages/route.ts` |
| Upload idempotency | `src/app/api/chats/[chatId]/attachments/route.ts` |
| Gates | `scripts/release-guard.mjs`, `scripts/verify-production-schema.ts`, `scripts/validate-*.ts`, `scripts/lib/browser-harness.ts` |

## Excluded

Deliberately not in this candidate: the dock's first paint, the light-theme
canvas split, the group sender prefix, the Appearance redesign, E2EE Backup
(phase C2), Search, Contacts and Calls. None of them were touched.

Also excluded: any schema change. This candidate adds no migration.

## Migrations already present in production

`Message.clientMessageId` and `Message_senderUserId_clientMessageId_key` are
already in production — applied outside their gate on 2026-07-27, recorded in
`docs/incidents/20260727-message-client-id-production-migration.md` and accepted
as-is. This candidate therefore requires **no** migration step. The upload route
now writes the same column, which the existing schema already supports.

## Validation matrix

| Suite | Checks | Environment | Result |
| --- | --- | --- | --- |
| `validate:message-send-reconciliation` | 25 | pure | PASS |
| `validate:message-local-persistence` | 71 | pure, in-memory stores | PASS |
| `validate:message-client-id-schema` | 14 | files only | PASS |
| `validate:message-send-idempotency` | 11 | disposable Postgres | PASS |
| `validate:message-send-browser` | 19 | Chromium + disposable Postgres | PASS |
| `validate:message-send-browser-e2ee` | 47 | two Chromium contexts + disposable Postgres | PASS |
| `validate:message-attachment-delivery` | 28 | Chromium + disposable Postgres | PASS |
| `validate:connection-notice-hydration` | 12 | Chromium + disposable Postgres | PASS |
| typecheck / lint budget / build / `git diff --check` | — | — | PASS |

`MESSAGE_TEST_DB_ISOLATION=PASS` on every database-backed suite. The two
database suites refuse to run unless the target carries the disposable marker;
that refusal is a failed gate, not a skip.

## Known limitations

1. **No verified production backup.** The blocker. See
   `docs/releases/message-delivery-p0-production-backup.md`.
2. **Attachment captions on encrypted media.** The server rejects a caption on
   encrypted media (`Подписи к зашифрованным медиа пока не поддержаны`), so a
   caption is sent as its own message in one-to-one chats. In group chats it
   travels with the upload. This is pre-existing server behaviour, not something
   this candidate changes.
3. **Attachment suite runs in a group conversation.** The upload route refuses
   unencrypted media in a one-to-one chat, and media encryption needs registered
   recipient devices; encrypted media is covered by the crypto suites and by the
   E2EE text suite, not by an end-to-end encrypted *attachment* browser run.
   That gap is real and is stated rather than papered over.
4. **Editing a message** still goes down the old direct-fetch path. Editing is
   not a send and has never shown the duplication or loss this work addresses.
5. **Lint backlog.** 9 pre-existing errors remain; the gate holds the line at
   that number rather than fixing an unrelated backlog.
6. **Delivery/read receipts for attachments** follow the existing receipt
   mechanism, unchanged.

## Runtime rollback

Redeploy `059803a`. The column stays; a runtime that does not write
`clientMessageId` is unaffected by a nullable column, and the upload route's
idempotency lookup simply stops being exercised. No schema rollback is part of
this plan — see the incident document for when a schema rollback would be
considered at all.

Pending messages held on a device by this runtime remain in IndexedDB after a
rollback. The older runtime ignores them; they are re-sent if the newer runtime
returns. Nothing is lost by rolling back.
