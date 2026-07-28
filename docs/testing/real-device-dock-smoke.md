# Dock smoke on a real device

## Why this exists

The dock does not move in the harness. An init script samples its rectangle
every animation frame from the first frame it exists, and across four viewports,
both colour schemes, a deep link, a tab switch, a hard reload, back navigation,
viewport growth and shrink, landscape, and focus and blur of a text field, the
measured movement is **0px** and the gap from the bottom stays a constant 12px.

The jump reported on a phone is therefore something the harness cannot
reproduce. The likely explanation is the browser's own chrome: while the address
bar is showing, `env(safe-area-inset-bottom)` is larger, and when it collapses
after the first scroll the inset shrinks and a bottom-anchored element follows
it down. **That is a hypothesis.** It is not written into the release notes as a
cause, and the dock's CSS has not been changed to chase it.

This procedure replaces the hypothesis with numbers.

## Before you start

- Use the deployed app, on the device where the jump was seen.
- Note which browser: Safari, Chrome, or the installed app.
- Close the tab first — the first open is the case that matters.

## The run

Append `?dockDiagnostics=1` to the URL. A small panel appears at the top with
the live measurements and a **copy JSON** button. It records geometry only: no
message content, no identifiers, nothing leaves the device, and nothing is
uploaded. Without the query parameter the recorder does not run at all.

1. Open `https://<host>/chats?dockDiagnostics=1` from a cold tab.
2. **Do not touch the screen for three seconds.**
3. Screenshot. This is the frame the bug is about.
4. Tap once, somewhere neutral — not on the dock, and without scrolling.
5. Screenshot.
6. Scroll down far enough that the browser hides its address bar.
7. Screenshot.
8. Scroll back to the top.
9. Open the keyboard (tap the search field), then close it.
10. Rotate to landscape and back, if the device allows it.
11. Press **copy JSON** and paste the result somewhere you can share it.

## What the numbers mean

Each sample carries `innerHeight`, `visualViewport.height`, `offsetTop`, the
dock's rectangle, the measured safe-area inset, the scroll position, the
orientation and the display mode, tagged with the event that produced it.

The panel also shows **max Δbottom** — the largest distance the dock's bottom
edge has been from where it ended up. If that number is 0–1px, the dock did not
move and the reported jump is something else on screen. If it is larger, the
sample that differs names the event that moved it, and the accompanying
`safeAreaBottom` and `visualViewportHeight` values say whether the browser
chrome was the cause.

## What would count as proof

- **Browser chrome:** `safeAreaBottom` or `innerHeight` changes between the
  first frames and the post-scroll samples, and the dock's bottom tracks it.
  Nothing in the app is at fault; the fix, if one is wanted, is a product
  decision about whether the dock should follow the visual bottom or stay put.
- **The app:** the dock moves while `innerHeight`, `visualViewport.height` and
  `safeAreaBottom` all stay constant. That would be a real bug and would point
  at layout rather than the browser.

## Status

```
REAL MOBILE BROWSER DOCK SMOKE: PENDING
```

This stays PENDING until someone runs the steps above and shares the JSON. It
does not block the code gate — the harness result stands on its own — but no
one should claim the device jump is fixed, or explained, without it.
