// Own skeleton for the group profile so it doesn't inherit the parent chat
// skeleton (which shows message bubbles — wrong shape for a profile).

export default function GroupProfileLoading() {
  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Загрузка профиля группы">
      <header className="glass-header flex items-center gap-3 px-4 py-3">
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/70" />
      </header>

      <div className="flex flex-1 flex-col items-center overflow-hidden px-5 pt-8">
        <div className="h-28 w-28 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-4 h-7 w-52 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-2 h-4 w-28 rounded-full bg-surface-muted/50 animate-pulse" />

        <div className="mt-7 flex w-full max-w-sm gap-3">
          <div className="h-16 flex-1 rounded-2xl bg-surface-muted/50 animate-pulse" />
          <div className="h-16 flex-1 rounded-2xl bg-surface-muted/50 animate-pulse" />
          <div className="h-16 flex-1 rounded-2xl bg-surface-muted/50 animate-pulse" />
        </div>

        <div className="mt-7 w-full max-w-2xl space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-14 w-full rounded-xl bg-surface-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
