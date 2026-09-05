# Nox product and interface audit

Date: 2026-09-05

## Product standard

Nox keeps its existing quiet blue identity, native system typography, rounded geometry, and compact mobile navigation. The pass applies Apple-style interaction principles without copying another messenger:

- content is visible on first paint and never waits behind an entrance animation;
- navigation and swipe gestures track the pointer 1:1, then settle from projected velocity;
- controls preserve a minimum 44pt hit area even when the visual footprint is compact;
- glass is reserved for transient chrome and sheets, with tonal surfaces for dense content;
- all fixed chrome uses real viewport and safe-area insets;
- reduced motion, reduced transparency, high contrast, keyboard focus, and screen-reader labels remain functional;
- security copy states the implemented guarantees instead of making broader E2EE claims.

## Page-by-page audit

| Area | Problem and daily impact | Frequency | Implemented change | Verification | Remaining risk |
| --- | --- | --- | --- | --- | --- |
| App shell | Bottom dock moved after hydration and could overlap content. This made every first launch feel unstable. | Every app open | Fixed viewport anchoring, stable safe-area clearance, shared shell tokens, and route-aware visibility. | Dock first-paint suite: 0px movement across direct load, reload, navigation, rotation, keyboard, and light/dark. | Real-device standalone PWA still needs release-candidate smoke testing. |
| Navigation | Tabs only felt responsive after route completion and swipes did not follow the finger. | Every section change | Added immediate press feedback, pointer capture, 1:1 drag, edge resistance, velocity projection, and critically damped settling. Re-tapping the active section returns to its root. | Press-feedback and accessibility suites pass. | Trackpad and Voice Control should be checked on the final production build. |
| Chats | Header consumed too much space, rows had hard visual separation, and message state was hard to scan. | Highest-frequency screen | Removed redundant search, tightened title/filter/list rhythm, removed row shadows, preserved sender/status hierarchy, and retained folder counts only where useful. | Light-canvas and 68-frame visual audits pass. | Dense production names in mixed scripts require ongoing snapshot coverage. |
| Chat row actions | Gesture threshold, cancellation, and release behavior felt brittle. | Frequent for power users | Rebuilt reveal interaction around pointer capture, axis locking, resistance, velocity projection, and deterministic open/close anchors. | Pointer and touch behavior covered by interaction tests and visual inspection. | Destructive actions still require a real-device long-session test. |
| Conversation open | Route loading could show stale cached content, a skeleton, or a blank conversation before live data arrived. | Every chat open | Replaced the route placeholder with a RAM-backed instant frame and removed blank/screenshot-style loading states. Content is visible by default. | Conversation-open suite confirms newest message on first paint, 0px bottom offset, no extra history request, CLS 0.001. | A cold device with no cache still depends on server latency, but no false old-message frame is shown. |
| Conversation header | Oversized glass blocks, redundant lock action, clipped text, and unstable action widths reduced message space. | Every conversation | Constrained header height, removed the duplicate lock action, separated identity and call actions, centered titles, and protected narrow-width truncation. | Phone and desktop screenshots in both themes pass. | Very large accessibility text should be checked on native iOS WebView. |
| Messages | Async connectivity effects could flash or update state synchronously. | During reconnects | Added lazy online initialization, timer-safe notice transitions, stable message geometry, and truthful delivery presentation. | TypeScript, lint, message/open regressions pass. | Multi-device ordering conflicts are a backend behavior, not a visual-only issue. |
| Composer | Extra backing slab, emoji overflow, and fixed chrome could consume message space. | Every message | Removed the redundant slab, stabilized composer dimensions, constrained emoji surfaces, preserved keyboard-safe spacing, and reduced shadows. | Composer screenshots and keyboard dock tests pass. | Third-party iOS keyboards require manual smoke testing. |
| Search | Search was duplicated and did not consistently feel like a focused workflow. | Frequent | Kept one bottom entry point, autofocuses the field, preserves recents and recent queries, and uses a fast origin-aware transition without hiding content. | Search light/dark phone/desktop frames pass. | Hardware-keyboard Escape behavior should remain in regression coverage. |
| Contacts | Header action and list density did not match the task. | Frequent | Replaced the redundant search affordance with add, standardized row hierarchy, and kept contacts independent from deleted conversations. | Route audit and contact regressions pass. | Contact import is outside this pass. |
| Calls | Per-row call buttons duplicated the row action; call overlays used heavy glow and unstable grids. | Frequent | Made the row itself the call target except the info action, normalized call control grids, removed decorative glow, and clarified WebRTC transport protection. | Calls and incoming-call frames pass. | Background/cold-start calling still requires a two-device production test with APNs and CallKit lifecycle. |
| Profile | Large hero and tall rows hid logout/admin actions behind the dock. | Daily | Reduced vertical rhythm while preserving 52pt row targets; all primary settings and account actions now fit cleanly. | Final 390x844 light/dark frames pass. | Long localized subtitles should be monitored. |
| Settings | Every sub-screen used slightly different rows, headers, toggles, and spacing. | Daily | Introduced shared screen, group, navigation row, value row, action row, and toggle primitives. | Full settings polish suite passes in both themes, including nested screens and 320px width. | New settings must use the primitives rather than adding local variants. |
| Partner profile | Edit action clipped, hero was oversized, encryption detail competed with identity. | Occasional | Added symmetric action lanes, compact identity/actions, moved security detail to contextual disclosure, and retained media tabs. | Final narrow phone frame shows the complete Edit action. | Contact nickname and delete flows need backend integration coverage. |
| Group profile | Duplicate title/member metadata and duplicate add/rename actions slowed scanning. | Occasional | Removed sticky duplicates, kept rename in actions and add-participants in the member list, and tightened member/media layout. | Phone/desktop light/dark frames pass. | Very large member lists should be virtualized when scale requires it. |
| Public user profile | Actions and avatar presentation differed from in-chat profiles. | Occasional | Reused avatar tint, compact hierarchy, and consistent direct-chat action geometry. | Route audit passes. | Blocked-user states need dedicated fixtures. |
| New chat and archive | Secondary flows used inconsistent headers, empty states, and sheets. | Occasional | Standardized compact headers, list geometry, empty states, and archive introduction sheet. | Route audit passes. | Large archives need performance fixtures. |
| Authentication | Decorative gradients, glow, and oversized cards weakened trust and contrast. | Every sign-in/onboarding | Removed generic gradients and logo tile, used restrained system surfaces, stable fields, terse copy, and accessible focus states. | Login, join, forgot, and reset routes pass lint/build and visual audit. | Password-manager and passkey flows are future product work. |
| Admin | Mobile actions could overflow and test captures could preserve stale scroll positions. | Admin-only | Made sections horizontally safe, tightened user/action rows, preserved dock access, and normalized audit capture to scroll origin. | Phone/desktop light/dark frames show no clipping or blind zones. | Large data sets should move to server pagination or virtualization. |
| Safety | Marketing-style cards obscured precise guarantees and groups/calls were overstated. | Trust-critical, occasional | Rebuilt as a compact help screen. Personal chats, groups, calls, devices, cache, and reporting are described separately and accurately. | Copy and visual audit pass. | Formal cryptographic review is still required before expanding guarantees. |
| Loading and empty states | Oversized placeholders and animated opacity could create blank screens. | Any slow route | Content remains visible by default; skeletons use final geometry and empty states are compact and task-specific. | Route loading and visual frame audits pass. | Slow 2G behavior should be monitored with production telemetry. |

## Component inventory

- Shell: `AppShellChrome`, `AppBottomDock`, route motion container.
- Lists: compact row, avatar, primary/secondary metadata, status, swipe actions.
- Conversation: `ChatHeader`, `ChatMessages`, composer, emoji/media surfaces, connection notice.
- Settings: `SettingsScreen`, `SettingsGroup`, navigation/value/action/toggle rows.
- Overlays: sheets, dialogs, call overlay, incoming-call resume, avatar viewer.
- Materials: semantic background/surface/input/glass tokens, one restrained shadow scale, safe-area tokens.

## Motion and material rules

- No opacity-zero entrance state for required content.
- Press response begins on pointer down.
- Swipe position follows the pointer; release uses distance plus projected velocity.
- Fixed UI is positioned from `100dvh` and `env(safe-area-inset-*)`, never page content height.
- Glass is used for bottom dock, chat chrome, composer, and transient sheets only.
- Dense rows use tonal elevation and spacing, not shadows between items.
- `prefers-reduced-motion`, `prefers-reduced-transparency`, and `prefers-contrast` retain complete functionality.

## Verification record

- TypeScript: pass.
- ESLint: pass.
- Production Next.js build: pass.
- Bottom dock first paint and viewport matrix: pass, 0px movement.
- Messenger light-canvas matrix: pass.
- Accessibility basics and dialog inertness: pass.
- Press feedback: pass.
- Settings light/dark and nested screens: pass.
- Appearance persistence and reset isolation: pass.
- Conversation instant-open behavior: pass, CLS 0.001.
- Full visual audit: 68 final frames across 17 routes, phone/desktop, light/dark.
- Capacitor iOS sync: pass, including local push-notification package registration.
- Native iOS Simulator compile: blocked before application sources because the host has Xcode 16.2 while Capacitor 8 requires the Xcode 26 toolchain.

## Release boundary

This pass verifies browser/PWA behavior and synchronizes the Capacitor iOS project. Native compilation resumes after upgrading the host to Xcode 26; downgrading or patching framework internals was intentionally avoided. The pass does not substitute for a real two-device APNs/CallKit call test, a formal cryptographic audit, or App Store release validation.
