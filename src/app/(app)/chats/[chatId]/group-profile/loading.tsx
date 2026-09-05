// Own skeleton for the group profile so it doesn't inherit the parent chat
// skeleton (which shows message bubbles — wrong shape for a profile).

export default function GroupProfileLoading() {
  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Загрузка профиля группы">
      <header className="liquid-top-chrome flex min-h-14 items-center px-3">
        <div className="h-11 w-11 shrink-0 rounded-full bg-surface-muted/70" />
      </header>

      <div className="flex flex-1 flex-col items-center overflow-hidden px-5 pt-4">
        <div className="h-24 w-24 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-3 h-7 w-52 rounded-full bg-surface-muted/70 animate-pulse" />
        <div className="mt-2 h-4 w-28 rounded-full bg-surface-muted/50 animate-pulse" />

        <div className="mt-5 flex w-full max-w-sm gap-3">
          <div className="h-14 flex-1 rounded-xl bg-surface-muted/50 animate-pulse" />
          <div className="h-14 flex-1 rounded-xl bg-surface-muted/50 animate-pulse" />
          <div className="h-14 flex-1 rounded-xl bg-surface-muted/50 animate-pulse" />
        </div>

        <div className="mt-5 w-full max-w-2xl space-y-2">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="h-14 w-full rounded-xl bg-surface-muted/40 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
