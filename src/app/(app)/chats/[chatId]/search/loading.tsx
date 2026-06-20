// Own skeleton for in-chat search so it doesn't inherit the parent chat
// skeleton (message bubbles — wrong shape for a search screen).

export default function ChatSearchLoading() {
  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Загрузка поиска">
      <header className="glass-header flex items-center gap-3 px-4 py-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="h-10 flex-1 rounded-full bg-surface-muted/50" />
      </header>

      <div className="flex-1 overflow-hidden px-4 py-4">
        <div className="mx-auto max-w-2xl space-y-2">
          {[0, 1, 2, 3, 4].map((index) => (
            <div key={index} className="h-14 w-full rounded-xl bg-surface-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
