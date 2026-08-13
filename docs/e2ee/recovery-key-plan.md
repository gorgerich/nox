# Recovery key: keeping history across devices without giving up E2EE

Decided after asking whether nox could work "like Telegram or Signal". The two
answers differ, and the difference is the whole design:

- **Telegram's ordinary cloud chats are not end-to-end encrypted.** Telegram
  holds the keys, which is exactly why history appears instantly on any device.
  Its Secret Chats *are* E2EE — and they are device-bound and do not sync, the
  same limitation nox has today.
- **Signal is E2EE and device-bound.** History moves to a new device through a
  recovery code the user keeps. That code is the bridge.

There is no third answer. Either the server cannot read messages — and then
restoring on a new device needs a secret only the user holds — or history is
everywhere instantly and the server holds the keys.

**Chosen: Signal's shape.** nox is sold as a private E2EE messenger; the server
must not be able to read a message. Existing history is re-encrypted where a
live device can still open it.

## The problem this fixes

The device private key lives in IndexedDB, which is evictable — iOS Safari
clears an origin's script-writable storage after about a week without
interaction. Each eviction mints a new device id, and a new device cannot open
anything sealed before it existed.

Production census, `scripts/diagnose-message-integrity.ts`, 2026-08-13:

```
  E2EE key bundles: 66 total, 61 not revoked
    devices per user  1dev:3users  3dev:2users  4dev:3users  5dev:1users  35dev:1users
  encrypted messages with zero envelopes: 24   (2026-05:4  2026-07:19  2026-08:1)
  empty messages: 0        media messages with no attachment: 0
```

Thirty-five devices for one user is one browser losing its store over and over.
The same census disproved two theories worth recording: there is **no** data
loss — no empty message rows, no media rows missing their attachment.

## Design

**The device key is not touched.** `generateKeyPair` creates it with
`extractable: false`, so page script cannot exfiltrate it. Backing *that* key
up would mean making it extractable, trading away a property the product
already has. It stays as it is.

**A recovery keypair per account**, private half extractable, sealed under a
passphrase with PBKDF2-SHA256 at 600k iterations and AES-GCM
(`src/lib/e2ee/key-backup.ts`, already written). The server stores ciphertext,
never the passphrase or the key.

**Every envelope gains one recipient.** Messages are sealed to each live device
key *and* to the recovery public key. A restoring device fetches the sealed
recovery key, opens it with the passphrase, and reads history through it.

**No operator escrow.** A forgotten passphrase means lost history. An escrow
the operator could open would make the end-to-end claim false.

## Remaining work, in order

1. **Schema.** `AccountRecoveryKey`: `userId` unique, `publicKey`, `ciphertext`,
   `iv`, `salt`, `kdf`, `iterations`, `algorithm`, timestamps. Migration written
   but **not applied to production** without a separate decision.
2. **Recovery keypair generation** — the same ECDH P-256 curve as device keys,
   `extractable: true` for the private half only.
3. **Envelope creation.** The heart of it: every send path adds the recovery
   public key as a recipient. This touches message delivery, so the E2EE suites
   are the gate.
4. **Routes.** `POST/GET/DELETE /api/e2ee/recovery-key`, owner-only.
5. **UI.** Set up a passphrase in the security screen; prompt to restore when a
   device finds a recovery key it has not opened. Both must state plainly that
   the passphrase cannot be recovered and that history sealed before setup
   stays unreadable.
6. **Re-encryption of existing history.** On first login from a device that can
   still open a message, re-seal it to the recovery key. Bounded, resumable,
   and skipping what it cannot open.
7. **`validate:e2ee-recovery`** — the proof: send encrypted messages, set a
   passphrase, wipe IndexedDB to simulate eviction, restore on the new device,
   read the history back. This is the suite that decides whether the feature
   works.

## Two constraints on the way

Migrations are under a standing restriction, so step 1 stops at a written
migration. And the merge gate cannot currently run to completion on this
machine under load — `release-guard.mjs` now waits for the load average to fall
before the browser suites, which is the fix on nox's side.
