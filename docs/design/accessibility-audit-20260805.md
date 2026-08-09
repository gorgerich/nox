# Accessibility audit — the whole messenger

Method: mechanical sweeps over all 83 components for each failure pattern, then
a rendered check in a real browser for anything where the source cannot settle
the question. `npm run validate:a11y-basics` is the result of that second half
and now runs in the merge gate.

## What was already right

Worth stating, because it shapes what was left to do. Every image has an `alt`.
`prefers-reduced-motion: reduce` is honoured globally. `<main>` and a labelled
`<nav>` landmarks exist. The 44px `touch-target` utility is applied throughout,
so hit areas are not a problem. The only five `onClick` handlers on non-button
elements are click-outside backdrops, which have a keyboard path through
Escape. There is no positive `tabindex` anywhere, and no `user-scalable=no`.

## Findings and fixes

| Severity | Location | Before | After | Why |
| --- | --- | --- | --- | --- |
| HIGH | `ProfileContent.tsx` — six sub-screens (`profile`, `devices`, `appearance`, `security`, `folders`, `data`) | `fixed inset-0 z-[1100]` overlay; the profile page stays mounted and reachable behind it | `role="dialog" aria-modal` + `useFocusTrap` driven by `activeScreen`, Escape returns to the list | Tab walked straight out of the open screen into the page behind it, and a screen reader read both. Two `<h1>`s were live at once for the same reason |
| HIGH | `ChatHeader.tsx:210` | `role="menu"` with `role="menuitem"` children and no key handling at all | `useMenuKeyboard`: focus enters the menu, Arrow/Home/End move, Escape closes and restores focus, Tab closes; `aria-haspopup="menu"`; roving `tabindex="-1"`; the timer options wrapped in a labelled `role="group"` | A role is a promise. The menu announced itself as a menu, so the user tries the menu keys — and nothing happened |
| HIGH | `ProfileContent.tsx` ×5 | `<label>Имя</label>` with no `htmlFor` and no input inside it | `htmlFor`/`id` pairs, plus `autocomplete` on the name, username and both password fields | The label was on screen but attached to nothing, so the field was nameless while looking labelled |
| MEDIUM | `ChatComposer.tsx:411`, `NewChatForm.tsx:181`, `ChatSearch.tsx`, `GroupPicker.tsx` ×2, `AdminPanel.tsx` ×2, `ProfileContent.tsx` (folder), `ContactsList.tsx`, `ChatMessages.tsx` (in-chat search), `PartnerProfileContent.tsx` | Placeholder only | `aria-label` on each | A placeholder is not a label: it disappears on input, and before that it is not a reliable name. The message composer itself was among these |
| MEDIUM | `AvatarCropModal.tsx:205`, `MediaCropModal.tsx:205` | `<input type="range">` with an adjacent `<span>Масштаб</span>` that is not associated | `aria-label="Масштаб"` | The slider announced a bare number with no indication of what it controls |
| MEDIUM | `ChatMessages.tsx:2408` | Toast rendered into the DOM with no live region | A stable `sr-only` `role="status"` region whose text changes; the visual toast is `aria-hidden` | "Скопировано", "Удалено" and similar confirmations were silent. The region is rendered empty and always present, because inserting a region and its text in one commit is not announced reliably |
| LOW | `globals.css` — `.input-nox:focus` | `@apply ring-2 ring-primary/20` followed by an explicit `box-shadow` | Removed | The ring drew nothing: Tailwind's ring is a box-shadow and the later declaration replaced it. Dead code that reads like a focus style |

## A wrong turn, recorded

The `@apply ring-2` above looked like a missing focus indicator, and the first
version of this pass "fixed" it — adding a 2px box-shadow ring to `.input-nox`
and raising three other faint rings to full strength.

That was wrong. The global indicator is

```css
:where(a, button, input, textarea, select):focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 3px;
}
```

declared **outside any cascade layer**, while `.input-nox` and every Tailwind
`outline-none` utility sit inside `@layer utilities`. Unlayered styles beat
layered ones regardless of specificity, so the global outline was always
winning and every one of those fields already had a visible ring. The added
box-shadow drew a second ring inside the outline — the exact double-indicator
this stylesheet already avoids for the composer and the auth fields.

Measured rather than argued: reverting the change and re-running the suite
reported `outline=2px solid` on a focused `.input-nox`, with no ring in the
box-shadow. All four edits were reverted; only the dead-code removal stayed.

The general lesson is in the shape of the mistake. `:where()` at zero
specificity looks like it loses to everything, and it does — within its layer.
Cascade layers outrank specificity, and reading the two rules side by side
without checking which `@layer` each one is in produces a confident wrong
answer.

## Considered and rejected

| Candidate | Rejected because |
| --- | --- |
| "Skip to content" link | `<main>` is the first thing in `AppShellChrome`; the dock renders after it. No repeated navigation precedes the content, so the link would be a tab stop that skips nothing |
| `role="dialog"` on the click-outside backdrops | They are not dialogs; the panel they sit behind is. They are now `aria-hidden` where they were bare |
| Converting the six profile sub-screens to routes | The right long-term shape — they are navigation, not dialogs — but it is a routing change, not an accessibility fix, and the modal treatment gives the same keyboard and screen-reader behaviour today |
| Visible labels instead of `aria-label` on the search fields | The search pills are a deliberate compact pattern used on five screens; adding visible labels is a redesign. The names are now correct either way |
| Raising `focus:ring-primary/15` on the join and new-chat forms | Faint, but decorative — the real indicator is the global outline. Changing it would add a second ring |

## What proves it

`scripts/validate-a11y-basics.ts`, in the merge gate. It walks seven screens
and asserts that no visible, non-inert focusable control is missing an
accessible name; that a focused field paints an outline or ring of at least
2px, read from the computed style; that the profile sub-screen makes the page
behind it inert and closes on Escape; and that the chat menu enters on open,
moves on Arrow and Home/End, closes on Escape and restores focus to its
trigger.

The name check found two controls the source sweep had missed — the message
composer's textarea and the new-chat search field — which is the argument for
having it.

```bash
npm run validate:a11y-basics
```
