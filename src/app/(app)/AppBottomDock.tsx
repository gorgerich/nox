"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact2, MessageCircle, Phone, Search, UserRound } from "lucide-react";

const tabs = [
  { href: "/contacts", label: "Контакты", icon: Contact2, match: (pathname: string) => pathname.startsWith("/contacts") || pathname.startsWith("/users/") },
  { href: "/calls", label: "Звонки", icon: Phone, match: (pathname: string) => pathname.startsWith("/calls") },
  { href: "/chats", label: "Чаты", icon: MessageCircle, match: (pathname: string) => pathname.startsWith("/chats") },
  { href: "/profile", label: "Профиль", icon: UserRound, match: (pathname: string) => pathname.startsWith("/profile") },
] as const;

function isFullscreenRoute(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const isChatDetail =
    segments[0] === "chats" &&
    segments.length === 2 &&
    !["archive", "new", "search"].includes(segments[1]);

  return isChatDetail || pathname === "/calls/incoming";
}

export function AppBottomDock({ incomingRequestCount }: { incomingRequestCount: number }) {
  const pathname = usePathname();
  const activeTab = tabs.find((tab) => tab.match(pathname)) ?? null;
  const isDockRoute = Boolean(activeTab);
  const isSearchActive = pathname === "/chats/search";

  // Four section tabs + one search action = five visible nav items. Section
  // screens keep dock; fullscreen task routes (active chat/call) own bottom UI.
  if (!isDockRoute || isFullscreenRoute(pathname)) {
    return null;
  }

  return (
    <nav
      className="pointer-events-none fixed left-1/2 z-[60] w-[calc(100vw-1.5rem)] max-w-[23rem] lg:hidden"
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
            const isActive = activeTab?.href === tab.href;
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
                scroll={false}
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
            isSearchActive && "text-primary",
          )}
          href="/chats/search"
          prefetch={true}
          scroll={false}
        >
          <Search className="h-[1.35rem] w-[1.35rem]" strokeWidth={2.45} />
        </Link>
      </div>
    </nav>
  );
}
