const ROWS = Array.from({ length: 7 });

export default function ProfileLoading() {
  return (
    <div className="app-section app-section-compact" aria-busy="true" aria-label="Загрузка профиля">
      <div className="mt-2 flex flex-col items-center safe-top">
        <div className="h-24 w-24 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-4 h-7 w-44 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-2 h-4 w-28 rounded-full bg-surface-muted/50 animate-pulse" />
      </div>

      <div className="mx-4 mt-6 overflow-hidden rounded-[0.875rem] bg-surface/60">
        {ROWS.map((_, index) => (
          <div key={index} className="flex min-h-[52px] items-center gap-3 border-b border-border-subtle px-4 last:border-b-0">
            <div className="h-8 w-8 rounded-full bg-surface-muted/70 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-36 rounded-full bg-surface-muted/70 animate-pulse" />
              <div className="mt-2 h-2.5 w-28 rounded-full bg-surface-muted/50 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
