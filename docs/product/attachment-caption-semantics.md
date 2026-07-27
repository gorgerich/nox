# Attachment captions — product decision

**Model A: a caption is a separate text message sent immediately after the
attachment.** It is not part of the media payload.

This is a decision, not a workaround left undocumented. Model B — carrying the
caption inside the encrypted media payload — would change the wire format for
encrypted media and belongs behind its own security review, not inside a
delivery fix.

## Why

The upload route refuses a caption on encrypted media:

```
Подписи к зашифрованным медиа пока не поддержаны.  // 400
```

That refusal is deliberate. The media path seals a per-file key for each
recipient device; the message body travels through the text envelope path. A
caption stored as a plain `body` next to encrypted media would be readable on
the server, which is exactly what the one-to-one conversation is supposed to
prevent. Sending it as its own encrypted text message keeps the caption under
the same protection as any other message.

## What this means in practice

| | Behaviour |
| --- | --- |
| One-to-one (encrypted) | media message, then a separate encrypted text message |
| Group (plaintext) | the caption travels with the upload as `body`, one message |
| Order | media first, caption second — always |
| Identity | two messages, two `clientMessageId`s |
| Retry of the media | re-sends the media only; the caption is untouched |
| Retry of the caption | re-sends the caption only; the media is untouched |
| Duplicate upload request | server recognises the media's client id and creates nothing |

Order is stable because both are handed to the delivery controller in sequence
and the controller's queue is FIFO: the caption is only accepted after the media
is durable, and the queue sends them in the order they were accepted. It is not
a timing coincidence.

Retry cannot duplicate a caption because the two messages are independent
entries with independent idempotency keys. A media retry replays the media's
`clientMessageId`; the server returns the already-committed media message and
never touches the caption. This is the concrete failure the model has to
survive — a retried upload that also re-posts its caption would leave the
recipient with the text twice.

## What the user sees

Two bubbles: the media, then the text underneath it. Not a single bubble with a
caption inside. If either fails, only that one shows as failed and only that one
is retried; the other is unaffected.

## Verified by

`npm run validate:message-attachment-delivery-e2ee` asserts, in a real
one-to-one conversation between two registered devices:

- a captioned upload produces exactly two messages;
- the media message comes first and holds the attachment;
- the caption follows as its own message with no attachment;
- the caption message is encrypted like any other text;
- the media message stores no readable body;
- the two carry different client ids;
- the caption is visible exactly once.

`npm run validate:message-attachment-delivery` covers the group case, where the
caption travels with the upload.

## If model B is ever wanted

It would need: a payload version bump, a decision about what a client that does
not understand the new field does with it, and a security review of the change
to the encrypted media format. None of that belongs in a delivery fix, and it
should not be done for cosmetic reasons.
