// Per-navigation wrapper for the chat route. A template re-mounts on every
// navigation into the segment and stays mounted across the loading -> page
// swap, so the slide-in-from-right animation plays exactly once and covers both
// the loading skeleton and the real chat (no double frame).
export default function ChatRouteTemplate({ children }: { children: React.ReactNode }) {
  return <div className="chat-open-anim h-full">{children}</div>;
}
