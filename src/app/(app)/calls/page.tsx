export default async function CallsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 text-center">
      <div className="mb-8 flex items-center justify-between px-2">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Звонки</h1>
      </div>

      <div className="mt-20 animate-in fade-in duration-1000">
        <div className="mx-auto mb-6 flex h-24 w-24 items-center justify-center rounded-3xl border border-border-subtle/50 bg-surface-hover/30">
          <svg className="h-10 w-10 text-muted opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Раздел звонков ещё не запущен</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
          Здесь появится история звонков, когда функция будет готова. Сейчас аудио- и видеозвонки недоступны.
        </p>
      </div>
    </div>
  );
}
