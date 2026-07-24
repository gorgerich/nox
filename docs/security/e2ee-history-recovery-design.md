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
backup would have to capture**.

For what that does and does not imply about forward secrecy, see ADR-1 (§3.1),
which supersedes an earlier, incorrect claim in this document that "forward
secrecy is not affected".

---

## 3.1 ADR-1 — Forward secrecy of the current transport

**Decision: record the true property of the transport before reasoning about
what a backup costs. Do not change the transport in the backup work.**

### Finding

The current envelope scheme has **no forward secrecy and no post-compromise
security.**

Evidence:

- `encryptEnvelope` (`src/lib/e2ee/utils.ts:61`) derives the message key from
  `params.senderPrivateKey` — the device's **long-term, static** ECDH private
  key — against the recipient device's **static** public key from
  `DeviceKeyBundle`. No ephemeral key pair is generated per message or per
  session.
- `deriveAesKey` (`src/lib/e2ee/crypto.ts:124`) computes
  `ECDH(static_sender, static_recipient)` and runs it through
  `HKDF-SHA256(salt, info)` to get the AES-GCM key.
- The per-message `salt` and `iv` are stored **in the clear**, next to the
  ciphertext, in `MessageEnvelope.salt` / `MessageEnvelope.iv`.

The random per-message salt gives key *separation* — each message has a
distinct AES key — but it is not secret. The ECDH shared secret underneath is
identical for a given device pair for the lifetime of those keys.

### Consequences

1. An adversary holding a device's static private key **and** the server's
   envelope rows can recompute the shared secret, re-derive every per-message
   key (salt and info are available to them), and decrypt **all past messages**
   addressed to that device. This is the definition of lacking forward secrecy.
2. There is no ratchet, so a compromised device key also decrypts **future**
   messages to that device until the device is revoked and keys are rotated —
   no post-compromise security.
3. Practically the private key is non-extractable (§1.4), which raises the bar
   for extracting it from a live browser, but non-extractability is a platform
   containment property, not a cryptographic one, and it does not apply to an
   attacker with a platform-level compromise.

### Implication for the backup decision

The honest framing is therefore **not** "the backup introduces a long-lived key
into a forward-secret system". It is:

- the transport E2EE is **unchanged** by this work;
- the backup adds a **separate, long-lived archival key domain**;
- compromise of the Backup Root Key exposes the archived history it covers;
- this is a deliberate trade-off accepted in exchange for recoverability;
- and it is a **smaller marginal regression than it first appears**, because
  the transport already exposes all history to a static-key compromise.

That is an argument for accepting the backup trade-off, **not** an argument that
the transport is fine. Adding ephemeral/ratcheted key agreement to the transport
is worth its own ADR and its own change; it is explicitly **out of scope** for
the backup work and must not be bundled into it.

### Follow-up

Open a separate track to evaluate ephemeral-sender-key or double-ratchet key
agreement for the transport, with its own threat model and migration plan for
existing envelopes.

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
| Backup rollback | n/a | Partially mitigated — see §6.4; not fully solved in MVP |
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
- Per-chunk auth tag plus a manifest that authenticates the chunk list, so a
  dropped or swapped chunk is detected.

### 6.1 Key hierarchy

A single master key is **not** used to encrypt everything. Four levels:

```
Recovery Secret            (shown to the user once; never leaves the client)
  └─ wraps → Backup Root Key      (random 256-bit; long-lived; never sent to the server)
       └─ wraps → Generation Key  (random 256-bit; fresh for every generation)
            └─ encrypts → manifest + chunks of that generation
```

- The Recovery Secret is stretched with a memory-hard KDF before it wraps the
  Root Key, so a written-down secret is not directly a key.
- The server stores only: wrapped Root Key material, wrapped Generation Keys,
  and ciphertext. It never sees the Recovery Secret, the Root Key or a
  Generation Key in the clear.
- Rotating the Recovery Secret re-wraps the Root Key only — no re-upload of
  history.
- Device identity keys and transport secrets are **never** part of the backup;
  the device private key could not be included even if we wanted it (§1.4).
- No key material may appear in URLs, `localStorage`, analytics, logs or crash
  reports.

### 6.2 Nonce construction

AES-GCM is catastrophically broken by a repeated (key, nonce) pair, so nonces
are **deterministic and counter-based**, not random:

```
nonce(96 bit) = generationEpoch(32) ‖ recordKind(8) ‖ counter(56)
```

- A **fresh random Generation Key per generation** means counters restart safely
  at every generation — the (key, nonce) pair can never repeat across
  generations because the key differs.
- `counter` is the chunk index within the generation (and a sub-counter for the
  manifest), assigned monotonically by the writer.
- `recordKind` separates manifest from chunk so the two can never collide.
- This avoids relying on random 96-bit nonces, where birthday-bound collision
  risk grows with the number of payloads under one key.
- A generation is written by exactly one client at a time (server-side
  in-progress lock), so counters cannot be issued twice for one key.

**Rule:** a (Generation Key, nonce) pair is used exactly once. A writer that
cannot prove which counters it already used must start a new generation with a
new key rather than guess.

### 6.3 AAD schema

Every AES-GCM operation binds its full context, so a valid ciphertext cannot be
replayed into a different position, generation or account:

```
AAD = {
  backupId,
  accountBinding,      // opaque, non-reversible account reference
  generation,
  chunkIndex,          // manifest uses a reserved sentinel
  schemaVersion,
  recordKind,          // "manifest" | "chunk"
  prevManifestHash     // present from the second generation onwards
}
```

Serialised canonically (fixed field order, length-prefixed) so the AAD bytes are
unambiguous.

### 6.4 Rollback protection — what is and is not guaranteed

An earlier draft claimed the encrypted generation counter gives rollback
protection. That is **not true for the case that matters**: a client that has
just been reinstalled has no memory of the last generation it saw, so a
malicious server can serve an older complete generation and the client has
nothing to compare it against.

Splitting the guarantee honestly:

**Covered by the MVP**

- corruption and truncation — AEAD tags on manifest and chunks;
- accidental rollback and write races — server-side **monotonic generation
  constraint**: a generation number may never decrease, and only one
  in-progress generation may exist per account;
- serving an unfinished generation — a generation is only selectable once its
  `completed` marker is set, and activation is transactional;
- chunk substitution across generations — `generation` and `chunkIndex` are in
  the AAD;
- reordering the history of generations — each manifest carries
  `prevManifestHash`, so a chain break is detectable when the client has any
  prior reference point;
- replay of an already-applied generation — restore is idempotent by stable
  message ID.

**Not covered by the MVP**

> An actively malicious or fully compromised server can serve the
> *previous complete generation* to a client that has lost **all** local state
> and has no other trusted device. That client cannot detect the rollback,
> because it holds no prior reference point. The result is a stale but
> internally consistent history — messages after that generation are missing.

This is a real, accepted limitation. It cannot be closed without a trust anchor
outside the server.

**Follow-up options (not in MVP)**

1. Latest-generation receipt retained on a second trusted device.
2. Receipt handed over during trusted-device restore.
3. Receipt mirrored into platform secure sync as an *additional* factor — never
   the only one, since it is unavailable cross-platform and after uninstall.
4. A transparency log with external witnesses, if the threat model ever
   genuinely warrants that cost.

Until one of these ships, the documentation and UI must not claim full rollback
protection.

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
