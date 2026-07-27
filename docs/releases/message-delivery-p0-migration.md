# Release plan — MESSAGE DELIVERY P0

Branch: `p0-message-delivery`. Not merged. Not deployed.

```
PRODUCTION_RUNTIME_DEPLOY_BLOCKED_UNTIL_MESSAGE_DELIVERY_P0_PASS = YES
```

The schema prerequisite is already satisfied — `Message.clientMessageId` and
`Message_senderUserId_clientMessageId_key` exist in production, applied outside
the intended gate on 2026-07-27
(`docs/incidents/20260727-message-client-id-production-migration.md`). What is
still blocked is the **runtime**: production runs `059803a`, which does not
contain the delivery integration. Migration readiness and runtime readiness are
separate; only the first is done.

## Do not

- Do not deploy production while this branch is in development.
- Do not merge partial P0 work into `main`, and do not cherry-pick from this branch.
- Do not `DROP` the column or the index. Schema rollback is reserved for a
  separate confirmed incident in which the column or index is shown to cause a
  production problem; it is not part of this plan.
- Do not send test messages to production before P0 PASS. Read-only checks only:
  schema, index, deployment metadata, health, logs without message content.

## Controlled production smoke plan

**Not run yet, and not to be run before merge approval and a deploy of the RC.**
It uses a dedicated test account only — never a real user's conversation.

1. Confirm the backup (step 1 below) — this is the gate everything else waits on.
2. Read-only schema check: `npm run verify:production-schema`.
3. Deploy the exact RC SHA from
   `docs/releases/message-delivery-p0-release-candidate.md`. Not "latest main".
4. Sign in as the test account, in a conversation with a second test account.
5. Send an ordinary E2EE text message. Expect one bubble, one row, one envelope
   per device.
6. If it can be done safely, block the socket transport and send again: an HTTP
   2xx alone must show `sent`.
7. Replay the same request with the same `clientMessageId`. Expect 200 and no
   second row.
8. Leave the conversation and return. Nothing lost, nothing doubled.
9. Reload. Same.
10. Send an attachment. Expect one message, one attachment row.
11. Send a voice message. Same.
12. Check both accounts for duplicates.
13. Check that nothing is left `pending` or `failed` on either device.
14. Check server error rates and logs — without reading message content.
15. Check envelope counts: one per recipient device, no duplicates.
16. Stop the smoke. Remove nothing; leave the test conversation in place.
17. On a regression: roll the runtime back to `059803a` and **leave the column
    and index in place**.

## Release order

Only after P0 is accepted and merge is approved:

1. Confirm a current production backup or snapshot exists. **Currently
   unconfirmed** — the read-only tooling available in this session cannot see
   Railway's backup history, so this must be checked in the dashboard before
   anything else.
2. Re-verify `Message.clientMessageId`: type `text`, nullable, no default.
3. Re-verify `Message_senderUserId_clientMessageId_key`: unique, valid, ready,
   on `(senderUserId, clientMessageId)`.
4. Confirm schema parity — `prisma migrate diff --from-config-datasource
   prisma.config.ts --to-schema prisma/schema.prisma` reports no `Message` drift.
5. Confirm the merge gate passes: `npm run guard:message-delivery-p0`
   (typecheck, lint budget, `git diff --check`, all five P0 validations,
   `MESSAGE_TEST_DB_ISOLATION=PASS`, production build).
6. Confirm the browser integration passed in that same run — it is the gate that
   proves the path is wired, not merely that the layers compile.
7. Merge `p0-message-delivery` into `main`.
8. Controlled production deploy.
9. Smoke on a dedicated test account, never on a real user's conversation:
   - an ordinary send;
   - a send with the socket disconnected — an HTTP 2xx alone must show `sent`;
   - the same request replayed with the same `clientMessageId` — one message;
   - leave the conversation and return — nothing lost, nothing doubled;
   - reload — same;
   - confirm no duplicate appears in the recipient's view.
10. Check error rates and logs.
11. On a runtime regression: roll the runtime back. **Leave the column in
    place** — a runtime that does not know about it is unaffected by a nullable
    column.

## What ships

| Layer | File |
| --- | --- |
| Reconciliation (pure) | `src/lib/messages/reconcile.ts` |
| Durable pending storage | `src/lib/messages/pending-repository.ts` |
| Delivery controller | `src/lib/messages/delivery-controller.ts` |
| React binding | `src/app/(app)/chats/[chatId]/useMessageDelivery.ts` |
| Conversation wiring | `src/app/(app)/chats/[chatId]/ChatMessages.tsx` |
| Persist-before-clear | `src/app/(app)/chats/[chatId]/ChatComposer.tsx` |
| History page-size fix | `src/app/api/chats/[chatId]/messages/route.ts` |

## Gates

| Gate | Command |
| --- | --- |
| Reconciliation | `npm run validate:message-send-reconciliation` |
| Local persistence and delivery | `npm run validate:message-local-persistence` |
| Server idempotency (disposable DB) | `npm run validate:message-send-idempotency` |
| Browser integration, plaintext (disposable DB) | `npm run validate:message-send-browser` |
| Browser integration, E2EE (disposable DB) | `npm run validate:message-send-browser-e2ee` |
| Attachment delivery (disposable DB) | `npm run validate:message-attachment-delivery` |
| Hydration cleanliness (disposable DB) | `npm run validate:connection-notice-hydration` |
| Schema contract | `npm run validate:message-client-id-schema` |
| **Merge CI gate** — all of the above plus typecheck, lint budget, build | `npm run guard:message-delivery-p0` |
| **Production release gate** — the merge gate plus backup and production schema | `npm run guard:production-release` |
| Production schema alone (read-only) | `npm run verify:production-schema` |

The merge gate never touches production. Only the release gate does, and only
read-only.

The two database gates refuse to run unless the target database carries the
disposable marker in schema `nox_test_guard`. That refusal is a failed gate, not
a skip.
