// Instant skeleton for the Contacts tab — makes the dynamic route prefetchable
// and paints immediately while the server query streams in.

const ROWS = Array.from({ length: 8 });

export default function ContactsLoading() {
  return (
    <div className="app-section" aria-busy="true" aria-label="Загрузка контактов">
      <header className="nox-page-header">
        <h1 className="nox-page-title">Контакты</h1>
        <div className="h-10 w-10 rounded-full bg-surface-muted/70 animate-pulse" />
      </header>

      <div className="nox-list -mx-5 md:mx-0">
        {ROWS.map((_, index) => (
          <div key={index} className="nox-list-row">
            <div className="h-[46px] w-[46px] shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
            <div className="min-w-0 flex-1">
              <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/70 animate-pulse" />
              <div className="mt-2 h-2.5 w-1/4 rounded-full bg-surface-muted/50 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
