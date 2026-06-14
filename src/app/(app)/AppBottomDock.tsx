"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact2, MessageCircle, Phone, Search, UserRound } from "lucide-react";

const MAIN_DOCK_PATHS = new Set(["/contacts", "/calls", "/chats", "/chats/search", "/profile"]);

const tabs = [
  { href: "/contacts", label: "Контакты", icon: Contact2 },
  { href: "/calls", label: "Звонки", icon: Phone },
  { href: "/chats", label: "Чаты", icon: MessageCircle },
  { href: "/profile", label: "Профиль", icon: UserRound },
] as const;

export function AppBottomDock({ incomingRequestCount }: { incomingRequestCount: number }) {
  const pathname = usePathname();
  const isChatRoom = /^\/chats\/[^/]+/.test(pathname) && !pathname.endsWith("/new") && pathname !== "/chats/search";
  const isMainAppScreen = MAIN_DOCK_PATHS.has(pathname);

  // Hidden inside /chats/[chatId]; visible on the main tabs. Rendered inline (no
  // portal) so it's present in the server HTML from the first paint — a
  // client-only portal mounted after hydration, which made the dock "fly" in on
  // first entry. There's no transformed ancestor on tab screens, so position:
  // fixed anchors to the viewport correctly.
  if (isChatRoom || !isMainAppScreen) {
    return null;
  }

  return (
    <nav
      className="pointer-events-none fixed left-1/2 z-[1000] w-[calc(100vw-1.5rem)] max-w-[23rem] lg:hidden"
      style={{
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
        transform: "translateX(-50%)",
      }}
      aria-label="Нижняя навигация"
    >
      <div className="pointer-events-auto flex w-full items-center gap-2">
        <div
          className="premium-glass dock-liquid grid min-w-0 flex-1 rounded-full p-1.5"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href || (tab.href === "/chats" && pathname === "/chats/search");
            const isChatsTab = tab.href === "/chats";
            const shouldShowBadge = isChatsTab && incomingRequestCount > 0;

            return (
              <Link
                key={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "fast-tap fluid-hit flex min-h-11 flex-col items-center justify-center gap-1 rounded-full px-1.5 py-1",
                  isActive ? "bg-[var(--dock-active-pill)] text-primary" : "text-foreground/64 hover:bg-[var(--dock-hover-bg)] dark:text-white/62",
                )}
                href={tab.href}
                prefetch={true}
              >
                <span className="relative">
                  <Icon className="h-[1.22rem] w-[1.22rem]" strokeWidth={isActive ? 2.55 : 2.25} />
                  {shouldShowBadge ? (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                      {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-[9px] font-semibold leading-none tracking-normal">{tab.label}</span>
              </Link>
            );
          })}
        </div>
        <Link
          aria-label="Поиск"
          className={clsx(
            "premium-glass dock-liquid fast-tap fluid-hit flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-foreground dark:text-white",
            pathname === "/chats/search" && "text-primary",
          )}
          href="/chats/search"
          prefetch={true}
        >
          <Search className="h-[1.35rem] w-[1.35rem]" strokeWidth={2.45} />
        </Link>
      </div>
    </nav>
  );
}
