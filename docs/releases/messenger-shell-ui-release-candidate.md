# Release candidate — messenger shell and UI

```
MESSENGER UI COMPLETION:        PASS
REAL MOBILE BROWSER DOCK SMOKE: NOT TESTED — needs a physical device
PRODUCTION:                     deployed, 59c62b2
```

Merged and deployed. The device smoke runs as post-deploy verification and does
not gate the code — see the limitations at the bottom for what that means.

| Release | |
| --- | --- |
| RC | `rc/messenger-shell-ui-2` → `62f1ad8` |
| Merge | `59c62b2` |
| Deployed | `59c62b2`, Railway deployment `81c43e51`, SUCCESS |
| Rollback | runtime only, back to `c12cc5e`; no schema change to undo |

| | |
| --- | --- |
| Branch | `fix/messenger-shell-ui` |
| RC | the commit tagged `rc/messenger-shell-ui-2` — a file cannot name the SHA of the commit containing it |
| Superseded RC | `rc/messenger-shell-ui-1` → `4fd8f60`, left where it is; it was based on the pre-hotfix `main` |
| Base | `c12cc5e` — production with the post-commit hotfix in it |
| Earlier checkpoint | `checkpoint/shell-first-paint` → `7eccdde` (dock geometry + timestamps), left in place |
| Migration | none |

## What is in it

### Group sender prefix

A group row now says who spoke. The name comes from `lastMessage.sender`, which
the chat-list projection already selects, so no query was added and the row
cannot become an N+1. `Вы` for your own message, `displayName` → `username` →
`Участник` otherwise — never an id, never `undefined`. One-to-one rows and
system events get no prefix. Every message kind has a preview: photo, video,
video circle, voice, file, deleted, unreadable-encrypted, unsupported. The
sender carries slightly more weight than the text and deliberately is not an
accent colour, which would read as a link in every row.

Rows also gained a single accessible name — conversation, sender, text, unread
count — instead of a screen reader stitching fragments together.

### Appearance, rebuilt

The old sheet was a short drawer of controls. This is a screen:

- a sticky header with a grabber, a title, close, and a reset that is disabled
  until something is customised;
- a **live preview** built from the real appearance variables and the real
  `resolveChatScheme` — incoming and outgoing bubbles, a reply, ticks, a media
  bubble, the group sender name;
- sections that mean something on their own: Тема, Обои, Цвет исходящих,
  Входящие сообщения, Форма сообщений, and the wallpaper dimming when a
  wallpaper is set;
- theme and wallpaper cards on one horizontally scrolling row rather than a grid
  that wraps into ragged rows;
- «Минимал» renamed to «Без заливки», which says what it does;
- a sticky footer whose «Готово» is disabled until something changed.

Editing works on a **draft**. Nothing is written while a control is being
dragged, the conversation behind the sheet is not repainted, and closing with
unsaved changes asks whether to save or discard.

The two schemes stay separate: the sheet's chrome follows the app, the preview
follows the draft chat theme. A dark chat theme in a light app darkens the
preview and leaves the sheet light — and the reverse.

### Modal layering

The dock is asked to hide while the sheet is open and released when it closes,
the backdrop covers the viewport, background scroll is locked while the sheet
scrolls internally, focus is trapped, Escape closes, dragging the header down
closes, and focus returns to what opened it.

### A real bug found on the way

Saved appearance settings **were not applied after a reload**. The hook seeded
React state from storage in an initialiser; the server rendered the defaults and
the client's post-mount correction raced hydration, so a saved theme only
appeared once some unrelated re-render happened along. It now reads through
`useSyncExternalStore` — server snapshot: defaults; client snapshot: storage —
the same mechanism the connection banner and the timestamps use. Covered by
`validate:appearance-persistence`, which fails without the fix.

### Dock diagnostics

`?dockDiagnostics=1` records the dock's geometry against `innerHeight`,
`visualViewport`, a measured safe-area sentinel, scroll, orientation and display
mode, tagged by event. Off by default; with the flag absent it attaches no
listeners and renders nothing. Geometry only — no content, no identifiers, no
network. Procedure: `docs/testing/real-device-dock-smoke.md`.

## Validation matrix

| Suite | Checks | Result |
| --- | --- | --- |
| `validate:group-chat-sender-preview` | 48 | PASS |
| `validate:appearance-sheet` | 50 | PASS |
| `validate:appearance-persistence` | 15 | PASS |
| `validate:messenger-light-canvas` | 206 | PASS |
| `validate:dock-first-paint` | 75 | PASS |
| `validate:timestamp-hydration` | 29 | PASS |
| `validate:chat-theme-consistency` | 62 | PASS |
| `validate:chat-scroll-anchor` | 3 | PASS |
| `validate:message-send-reconciliation` | 25 | PASS |
| `validate:message-local-persistence` | 71 | PASS |
| `validate:message-send-browser` | 21 | PASS |
| `validate:message-send-browser-e2ee` | 47 | PASS |
| typecheck / lint budget / build / `git diff --check` | — | PASS |

Counts are from the run of record: one `npm run validate:messenger-ui-completion`
end to end, **652 checks, 0 failures**, re-run after merging production `main`
(`c12cc5e`) into this branch — same 652, still zero. Two further full runs before it were also
clean; the numbers above are the last one, not a best-of.

### What the gate needed before it could be believed

The first four full runs failed on suites that passed when run alone, each time
telling a different story. None of them was a product regression, and all of
them were the gate lying about the product:

- **Typing before hydration.** The composer is inert markup until React is live:
  text put into it is discarded by hydration and Enter has no handler. A suite
  that typed too early lost the message and then saw an empty composer, which it
  read as a successful send — a green check over a send that never happened.
  `ChatComposer` now exposes `data-composer-ready`, and every delivery suite
  waits for it.
- **Fixed sleeps in front of database assertions.** Reading the row before the
  commit landed left `committed[0]` undefined, so the replay posted no client id
  and `count({ clientMessageId: undefined })` dropped the filter and counted the
  whole conversation — reporting a broken idempotency guarantee that was never
  broken. Waits are now on the condition.
- **A server teardown that was assumed, not awaited.** `stop()` waited 800 ms
  instead of the process exit, so the next suite booted into a half-cleaned
  `.next` and died on a missing `required-server-files.json`. That surfaced as a
  FAIL with no failing check.
- **Sign-in responses dropped on the floor.** A rejected login left the context
  unauthenticated and resurfaced later as "device registration failed".
  `signIn()` now fails the run and names the status.

The failures were real; what they pointed at was not. Fixing the gate rather
than re-running it until it agreed is the whole reason the counts above mean
anything.

All browser suites run against the disposable database and refuse to start
otherwise.

## Screenshots

`docs/screenshots/messenger-ui/` — group previews (incoming, own, media,
unread, a long name at 320px, a one-to-one row with no prefix) and the
appearance sheet (light, dark, both cross-scheme cases, wallpapers, outgoing
colours, incoming styles, radius, the unsaved-changes prompt, reset, 320px,
desktop, dock hidden).

`docs/screenshots/messenger-shell/` — the canvas and dock/timestamp evidence
from the previous stage.

## Known limitations

1. **The device dock jump is unexplained, not fixed.** The harness measures 0px
   across everything it can drive. The browser-chrome explanation is a
   hypothesis and is labelled as one.
2. **No on-screen keyboard in the harness.** Focus and blur are covered; what
   iOS does when the keyboard opens is not, and the screenshots named
   `dock-keyboard-*` are focus states, not a real keyboard.
3. **Appearance is local to the device.** Settings live in `localStorage` per
   conversation. Another device does not inherit them, and clearing site data
   loses them. No server-backed model was introduced here.
4. **Custom wallpapers and custom colours are not offered**, because only the
   built-in sets map to real tokens. Offering a swatch that changes nothing
   would be worse than not offering it.
5. **Wallpaper dimming is the only extra control**, for the same reason: the
   other candidates are not wired to anything today.
6. **Lint baseline is 8**, unchanged. Three of those are in `deploy-db.js` and
   the rest predate this work.

## Rollout

1. Re-run `npm run validate:messenger-ui-completion` on the RC commit.
2. Run the device smoke and attach the JSON, or accept the RC with the dock
   status still PENDING — the choice is explicit, not implied.
3. Merge `fix/messenger-shell-ui` into `main`.
4. Deploy; Railway builds `main`.
5. Confirm the deployed SHA equals the merge commit.
6. Confirm the schema fingerprint is unchanged — this candidate touches no
   schema, so any change would be someone else's.
7. Spot-check on the smoke account: a group row shows a sender, the appearance
   sheet opens and saves, a reload keeps the theme.

## Runtime rollback

Redeploy the previous SHA. Nothing here is persisted server-side and no
migration ships, so a rollback is a redeploy and nothing else. A user who saved
an appearance keeps it in local storage; the older runtime reads the same key
and the same shape.
