# Nox Quality Audit

Date: 2026-06-30

Scope: Next.js/PWA messenger UI, shared app shell, navigation, chat, calls,
media, profiles, admin, authentication boundaries, accessibility, responsive
behavior, theme materials, and production build health.

## Native iOS Status

The machine has the Swift 6 command-line toolchain, but not the full Xcode
application. `xcode-select` points to CommandLineTools. The Nox repository has
no `.xcodeproj`, `.xcworkspace`, Swift package, or Swift source files.

Native SwiftUI Liquid Glass and Simulator testing remain blocked until:

1. Full Xcode with an iOS 26 SDK is installed.
2. An iOS app target is created inside the Nox repository.
3. The target has a defined API/auth/E2EE integration strategy.

The web implementation must not be presented as native SwiftUI.

## Audit Score

| Dimension | Before | After | Finding |
| --- | ---: | ---: | --- |
| Accessibility | 2/4 | 3/4 | Core icon controls and overlays now expose names and dialog semantics |
| Performance | 2/4 | 3/4 | Expensive stacked 28-30px blurs and clip-path route animation reduced |
| Responsive design | 3/4 | 3/4 | Safe areas and touch targets are strong; real-device verification remains |
| Theming | 3/4 | 4/4 | Shared light/dark glass tokens and reduced-transparency fallback are aligned |
| Anti-patterns | 2/4 | 3/4 | Decorative glass gradients, global image outlines, glow shadows, and uppercase chrome reduced |
| **Total** | **12/20** | **16/20** | **Good, with real-device and focus-management work remaining** |

## Fixed Findings

### P1: Decorative glass was applied as a visual effect

Large independent backdrop filters, sheen gradients, and hard depth were used
across controls and overlays. This increased GPU compositing cost on iPhone and
made the interface look less like Apple system material.

Fix: split regular and strong material tokens, reduce blur/saturation, remove
decorative sheen layers, reserve stronger material for dock and sheets, and add
`prefers-reduced-transparency`.

### P1: Critical overlays lacked accessible dialog semantics

Call UI, media viewers, recovery approval, media preparation, profile dialogs,
group creation, and appearance sheets did not consistently identify themselves
as modal dialogs.

Fix: add dialog roles, modal state, accessible titles, control names, Escape
handling for viewers, and semantic buttons for tappable media.

### P1: Tappable media used non-semantic `div` elements

Photos, videos, round videos, downloads, group members, and message selection
could not be operated consistently with keyboard or assistive technology.

Fix: use buttons for media and selection controls, add pressed state and keyboard
activation where a whole message row becomes selectable.

### P2: Tab swipe conflicted with horizontal content

The global tab gesture could begin inside folder, search-recents, or admin tab
scrollers and unexpectedly change sections.

Fix: mark horizontal scrollers and exclude them from the global tab gesture.

### P2: Session storage could break navigation state

Direct `sessionStorage` reads and writes could throw in restricted browser
contexts.

Fix: use guarded scroll-state helpers and preserve navigation when storage is
unavailable.

### P2: Admin invite button relied on implicit form behavior

The action had no explicit button type.

Fix: declare `type="submit"`.

## Remaining Risks

- Modal focus trapping is not yet centralized. Dialog semantics are improved,
  but a shared focus-management primitive should be the next accessibility pass.
- Authenticated visual regression testing needs a safe test account or fixture.
- iPhone Safari and installed PWA need real-device testing for keyboard,
  viewport resizing, camera, microphone, background calls, and reduced
  transparency.
- Full SwiftUI work is blocked by the missing Xcode app and iOS target.

## Design Rule

Liquid Glass is navigation and control chrome over content. Lists, messages,
settings rows, and content surfaces remain flat. Strong glass is limited to the
bottom dock and modal sheets; regular glass is used for headers, composer, and
compact controls.
