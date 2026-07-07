// Instant skeleton for opening a chat. Without it, tapping a chat changes the
// URL but Next keeps the previous screen (the chats list) on display until the
// server component resolves its chat/members/pinned query — so the open felt
// frozen. This paints the chat shell immediately while the real route streams.

export default function ChatLoading() {
  return (
    <div className="chat-screen bg-background" aria-busy="true" aria-label="Загрузка чата">
      <header className="glass-header flex items-center gap-3 px-3 py-2.5">
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="h-10 w-10 shrink-0 rounded-full bg-surface-muted/70" />
        <div className="min-w-0 flex-1">
          <div className="h-4 w-32 rounded-full bg-surface-muted/70" />
          <div className="mt-2 h-3 w-20 rounded-full bg-surface-muted/50" />
        </div>
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/60" />
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/60" />
      </header>

      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-2">
        <div className="mx-auto flex h-full max-w-3xl items-center justify-center">
          <div className="h-10 w-10 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
        </div>
      </div>

      <div className="chat-composer-shell flex items-center gap-2">
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/60" />
        <div className="h-10 flex-1 rounded-full bg-surface-muted/50" />
        <div className="h-9 w-9 shrink-0 rounded-full bg-surface-muted/60" />
      </div>
    </div>
  );
}
