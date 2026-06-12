"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact2, MessageCircle, Phone, Search, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const MAIN_DOCK_PATHS = new Set(["/contacts", "/calls", "/chats", "/chats/search", "/profile"]);

const tabs = [
  { href: "/contacts", label: "Контакты", icon: Contact2 },
  { href: "/calls", label: "Звонки", icon: Phone },
  { href: "/chats", label: "Чаты", icon: MessageCircle },
  { href: "/profile", label: "Профиль", icon: UserRound },
] as const;

export function AppBottomDock({ incomingRequestCount }: { incomingRequestCount: number }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const isChatRoom = /^\/chats\/[^/]+/.test(pathname) && !pathname.endsWith("/new") && pathname !== "/chats/search";
  const isMainAppScreen = MAIN_DOCK_PATHS.has(pathname);

  useEffect(() => {
    const timeoutId = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(timeoutId);
  }, []);

  // Requirement: hidden inside /chats/[chatId], visible on main tabs.
  // We also show it on main app screens to ensure it's there when needed.
  if (!mounted || isChatRoom || !isMainAppScreen) {
    return null;
  }

  return createPortal(
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-60 px-3 lg:hidden"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.35rem)" }}
      aria-label="Нижняя навигация"
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-[21.5rem] items-center gap-1">
        <div
          className="premium-glass dock-liquid grid min-w-0 flex-1 rounded-full p-0.5"
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
                  "fast-tap fluid-hit flex min-h-10 flex-col items-center justify-center gap-0.5 rounded-full px-1 py-1",
                  isActive ? "bg-white/72 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_1px_5px_rgba(15,23,42,0.08)] dark:bg-white/12 dark:shadow-none" : "text-foreground/72 hover:bg-white/40 dark:text-white/70 dark:hover:bg-white/[0.07]",
                )}
                href={tab.href}
                prefetch={true}
              >
                <span className="relative">
                  <Icon className="h-[1.15rem] w-[1.15rem]" strokeWidth={isActive ? 2.6 : 2.35} />
                  {shouldShowBadge ? (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                      {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-[8.5px] font-semibold leading-none tracking-normal">{tab.label}</span>
              </Link>
            );
          })}
        </div>
        <Link
          aria-label="Поиск"
          className={clsx(
            "premium-glass dock-liquid fast-tap fluid-hit flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground dark:text-white",
            pathname === "/chats/search" && "text-primary",
          )}
          href="/chats/search"
          prefetch={true}
        >
          <Search className="h-5 w-5" strokeWidth={2.45} />
        </Link>
      </div>
    </nav>,
    document.body,
  );
}
