"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact2, MessageCircle, Phone, Search, UserRound } from "lucide-react";

const MAIN_DOCK_PATHS = new Set(["/contacts", "/calls", "/chats", "/profile"]);

const tabs = [
  { href: "/contacts", label: "Контакты", icon: Contact2 },
  { href: "/calls", label: "Звонки", icon: Phone },
  { href: "/chats", label: "Чаты", icon: MessageCircle },
  { href: "/profile", label: "Профиль", icon: UserRound },
] as const;

export function AppBottomDock({ incomingRequestCount }: { incomingRequestCount: number }) {
  const pathname = usePathname();
  const isChatRoom = /^\/chats\/[^/]+/.test(pathname) && !pathname.endsWith("/new");
  const isMainAppScreen = MAIN_DOCK_PATHS.has(pathname);

  // Requirement: hidden inside /chats/[chatId], visible on main tabs.
  // We also show it on main app screens to ensure it's there when needed.
  if (isChatRoom || !isMainAppScreen) {
    return null;
  }

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-60 px-3 pb-2 lg:hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      aria-label="Нижняя навигация"
    >
      <div className="mx-auto flex w-full max-w-lg items-center gap-2">
        <div
          className="grid min-w-0 flex-1 rounded-full border border-white/70 bg-white/85 p-1 shadow-[0_12px_34px_rgba(15,23,42,0.14)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/74"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href;
            const isChatsTab = tab.href === "/chats";
            const shouldShowBadge = isChatsTab && incomingRequestCount > 0;

            return (
              <Link
                key={tab.href}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "fast-tap flex min-h-16 flex-col items-center justify-center gap-1 rounded-full px-2 py-2 transition-all duration-200",
                  isActive ? "bg-black/[0.08] text-primary dark:bg-white/12" : "text-foreground/78 hover:bg-black/[0.04] dark:text-white/78 dark:hover:bg-white/[0.07]",
                )}
                href={tab.href}
                prefetch={true}
              >
                <span className="relative">
                  <Icon className="h-6 w-6" strokeWidth={isActive ? 2.7 : 2.4} />
                  {shouldShowBadge ? (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                      {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-[11px] font-semibold leading-none tracking-normal">{tab.label}</span>
              </Link>
            );
          })}
        </div>

        <Link
          aria-label="Поиск"
          className="fast-tap flex h-[4.5rem] w-[4.5rem] shrink-0 items-center justify-center rounded-full border border-white/70 bg-white/85 text-foreground shadow-[0_12px_34px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-all duration-200 active:scale-95 dark:border-white/10 dark:bg-neutral-950/74 dark:text-white"
          href="/chats"
          prefetch={true}
        >
          <Search className="h-8 w-8" strokeWidth={2.5} />
        </Link>
      </div>
    </nav>
  );
}
