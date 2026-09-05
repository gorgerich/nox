// Instant skeleton for a user's profile route. Without it, navigating to a
// profile blocks on the server component (auth + user + contact-settings
// queries) and the previous screen stays frozen — the "профиль тупит" lag.
// This paints the layout immediately while the real page streams in over it.

export default function UserProfileLoading() {
  return (
    <div className="app-section app-section-compact" aria-busy="true" aria-label="Загрузка профиля">
      <header className="nox-detail-header app-section-header !grid">
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="mx-auto h-5 w-20 rounded-full bg-surface-muted/70" />
        <div className="h-11 w-11" />
      </header>

      <div className="mt-3 flex flex-col items-center">
        <div className="h-24 w-24 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-4 h-7 w-44 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-2 h-4 w-28 rounded-full bg-surface-muted/50 animate-pulse" />

        <div className="mt-6 flex w-full max-w-xs gap-4 px-4">
          <div className="h-12 w-full rounded-2xl bg-surface-muted/70 animate-pulse" />
        </div>

        <div className="mt-8 w-full max-w-sm">
          <div className="h-4 w-24 rounded-full bg-surface-muted/60" />
          <div className="mt-4 h-20 w-full rounded-xl bg-surface-muted/40 animate-pulse" />
        </div>
      </div>
    </div>
  );
}
