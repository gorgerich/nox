# Security audit - 2026-07-15

## Scope

Source-level review of the Next.js API, Socket.IO signaling server, authentication,
authorization, recovery, uploads, push notifications, E2EE key exchange, Prisma
access patterns, and the Capacitor iOS wrapper. The review used an OWASP API Top
10 threat model and the local Anthropic Cybersecurity Skills guidance. No attacks
were run against production and no production data was accessed.

## Fixed findings

### Critical and high

- **Cross-user chat clearing:** clearing a dialog globally soft-deleted every
  participant's messages. Clearing now records a per-member `clearedAt` boundary.
  History, previews, unread counts, search, shared media, forwarding, pinned
  messages, and attachment downloads respect that boundary.
- **Stale realtime sessions after password reset:** Socket.IO now verifies a
  password-derived credential stamp in addition to the JWT signature. A reset or
  admin revocation invalidates reconnects made with an old session token.
- **Admin privilege boundaries:** only the owner can grant or remove admin rights.
  Admins can manage members, but cannot act on themselves, other admins, or the
  owner. UI actions now match server authorization.
- **E2EE key injection and oversized envelopes:** device public keys and key
  bundles are restricted to public P-256 JWKs, private key material is rejected,
  and envelope fields/counts have strict limits. Browser private keys are now
  generated as non-extractable keys.
- **Key-bundle enumeration:** a user may fetch another user's bundle only for
  themselves or an active direct-chat peer.

### Medium

- Mutating API requests now require same-origin browser context, reducing CSRF.
- Recovery codes have more entropy, old requests/tokens are invalidated, and
  approval/reset transitions use atomic single-use claims to prevent races.
- Push subscription payloads, URLs, and lengths are validated. Notification click
  URLs cannot navigate outside the application origin.
- Socket origins are allowlisted; payload size, signaling size, queue length,
  call frequency, typing frequency, active calls, and call lifetime are bounded.
- Message, attachment, invite, chat-request, and push-subscription creation have
  abuse limits.
- Attachment responses are private and non-cacheable, and locally cleared media
  can no longer be fetched by a retained attachment URL.
- COOP, CORP, HSTS, and existing security headers are applied at the application
  boundary.
- Product copy no longer claims group chats are end-to-end encrypted. Current
  guarantees are stated accurately on the safety page and in new direct chats.

## Verification

- TypeScript strict check: passed.
- ESLint on all changed executable files: passed with no new warnings.
- Prisma schema validation and client generation: passed.
- Production dependency audit: 0 known vulnerabilities.
- Node syntax check: passed.
- Next.js production build: passed.
- Unsigned iOS simulator build: passed with Xcode 16.2.

## Residual risks

- Rate limits are process-local. Move counters to Redis or PostgreSQL before
  running multiple Railway replicas; otherwise each replica enforces its own
  allowance.
- Group messages are not end-to-end encrypted. Transport encryption is not a
  substitute for group E2EE.
- Browser E2EE keys live in IndexedDB/CryptoKey storage. Non-extractable keys
  reduce export risk but same-origin script compromise can still invoke them.
  XSS prevention and dependency hygiene remain essential.
- A stricter nonce-based Content Security Policy needs a dedicated Next.js
  bootstrap implementation. Enabling a naive strict CSP would currently break
  framework scripts.
- Runtime multi-account tests with Burp/Objection and physical-device background
  call tests were outside this source-only pass and should be part of a release
  security test environment.

## Deployment note

`prisma/deploy.sql` is intentionally idempotent. Railway applies it before the
Node server starts so the per-member clear boundary exists before code queries it.
