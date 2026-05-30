// Instant skeleton for the Chats tab.
//
// The chat list page is dynamic (revalidate = 0, heavy Prisma query). Without a
// loading boundary the route isn't prefetchable and tapping the tab waits for
// the full query before painting. This skeleton paints instantly while the real
// list streams in — matching the snappy feel of the other tabs.

const ROWS = Array.from({ length: 9 });

export default function ChatsLoading() {
  return (
    <div className="app-section transition-smooth" aria-busy="true" aria-label="Загрузка чатов">
      <div className="app-section-header px-2">
        <h1 className="app-section-title">Чаты</h1>
        <div className="flex items-center gap-1">
          <div className="h-11 w-11 rounded-full bg-surface-muted/70 animate-pulse" />
          <div className="h-11 w-11 rounded-full bg-surface-muted/70 animate-pulse" />
        </div>
      </div>

      <div className="mb-8 px-2">
        <div className="h-10 w-full rounded-xl bg-surface-muted/70 animate-pulse" />
      </div>

      <div className="-mx-5">
        {ROWS.map((_, index) => (
          <div key={index} className="flex items-center gap-3 px-3 py-2">
            <div className="h-14 w-14 shrink-0 rounded-full bg-surface-muted/70 animate-pulse" />
            <div className="min-w-0 flex-1 border-b border-border-subtle/40 py-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="h-3.5 w-2/5 rounded-full bg-surface-muted/70 animate-pulse" />
                <div className="h-2.5 w-10 rounded-full bg-surface-muted/50 animate-pulse" />
              </div>
              <div
                className="h-3 rounded-full bg-surface-muted/50 animate-pulse"
                style={{ width: `${55 + ((index * 7) % 35)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
