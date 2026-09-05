// Instant skeleton for the in-chat partner profile. The server component runs
// membership + chat + contact-settings queries before rendering, so without a
// loading frame the tap feels dead. This paints the shell immediately.

export default function PartnerProfileLoading() {
  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Загрузка профиля">
      <header className="liquid-top-chrome flex min-h-14 items-center justify-between px-3">
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="h-4 w-20 rounded-full bg-surface-muted/60" />
      </header>

      <div className="flex flex-1 flex-col items-center overflow-hidden px-5 pt-4">
        <div className="h-24 w-24 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-3 h-6 w-40 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-2 h-4 w-24 rounded-full bg-surface-muted/50 animate-pulse" />

        <div className="mt-5 flex w-full max-w-sm gap-3">
          <div className="h-14 flex-1 rounded-xl bg-surface-muted/50 animate-pulse" />
          <div className="h-14 flex-1 rounded-xl bg-surface-muted/50 animate-pulse" />
          <div className="h-14 flex-1 rounded-xl bg-surface-muted/50 animate-pulse" />
        </div>

        <div className="mt-5 w-full max-w-sm space-y-2">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-12 w-full rounded-xl bg-surface-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
