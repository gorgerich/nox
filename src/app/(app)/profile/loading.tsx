const ROWS = Array.from({ length: 5 });

export default function ProfileLoading() {
  return (
    <div className="app-section" aria-busy="true" aria-label="Загрузка профиля">
      <div className="app-section-header px-2">
        <h1 className="app-section-title">Профиль</h1>
      </div>

      <div className="flex flex-col items-center">
        <div className="h-28 w-28 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-5 h-7 w-44 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-2 h-4 w-28 rounded-full bg-surface-muted/50 animate-pulse" />
      </div>

      <div className="mt-8 overflow-hidden rounded-[1.5rem] border border-border-subtle bg-surface/60">
        {ROWS.map((_, index) => (
          <div key={index} className="flex min-h-[64px] items-center gap-3 border-b border-border-subtle px-4 last:border-b-0">
            <div className="h-10 w-10 rounded-full bg-surface-muted/70 animate-pulse" />
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
