# Screen audit — every screen, both themes, phone and desktop

Method: `npm run audit:screens` renders all 16 screens at 390×844 and 1280×900,
light and dark, and writes 64 shots to `docs/screenshots/audit/`. The review is
of the pixels, not of the source — composition problems only show up once the
pieces are on screen together.

## What the mechanical sweep found

Almost nothing, which is worth stating: no `transition: all`, no `scale(0)`
entries, no `ease-in` on UI, no keyframes on rapidly-triggered elements, custom
easing tokens already in place, and 49 of 56 `:hover` rules already gated behind
`@media (hover: hover)`. The problems were in composition and content, not in
motion.

## Findings and fixes

| Before | After | Why |
| --- | --- | --- |
| Dock label capped at `max-w-16` with `flex-[1.45]` — rendered "Контакт", "Профил" | `max-w-24`, `flex-[2]` | A tab bar that cuts its own labels mid-word reads as broken. The widest label decides the width, not the average one |
| Every fallback avatar the same pale blue | Hue derived from the name (`avatarTint`), six tints, light and dark variants | A column of identical discs gives the eye nothing to lock onto; the list had to be read name by name |
| Group avatar `bg-surface-muted` on a `surface-muted` page | `nox-avatar-tint` disc | The disc was invisible, so the initial read as floating type rather than an avatar |
| `new Date(x).toLocaleDateString()` → `7/29/2026` | `formatCalendarDate()` → `29 июля 2026` | US format in a Russian UI; a locale-dependent format is also a hydration hazard, since the server's locale and the browser's need not agree |
| Member role rendered raw: `OWNER`, `MEMBER` | `roleLabel()` → «Владелец», «Участник» | Untranslated, and Latin capitals shouting inside Cyrillic text |
| Group and partner profiles: `safe-bottom` only | `pb-[var(--bottom-dock-clearance)]` | `safe-bottom` covers the home indicator, not the floating dock — the last card scrolled underneath it |
| `.nox-empty-state` `min-height: min(44dvh, 360px)` | `min(62dvh, 520px)` plus dock clearance in the padding | The message centred a third of the way down and left a large void beneath it |
| Chat list stretched to the full `app-section` width (64rem) | `.nox-chat-list` capped at 44rem above 900px | At 1024px the timestamp sits hundreds of pixels from the preview it belongs to |
| `.appearance-header-action:hover` ungated | Wrapped in `@media (hover: hover) and (pointer: fine)` | The one hand-written hover that stuck after a tap on touch |
| Audit shots contained Next's dev badge | Hidden via an init script in the audit context | It sits on top of the dock and the composer in every shot and is not part of the product |

## Left alone, deliberately

- **Bubble timestamp alignment.** Incoming bubbles put the time on its own line,
  outgoing bubbles inline it with the ticks. It is an inconsistency, but the
  outgoing layout has to fit the delivery ticks and the incoming one does not;
  changing it is a message-bubble redesign, not an audit fix.
- **Member list divider insets.** The "Добавить участников" row uses an inset
  divider, the member rows full-width ones. Visible, cosmetic, and one edit away
  — but it belongs with a pass over list styling as a whole rather than as a
  one-off.
- **Desktop layout.** A messenger at 1280px wants a two-pane layout, not a
  centred column. That is a redesign, and this was an audit.
