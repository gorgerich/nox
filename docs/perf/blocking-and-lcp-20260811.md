# Main-thread blocking and the profile LCP

Two numbers were left open by the previous pass: roughly 700ms of blocked main
thread during load, and a profile screen whose largest contentful paint landed
at 1908ms. This is what each turned out to be.

## The profile LCP: fixed

The screen was not painting slowly. It was **growing a new largest element
seconds after it was readable**.

```
  /profile
    LCP  1812ms   H1.app-section-title            "Профиль"
    LCP  3996ms   P.text-xs.leading-snug.text-muted  "Уведомления заблокированы…"
```

`usePushNotifications` starts at `status: "loading"` and only resolves after
`navigator.serviceWorker.register("/sw.js")` returns. The paragraph explaining
the push state renders only once the status is known, so it appeared seconds
late — and being a block of text, it became the LCP element.

`Notification.permission` is readable synchronously. The status now comes from
it as soon as support is confirmed; registration still happens and still
refines whether a subscription exists, it just no longer decides when the user
can read the answer.

**Measured, three runs each side, same machine, back to back:**

| | main | with the fix |
| --- | --- | --- |
| Profile LCP | 4092, 3756, 4032 ms | **2540, 2768, 2300 ms** |
| Median | 4032 ms | **2540 ms** (−37%) |

No run of one overlaps a run of the other.

## The blocking: diagnosed, not fixed

A CPU profile of a chat-list load, sampled at 200µs:

```
  2144ms  (idle)
  1557ms  (program)                        ← browser internals: parse, compile
   487ms  n  @ loading-….js                ← module evaluation
   412ms  s  @ webpack-….js                ← the module loader
   203ms  (garbage collector)
   135ms  o3 @ 4bd1b696-….js
```

Almost none of it is application logic. It is the cost of parsing and
evaluating the bundle, and the two largest chunks — 217 kB and 195 kB — are
React DOM itself. There is no application code in them to remove.

### What was tried and rejected

**Deferring startup work to idle time.** `E2EEInitializer` registers the device
and `ChatCacheHydrator` warms every persisted conversation; both run in the app
layout on every route and neither is needed for a first paint, so both were
moved behind `requestIdleCallback`. Single runs looked convincing — 1295ms to
777ms — but three runs a side put main at 522/630ms and the change at
511/880ms, with individual samples spanning 395–1068ms. **The effect is inside
this machine's noise floor.** Reverted: the hydrator deferral also delays the
warm cache it exists to provide, and a cost with no measured benefit is not a
trade worth making.

**Code splitting the dialog-only components.** `GroupPicker`,
`MediaPreviewComposer`, `MediaCropModal`, `AvatarCropModal` and
`VideoMessageRecorder` are all rendered behind an interaction, and none were
code-split — the repository had no dynamic imports at all. Splitting all five
moved the initial script payload from 277 kB to 274 kB. Three kilobytes against
a framework that is two hundred. Reverted.

### What would actually move it

Shipping less framework, or shipping it later. That means React Server
Components doing more of the work with fewer client boundaries — a structural
change to how the screens are built, not a tuning pass. Worth doing, worth
planning, not worth pretending a smaller edit achieves.

## A note on the measuring environment

The harness browser renders through SwiftShader with no GPU, and this machine's
load varies enough that single runs of anything under about 300ms of difference
are not evidence. Every claim above that survived is one where repeated runs on
each side do not overlap.
