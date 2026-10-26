# Messenger audit follow-up

Date: 2026-10-26. This review extends the product-wide UI review in `docs/design/apple-product-audit-20260905.md` and the media/call follow-up in `docs/design/ux-ui-audit-20260927.md`.

## Scope

Reviewed the app route inventory and existing phone/desktop, light/dark captures; traced the main client flows for chats, search, contacts, calls, profile/settings, group and direct chat details, media, onboarding/auth, admin, safety and navigation. Re-inspected session validation, registration/invite redemption, password recovery, message history/send, attachment authorization/download, E2EE envelope ownership, and Socket.IO membership/call signaling. This is a focused code and UX audit, not a formal cryptographic review or a production incident assessment.

## Findings fixed

| Severity | Area | Finding and impact | Change |
| --- | --- | --- | --- |
| High | Invite registration | Invite availability was read and then incremented non-conditionally. Concurrent sign-ups could both pass the same `maxUses` check and oversubscribe a supposedly limited invite. | Registration now reserves usage with a conditional database increment requiring active status, remaining capacity, and a non-expired invite. A failed reservation rolls back user creation. The final reservation marks the invite used. |
| High | Account recovery | Password reset through an approved recovery request changed the password but did not revoke registered devices or their E2EE key bundles, unlike token-based reset. Old devices could remain trusted after account recovery. | The approved-reset transaction now revokes active devices and their key bundles together with the password change and recovery-request claim; the audit log records that revocation. |
| Medium | Call signaling | Video renegotiation answers checked call ID and participant but skipped the active-chat-membership check present on the offer path. A participant removed from the chat could still signal on a live call. | The answer relay now rechecks active membership before forwarding. |
| Medium | Message/media actions | Pointer capture on touch-down could retarget a tap away from nested media/file controls, making valid actions feel dead. | Pointer capture is deferred until a horizontal reply swipe is recognized; ordinary taps remain targeted at their controls. |
| Medium | Shared media | Shared-file rows and broken media had incomplete failure/retry behavior, and media errors could leave users without a useful next action. | Shared media now exposes working downloads, validates and decrypts the fetched blob, and offers retry states. Chat media/download paths have explicit timeout, HTTP/empty-file and retry handling. |
| Medium | Calls/video notes | Duplicate delivery of an active incoming call could be interpreted as another call; camera switching/closing during acquisition could discard a clip or leak a late stream. | Duplicate call delivery is ignored for the active call. Camera changes are confirmed before replacing a recording, and streams acquired after close are stopped. |
| Medium | Call UI | Audio calls rendered an unnecessary camera surface; video/call identity and controls could collide or sit below the viewport. | Audio and video layouts are separated, call controls are viewport-safe, and remote identity stays in the compact top bar. |
| Low | Chat header | Backdrop blur reduced legibility over chat actions and identity. | Removed the blur behind the header's readable content while preserving compact chrome. |

## Screen and journey map

| Journey / screens | Primary review focus | Current remaining risk |
| --- | --- | --- |
| Sign-in, invite join, forgot/reset password | Error clarity, rate limits, recovery trust, session invalidation | Rate limits are process-local; multiple app instances do not share one counter. Reset behavior needs end-to-end production configuration review. |
| Chats, folders, archive, new chat, search | Density, priority/status scanning, empty/loading states, one-handed navigation | Very large chat/folder lists still need production-scale data and memory profiling. |
| Contacts, public user, direct profile | Contact/chat independence, add/search actions, identity hierarchy | Contact import and blocked-user edge cases are not covered by the captured happy-path fixtures. |
| Conversation, composer, reactions, media viewer | First paint, safe-area/keyboard fit, tap vs swipe, upload/download error recovery | Large files on constrained networks and media opened from every message type need device-level soak coverage. |
| Group conversation and group profile | Membership actions, shared files/media, roles, title/avatar hierarchy | Large groups and concurrent role changes require production-scale validation. |
| Calls and incoming-call recovery | Signaling authorization, lifecycle, controls, foreground/background transitions | Browser/WebRTC checks do not prove APNs delivery, CallKit, process suspension, route changes, or camera behavior on physical iPhones. |
| Profile, settings, devices, appearance, folders | Shared hierarchy, readable settings rows, device trust | Assistive technology and Dynamic Type still require VoiceOver and native WebView checks. |
| Admin | Mobile reachability, section visibility, action hierarchy | Large admin datasets need server pagination and production authorization review. |
| Safety and E2EE disclosures | Accuracy of claims and separation of direct/group/call guarantees | No independent cryptographic audit has been performed. Do not expand security claims based on UI review alone. |
| Global navigation, sheets, empty/error states | Stable dock, root-return behavior, focus and scroll continuity | Physical iOS safe-area, keyboard, reduce-motion and reduce-transparency behavior remain release checks. |

## Security and reliability notes

- Session verification checks JWT signature/expiry, role shape, current user status, and a credential stamp derived from the stored password hash.
- Chat message history and attachment downloads check active membership; E2EE message/device envelopes are ownership-checked and filtered to the requesting user.
- Message history is cursor-paginated and bounded. Message and attachment creation have rate limits and size/type validation.
- Socket authentication uses the session cookie; chat room joins and call participants are checked server-side. Origin checks are configured for WebSocket connections.
- Rate limiting currently uses an in-memory map and therefore is not a distributed control across multiple processes/restarts. Deployments with more than one app process should move these buckets to a shared store before relying on the limits as a hard abuse boundary.
- The account-recovery public code is 48 bits and rate-limited, but its request-based reset is intentionally a separate flow from email token reset; recovery UX and operations should be reviewed against the actual deployment's trust-device process.
- The reset flows revoke authentication by changing the password-backed session stamp. The approved flow now also revokes E2EE devices and key bundles, matching the token-based reset.

## Verification boundary

No test suite was run in this audit pass. Existing visual captures and prior seeded browser runs were reviewed as evidence, not re-counted as fresh verification. Run `npm run lint` and `npm run build` before release. Physical-device checks still required: iOS background/cold-start call acceptance, APNs/CallKit, front/back camera transitions, VoiceOver/Dynamic Type, keyboard/safe-area changes, and weak-network/large-media retry. A formal E2EE design and implementation review remains separate work.
