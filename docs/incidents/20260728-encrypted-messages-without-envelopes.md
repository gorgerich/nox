# 25 encrypted messages in production have no envelope

```
STATUS:      OPEN — not investigated, not fixed
SEVERITY:    data-level; those messages cannot be decrypted by anyone
IN SCOPE OF: nothing yet. Deliberately not touched by the UI release.
```

## What was observed

While verifying the post-commit hotfix deploy (`c12cc5e`), a read-only query
against production found:

```sql
SELECT count(*) FROM "Message" m
 WHERE m."isEncrypted" = true AND m."encryptionVersion" = 2
   AND NOT EXISTS (SELECT 1 FROM "MessageEnvelope" e WHERE e."messageId" = m.id);
-- 25
```

| | |
| --- | --- |
| count | 25 |
| oldest | 2026-04-28T20:30:50Z |
| newest | 2026-07-28T08:33:37Z |
| messages created after the hotfix deploy (18:25Z) | 0 |

A v2 encrypted message carries no readable body: the ciphertext lives in the
per-device envelopes. A message with none is unreadable by every device,
including the sender's. It will render as an undecryptable bubble forever.

## What this is not

It is **not** caused by the post-commit hotfix. Every affected row predates that
deploy, the newest by ten hours, and the hotfix does not touch envelope
creation. It was found *because* of the deploy verification, not created by it.

## What is not known yet

- whether the envelopes were never written or were deleted later;
- whether a specific client version, a failed partial write, or device
  revocation cleanup produced them;
- whether the affected messages cluster in one chat, one sender, or one date;
- whether anything still produces them — the newest is recent enough that
  "already stopped" cannot be assumed.

## Deliberately not done

No historical data was touched. Repairing or deleting these rows is a
data-changing operation on production that needs its own decision, its own
backup check and its own gate — not a side effect of a UI release.

## Suggested first step

A read-only breakdown by chat, sender, date and client version, to establish
whether this is a closed historical incident or an open leak. Only then decide
what, if anything, should happen to the rows.
