# E2EE history recovery — audit and design

Status: **design only.** No production crypto, schema or API change is proposed
for implementation by this document. Every claim below is cited to code in this
repository at the commit this document was added.

---

## 1. Root cause of message loss

**Reinstalling the app destroys the only copy of the device's private key, and
that key is non-extractable, so every message ever addressed to that device
becomes permanently undecryptable — even though the server still holds the
ciphertext.**

The chain, fact by fact:

1. **Message ciphertext is retained on the server indefinitely.**
   `Message` rows persist (`prisma/schema.prisma`, `model Message`) and carry
   `ciphertext`/`iv`/`salt`. There is a delete-after-delivery path in
   `src/app/api/messages/[messageId]/delivery-ack/route.ts`, but it is gated on
   `const ENABLE_E2EE_DELETE_AFTER_DELIVERY = false` (line 11), so envelope
   payloads are **not** currently erased after delivery.

2. **Payloads are sealed per recipient device, at send time.**
   `model MessageEnvelope` is keyed `@@unique([messageId, recipientDeviceId])`.
   `encryptMessageForDevices` (`src/lib/e2ee/utils.ts:107`) resolves the
   recipient's and the sender's *currently registered* devices and produces one
   envelope per device. A device that did not exist when the message was sent
   never receives an envelope.

3. **There is no backfill.** A repository-wide search for
   `backfill|re-encrypt|reencrypt|rekey` returns nothing. Registering a new
   device does not mint envelopes for historical messages, and it could not do
   so: the server cannot read the plaintext, and no existing device is asked to
   re-seal history for the newcomer.

4. **The device private key cannot be exported.**
   `generateKeyPair` (`src/lib/e2ee/crypto.ts:85`) creates an ECDH P-256 pair
   with `extractable = false`. Web Crypto will not release the private key in
   any format. It cannot be backed up, escrowed, printed, or copied to a new
   install — by construction.

5. **All client-side key material lives in one IndexedDB database.**
   `src/lib/e2ee/indexed-db.ts` defines `DB_NAME = "nox-e2ee"` holding the
   device keys (`keys`), the locally-encrypted plaintext cache (`messages`) and
   the per-chat ciphertext cache (`chatmsgs`). Uninstalling the app, clearing
   site data, or eviction under storage pressure removes this database.

**Therefore:** after a reinstall the user authenticates successfully, registers
a *new* device with a *new* keypair, and can exchange new messages normally —
but the historical envelopes are addressed to a key that no longer exists
anywhere in the universe. The server's ciphertext is intact and useless.

### 1.1 Consequence that must be stated plainly

History that has **already** been lost this way is **not recoverable**. No
backup design, including the one proposed here, can retroactively decrypt
envelopes whose target private key is gone. Any backup feature protects only
messages that exist from the moment it is enabled onwards. This must be
reflected honestly in the product copy; promising otherwise would be false.

---

## 2. Current storage map

| Data | Where | Survives reinstall? |
| --- | --- | --- |
| Message row, `type`, timestamps, reply/edit/delete markers | Server (Postgres, `Message`) | Yes |
| Message ciphertext per device | Server (`MessageEnvelope.ciphertext`) | Yes (delete-after-delivery is off) |
| Attachment blob (encrypted) | Server (`Attachment`) | Yes |
| Per-device media key | Server (`MediaKeyEnvelope.encryptedMediaKey`) | Yes |
| Device public key | Server (`DeviceKeyBundle`) | Yes |
| **Device private key** | **Client IndexedDB `nox-e2ee/keys`, non-extractable** | **No** |
| Local plaintext cache (encrypted at rest) | Client IndexedDB `nox-e2ee/messages` | No |
| Local cache key | Client IndexedDB, non-extractable | No |
| Cached server ciphertext | Client IndexedDB `nox-e2ee/chatmsgs` | No |

So the loss is **entirely a key-availability problem**, not a data-retention
problem. Both the sealed content and its metadata are still on the server.

---

## 3. E2EE key lifecycle (as built)

- On first use per user, `registerCurrentDevice` (`src/lib/e2ee/keys.ts:222`)
  generates an ECDH P-256 pair, stores it in IndexedDB, and uploads only the
  public half to `DeviceKeyBundle`.
- Sending derives a shared secret per target device and seals one envelope each
  (`encryptMessageForDevices`). The sender's own devices are included, which is
  why a sender can read their own history on their other devices — and why they
  cannot after a wipe.
- `E2EEDeviceTrust` records cross-device verification state.
- `Device.status` (`DeviceStatus`) supports revocation; `MediaKeyEnvelope` has
  `revokedAt`.

There is no long-lived symmetric "account key" and no ratchet state to
preserve: envelopes are sealed per message per device from ECDH. That is a
meaningful simplification for backup design — there is **no ratchet state that a
backup would have to capture**, and consequently no forward-secrecy loss from
omitting one.

---

## 4. Threat model

### Assets
Message plaintext; media plaintext; backup key; device identity keys; account
credentials; recovery key. (No session/ratchet state exists — see §3.)

### Adversaries and threats

| Threat | Current exposure | Must remain true after backup ships |
| --- | --- | --- |
| Server compromise / DB leak | Sees ciphertext, metadata, social graph, timestamps | Backup adds **no** plaintext; server cannot decrypt backup |
| Backup blob interception | n/a | Authenticated encryption; tampering detected |
| Weak password guessing | Password never yields message access today | Backup key must not be derived from the account password alone |
| Stolen unlocked phone | Full history (as designed) | Unchanged |
| Malicious new device | Cannot read history (that is the bug's flip side) | Must still require the recovery key or an explicit trusted-device approval |
| Backup rollback | n/a | Generation counter; client refuses older generation |
| Resurrecting deleted / expired messages | n/a | Tombstones and `expiresAt` applied **before** commit |
| Manifest substitution | n/a | Manifest authenticated under the same key |
| Recovery key loss | n/a | Honest, irreversible failure |
| Token theft | Access to metadata + ciphertext | Must not yield backup plaintext |

### Invariants (non-negotiable)

1. Server never receives plaintext or the backup key.
2. Backup key has ≥256 bits of RNG entropy; not derived from the account
   password alone.
3. A new install always creates a **new** device identity; the old identity is
   never cloned (and cannot be — §1.4).
4. Revoked devices receive no new backup material.
5. Deleted and expired messages are never resurrected.
6. Authenticated encryption; corruption and tampering are detected.
7. Restore is idempotent — replaying it never duplicates messages.
8. Losing the recovery key means the history is unrecoverable, and the UI says so.
9. No plaintext or key material in logs, analytics or error telemetry.

---

## 5. Architecture options

### Option A — server-side envelope backfill by a trusted device

When a new device registers, an existing logged-in device re-seals history for
it.

- *Pros:* no new key for the user to keep; reuses the existing envelope model.
- *Cons:* **does not solve the reported problem at all.** It requires the user
  to still own a working device. The reported scenario is a user who has
  exactly one device and reinstalls it. It also forces an online old device and
  scales as O(messages × new devices) of client work.
- *Verdict:* useful as a convenience path later; not a solution.

### Option B — client-side encrypted backup under a recovery key (recommended)

The client maintains a normalised local history and periodically uploads it,
re-encrypted under a `BackupMasterKey` that only the client ever holds. After a
reinstall the user enters the recovery key and the client decrypts locally.

- *Pros:* survives the single-device case, which is the actual failure; server
  stays ciphertext-only; independent of the message protocol, so no change to
  envelopes, no forward-secrecy impact (§3 — no ratchet to expose).
- *Cons:* the user must keep a recovery key; a backup snapshot is a second
  at-rest copy with a long-lived key, which is a genuinely weaker property than
  per-message ECDH envelopes.
- *Verdict:* recommended, with Option A added later as the convenient path when
  a second device is available.

### Why not "just derive the key from the password"
An account password does not have 256 bits of entropy, and the server sees a
password-derived verifier at login. Deriving the backup key from it would make
a server-side offline attack the fastest path to a user's entire history. If a
password-based path is ever wanted, it must use a memory-hard KDF with
client-side-only inputs and must be an explicit, separately reviewed decision.

---

## 6. Proposed backup format (draft)

Chunked, versioned, streamable — never one in-memory JSON blob.

```
BackupManifest (encrypted)
  schemaVersion, generation, createdAt, updatedAt
  chunkRefs[]: { chunkId, messageIdRange, authTag }
BackupChunk (encrypted, ~N messages)
  records[]: {
    messageId, chatRef, senderRef, createdAt, type,
    content,                      // re-encrypted plaintext
    replyToMessageId, editVersion, reactions,
    deletedAt, expiresAt,
    mediaRef: { attachmentId, fileKey },   // key travels inside the backup only
    schemaVersion
  }
```

- Primitive: **AES-GCM 256** via Web Crypto — already the project's primitive
  (`LOCAL_MESSAGE_CACHE_ALGORITHM = "AES-GCM"`, `indexed-db.ts:15`). No new
  dependency, no bespoke crypto.
- Unique nonce per chunk, derived from `(generation, chunkId)`; never reused.
- Per-chunk auth tag plus a manifest that authenticates the chunk list, so a
  dropped or swapped chunk is detected.
- `generation` is monotonic; the client rejects a manifest older than the one it
  last applied (rollback protection).

**Explicitly not backed up:** access tokens, session cookies, push tokens,
upload credentials, device private keys (impossible anyway), debug data,
plaintext previews.

**Media:** blobs stay on the server encrypted as they are today; only the file
key travels inside the encrypted backup. Missing, partially uploaded, deleted
and expired blobs must all be tolerated at restore.

---

## 7. Restore protocol (draft)

1. Normal login → register a **new** device (new keypair, as today).
2. Server reports "an encrypted backup exists" (metadata only: generation,
   updatedAt, size).
3. User supplies the recovery key (or approves from a trusted device, Option A).
4. Client downloads manifest + chunks, verifies auth tags **before** applying.
5. Decrypt locally, run schema migration, apply **transactionally**.
6. Drop records whose `deletedAt` is set or whose `expiresAt` has passed.
7. Deduplicate against messages already received on the new install.
8. Commit; only then mark restore complete.

Failure handling: a wrong key fails authentication and writes nothing; a corrupt
chunk is identified and the restore is resumable; newly-arrived messages are
never destroyed by a failed restore; the user can skip restore entirely.

---

## 8. Deletion and expiry

- Tombstones must propagate into the backup, not just the live store.
- Delete-for-everyone should remove the record from subsequent generations and,
  where possible, drop the chunk containing it.
- Honest limitation: **an encrypted blob already uploaded cannot be un-uploaded
  from a copy an adversary already holds.** Deletion is enforced by dropping
  the key and the record from future generations, plus server-side erasure of
  the stored object — not by mathematics.
- Disappearing messages must be filtered at restore by `expiresAt`, which
  already exists on `Message`.

---

## 9. Recovery key UX (draft)

`Настройки → Чаты → Резервная копия`, states: off / creating / on / last
successful copy / error / key unconfirmed / paused / restore available /
restoring / restored / corrupted / wrong key.

Copy must state plainly: the server cannot read the backup; support cannot
recover the key; without the key and without a trusted device the history is
gone; **the local cache is not a backup.**

Key handling: shown once, copyable, partial re-entry to confirm, never sent to
the server, never in `localStorage`, URLs, query params, crash reports or logs.

---

## 10. Rollout plan

Phase A (this document) → B: harden local persistence (`navigator.storage.persist()`,
quota/eviction handling, schema versioning, corruption recovery) **without**
claiming it solves reinstall → C: backup prototype behind a feature flag on
fixture accounts → D: security validation (ciphertext-only DB inspection,
wrong-key, tamper, rollback, expiry/tombstone, interrupted restore,
large-history performance, independent review) → E: opt-in beta with metrics
that contain no plaintext.

Rollback: the feature flag disables backup upload and restore; because backup
lives in its own tables and its own key domain, disabling it cannot affect
message delivery or the existing envelope path.

---

## 11. Open questions

1. Do we accept a long-lived key over a snapshot as the price of single-device
   recovery? (Security-vs-recoverability call — product decision.)
2. Retention: keep all generations, or only the newest?
3. Group chats: whose backup owns a shared conversation's copy?
4. Should backup default on for new accounts, or stay explicitly opt-in?
5. Server-side storage quota and abuse limits for backup blobs.
6. Is a platform-keychain-assisted path (iOS Keychain / Android Keystore) worth
   it given it cannot be relied on cross-platform or after uninstall?

---

## 12. Immediate, separate recommendation

Independently of backup, the current failure is silent: a reinstalled user sees
an empty history with no explanation. A small, low-risk change is worth doing
before any of the above — detect that the server has envelopes this device
cannot decrypt and explain it, rather than rendering an empty chat. That is a
presentation change only and does not touch the protocol.
