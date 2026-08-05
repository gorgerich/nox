# Dialog focus trap

## What it is

A dialog that is only *drawn* on top of the page is not modal. The page
underneath is still in the document, so:

- **Tab walks out of it.** After the last control in the dialog, focus moves to
  whatever comes next in the DOM — a chat row, the dock, a link — all of it
  behind a dimmed backdrop, invisible, and now holding the keyboard.
- **A screen reader keeps reading the page.** As far as the user is concerned
  the page is gone; the accessibility tree still has all of it.
- **Escape does nothing** unless someone wired it per dialog.
- **Closing dumps focus at the top of the document,** so the next Tab starts
  from the beginning instead of from the button that was pressed.

A focus trap is the four behaviours that together are what "modal" means:

1. focus moves into the dialog when it opens;
2. Tab and Shift+Tab cycle inside it instead of escaping;
3. Escape closes it;
4. focus returns to the control that opened it.

Plus `inert` on every branch of the tree that is not the dialog — the
platform's own way of saying "this part is not here right now". One attribute
removes those elements from the tab order, from pointer events and from the
accessibility tree at once.

Nothing about this is visible to a mouse user. It is the difference between a
dialog that works with a keyboard and one that traps the user instead.

## How it is implemented

One hook, [`src/lib/use-focus-trap.ts`](../../src/lib/use-focus-trap.ts), used
by every dialog. It walks from the dialog up to `<body>` marking siblings
inert, so it works the same whether the dialog is portalled to the body or
rendered inline. The focusable list is re-queried on every Tab, because dialog
content changes while it is open and a stale list traps focus on elements that
no longer exist.

## The argument that matters

The first argument is **whether the dialog is open**, and getting it wrong is
silent:

```tsx
// Correct only when the component is mounted by its parent at the moment it
// opens, and renders the dialog on its first render.
const dialogRef = useFocusTrap<HTMLDivElement>(true, onClose);

// Required whenever the component stays mounted and returns null until opened.
const dialogRef = useFocusTrap<HTMLDivElement>(isOpen, onClose);
```

Passing a literal `true` from a component that returns `null` while closed
means the effect runs once, on mount, against a ref that is still `null` — it
returns early and never runs again, because its dependency never changes. The
dialog then looks perfect and has no trap at all.

Three of the first eleven call sites had exactly that defect: `CallOverlay`
(returns null while `status === "idle"`), `ChatAppearanceSheet` (returns null
while `!isOpen`) and `AccountRecoveryListener` (returns null until a request
arrives). A type-check passes on all three.

## Place the call above every early return

The same three components made the sharper version of the mistake: the hook was
written after the `return null`, so it is not merely mis-driven, it is called
conditionally. React identifies hooks by call order, so a component that
sometimes calls four hooks and sometimes five corrupts that order.
`react-hooks/rules-of-hooks` catches this and the merge gate counts lint errors
against a baseline — which is how `MediaPreviewComposer`, `MediaViewer` and
`AvatarViewer` were caught after they had already shipped.

The rule is mechanical: **the hook call goes at the top of the component body,
above every conditional return, and the open state goes in the argument.** When
a component swaps itself for another dialog — `MediaPreviewComposer` renders
`MediaCropModal` while cropping — the argument must go false for that branch,
because the other dialog brings its own trap and two traps fighting over one
focus is worse than none.

## What proves it

[`scripts/validate-dialog-focus-trap.ts`](../../scripts/validate-dialog-focus-trap.ts),
registered in the merge gate, drives a real dialog in a real browser and
asserts all four behaviours plus the inert sweep and its cleanup. Runtime is
the only place this class of defect is visible, so that is where it is checked.

```bash
npm run validate:dialog-focus-trap
```
