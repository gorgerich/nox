# Nox UX/UI audit follow-up

Date: 2026-09-27. This is a follow-up to [the product-wide audit](apple-product-audit-20260905.md), not a claim that every hardware or network state has been exhaustively exercised.

## Scope and method

- Reviewed 68 browser frames: 17 routes across 390x844 phone and 1280x900 desktop, light and dark. The routes cover chats, direct and group conversations, new chat, search, archive, contacts, calls, profile, direct and group details, public user, safety, admin, and public authentication.
- Inspected the chat header, message media, shared-media tabs, video-note recorder, call provider, and call overlay as connected flows rather than isolated screens.
- Ran seeded browser interactions against a disposable database for file downloads, media retries, camera switching, and two-client audio/video calls.

## Findings and changes

| Area | Finding and impact | Change | Verification |
| --- | --- | --- | --- |
| Conversation header | Blur sat over identity and actions, weakening contrast on every chat open. | Removed the blur from the text/action layer while retaining the existing compact chrome. | Phone/desktop frames in both themes. |
| Message media | Failed images could remain loading and the full-screen viewer gave no useful error; downloads could save an HTTP error response. | Bounded encrypted-media loading, explicit retry/error states, response and empty-file checks for chat files and the viewer, and reset viewer errors on close. | Chat-file failure/retry, shared-media retry, and frame review. |
| Message gestures | Capturing the pointer on touch-down retargeted taps away from buttons inside messages, making file and media actions appear dead. | Capture only after a horizontal swipe is recognized; keep ordinary taps on their original targets. | Chat-file failure/retry test and existing conversation swipe behavior review. |
| Shared media | Files in both profile types were dead `#` links; audio attachments were omitted. An unencrypted thumbnail's Retry did not restore its source. | The shared API now includes file URLs and encryption metadata. File/audio rows download the actual blob, encrypted media is decrypted for the current device, and retry re-requests the source. | Seeded group and direct file downloads, audio visibility, failed-list retry, and failed-thumbnail retry. |
| Video notes | Switching camera while recording silently discarded the active clip; closing during camera acquisition could leave an active stream. | Switch asks for confirmation before restarting the clip; Cancel preserves recording. Late streams are stopped after close. | Fake-device capture, cancel, and confirm browser test. |
| Call delivery | A duplicate invite for the same `callId` was treated as a second call and declined as busy, ending the first call. | Ignore duplicate delivery of the already-active call. | Two-client audio/video regression with a stability interval. |
| Call layout | A fullscreen camera surface and dark gradient could cover call information or leave controls under the viewport; audio calls unnecessarily rendered a video surface. | Anchored overlay to dynamic viewport, made audio camera-free, kept controls above video, and moved remote-video identity to the top bar. | Two-client audio/video viewport and control assertions plus rendered frames. |

## Visual and interaction rules checked

- Content and controls remain visible without entrance-animation completion; no new opacity-zero first-paint dependency was added.
- Dense lists have no new hard shadows or decorative glow. Glass remains on transient chrome, not message text.
- Interactive rows are actual buttons or links, with a visible failure state and a usable retry path. No placeholder `href="#"` remains in shared-media tabs.
- Filenames truncate within their row, controls have stable tap areas, and bottom chrome remains clear of the profile content at the phone viewport.
- Reduced-motion, reduced-transparency, light/dark, small-screen, and real-device behavior remain release checks, not assumptions from one screenshot.

## Remaining release checks

- Confirm front/back camera switching on an iPhone: browser fake devices prove the control flow, not hardware camera availability. Mid-recording switching restarts the clip by design; seamless same-clip switching is not implemented.
- Test foreground/background, cold-start push acceptance, CallKit, speaker routing, and video PiP on two physical iPhones. The browser regression does not validate iOS process suspension or APNs.
- Test large encrypted video/file attachments over slow and interrupted networks, including devices missing an E2EE media envelope. Those states now show failure rather than an endless or broken-looking preview, but the full matrix needs production-like fixtures.
- Monitor group member lists, archive, and admin with large data sets. Current route frames use small seeded fixtures and do not establish thousand-item performance.
