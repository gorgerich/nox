# How a conversation opens

Measured against a production build on a 200-message conversation, phone
viewport, cold context each run. `npm run measure:performance` produces the
numbers; `npm run validate:conversation-open` keeps them from coming back.

## What was wrong

Reading the source did not show it. Tracing the page did.

```
  1200ms  document ready, conversation empty (1 pinned message)
  2285ms  GET /api/chats/…/messages          ← hydration finished, only now
  3673ms  53 messages render, scrollTop = 0  ← at the OLDEST loaded message
  3761ms  GET …?before=…                     ← "user is at the top", page in
  4450ms  83 messages, everything below moves down   ← layout shift 0.799
```

Four separate faults, each hiding the next:

1. **The history is not server-rendered.** The page shipped with the pinned
   message and nothing else, so the first two seconds of a messenger showed an
   empty room.
2. **The opening scroll ran on a timer from mount** — 0ms, 100ms, 240ms — and
   the messages arrived at 3673ms. All three fired against an empty list and
   did nothing. The conversation opened at its oldest loaded message.
3. **The scroll handler read that as intent.** `scrollTop === 0` means "the
   user is at the top" and pulled in a page of older history nobody had
   scrolled to.
4. **The prepend was anchored a frame too late.** The correction ran in
   `requestAnimationFrame`, so the browser first painted the list pushed down
   by the full height of thirty messages.

A fifth, separate from the sequence: the connection banner sat in the flex
column between the header and the list, so it moved the conversation by its own
height when it appeared and again when it went.

## What changed

| Fault | Fix |
| --- | --- |
| Empty on first paint | The last 24 messages ship with the HTML — the same rows, with the same reader's envelopes, that the client would have fetched a second later. Nothing is decrypted on the server and the message protocol is untouched |
| Opening scroll on a timer | Placed in a layout effect keyed on the messages, so it runs in the commit that delivers them and before the paint. Once per conversation, tracked by chat id |
| Pagination on an unplaced list | `loadOlder` returns early until the conversation has been placed |
| Anchor a frame late | Moved from `requestAnimationFrame` into the same layout effect. `scrollTo` rather than assigning `scrollTop`, because the React Compiler rejects the assignment on a node JSX also holds |
| The authoritative batch prepending over the seed | Same anchor. This one only became visible after the seeding fix — it had been hidden behind the larger shift |
| Connection banner in the flow | Floats over the top of the list out of a zero-height slot |

## Measured

| | before | after |
| --- | --- | --- |
| Layout shift, opening a conversation | **0.879** | **0** |
| Largest contentful paint | 1436 ms | **900 ms** |
| LCP equal to first paint | no — content arrived later | **yes** |
| Requests while opening | 2 (history, then a page of older) | **1** |
| Opens at the newest message | no | **yes** — 0px from the bottom |

## Not verified

**Scroll smoothness.** The harness browser renders through SwiftShader with no
GPU, so per-frame paint cost there describes a software rasteriser, not a
phone. The frame intervals it reports (median 16.7ms, worst 233ms) cannot be
used to claim either smooth scrolling or jank. This needs a real device.

**Still open.** About 700ms of main-thread blocking during load, and a profile
screen LCP of 1908ms. Both measured, neither addressed here.
