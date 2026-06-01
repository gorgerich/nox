// Instant chat-open frame.
//
// Keep this neutral: showing a cached preview here can look like a frozen
// screenshot of old messages while the route streams. The interactive chat
// hydrates and then loads history cache-first inside ChatMessages.

const SKELETON_BUBBLES: { side: "left" | "right"; w: string }[] = [
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
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Открытие чата">
      {/* Header */}
      <div className="glass-header flex items-center gap-3 px-3 py-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted animate-pulse" />
        <div className="min-w-0 flex-1">
          <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/70 animate-pulse" />
          <div className="mt-1 h-2.5 w-1/4 rounded-full bg-surface-muted/50 animate-pulse" />
        </div>
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70" />
      </div>

      {/* Thread */}
      <div className="flex flex-1 flex-col justify-end overflow-hidden px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
          {SKELETON_BUBBLES.map((bubble, index) => (
            <div key={index} className={`flex ${bubble.side === "right" ? "justify-end" : "justify-start"}`}>
              <div
                className="h-10 rounded-2xl bg-surface-muted/60 animate-pulse"
                style={{ width: bubble.w, animationDelay: `${index * 70}ms` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Composer */}
      <div className="glass-composer flex items-center gap-3 px-3 py-3">
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="h-11 flex-1 rounded-3xl bg-surface-muted/60" />
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70" />
      </div>
    </div>
  );
}
