// Instant skeleton for the Contacts tab — makes the dynamic route prefetchable
// and paints immediately while the server query streams in.

const ROWS = Array.from({ length: 8 });

export default function ContactsLoading() {
  return (
    <div className="app-section" aria-busy="true" aria-label="Загрузка контактов">
      <header className="app-section-header items-center">
        <div>
          <h1 className="app-section-title">Контакты</h1>
        </div>
      </header>

      <div className="-mx-5 divide-y divide-border-subtle border-y border-border-subtle bg-surface md:mx-0 md:rounded-2xl md:border">
        {ROWS.map((_, index) => (
          <div key={index} className="flex min-h-[72px] items-center gap-3 px-5 py-2.5">
            <div className="h-12 w-12 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/70 animate-pulse" />
              <div className="mt-2 h-2.5 w-1/4 rounded-full bg-surface-muted/50 animate-pulse" />
            </div>
            <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
