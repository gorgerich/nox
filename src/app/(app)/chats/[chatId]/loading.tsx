// Instant navigation skeleton for the chat screen.
//
// Without a loading boundary a dynamic route is NOT prefetched at all
// (Next.js: "Dynamic page — Prefetched: No, unless loading.js"), so tapping a
// chat row left the list frozen until the heavy server render finished. This
// boundary makes the route prefetchable (its shell is cached) and shows an
// instant placeholder while the real page streams in — matching the snappy
// feel of the bottom-dock tabs.

const BUBBLES: { side: "left" | "right"; w: string }[] = [
  { side: "left", w: "58%" },
  { side: "right", w: "42%" },
  { side: "left", w: "72%" },
  { side: "right", w: "35%" },
  { side: "left", w: "50%" },
  { side: "right", w: "64%" },
  { side: "left", w: "44%" },
];

export default function ChatLoading() {
  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Загрузка чата">
      {/* Header */}
      <div className="glass-header flex items-center gap-3 px-3 py-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="h-12 w-12 shrink-0 rounded-2xl bg-surface-muted/70 animate-pulse" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/70 animate-pulse" />
          <div className="h-2.5 w-1/4 rounded-full bg-surface-muted/50 animate-pulse" />
        </div>
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-hidden px-4 py-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {BUBBLES.map((bubble, index) => (
            <div
              key={index}
              className={`flex ${bubble.side === "right" ? "justify-end" : "justify-start"}`}
            >
              <div
                className="h-11 rounded-3xl bg-surface-muted/60 animate-pulse"
                style={{ width: bubble.w, animationDelay: `${index * 80}ms` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="glass-composer flex items-center gap-3 px-3 py-3">
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="h-11 flex-1 rounded-3xl bg-surface-muted/60 animate-pulse" />
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
      </div>
    </div>
  );
}
