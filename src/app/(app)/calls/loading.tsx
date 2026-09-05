const ROWS = Array.from({ length: 10 });

export default function CallsLoading() {
  return (
    <div className="app-section app-section-compact" aria-busy="true" aria-label="Загрузка звонков">
      <div className="nox-page-header">
        <h1 className="nox-page-title">Звонки</h1>
      </div>

      <div className="nox-list -mx-5 md:mx-0">
        {ROWS.map((_, index) => (
          <div key={index} className="nox-list-row">
            <div className="h-[46px] w-[46px] shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="h-3.5 w-28 rounded-full bg-surface-muted/70 animate-pulse" />
                <div className="h-2.5 w-20 rounded-full bg-surface-muted/50 animate-pulse" />
              </div>
              <div
                className="h-3 rounded-full bg-surface-muted/50 animate-pulse"
                style={{ width: `${42 + ((index * 9) % 30)}%` }}
              />
            </div>
            <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/50 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
