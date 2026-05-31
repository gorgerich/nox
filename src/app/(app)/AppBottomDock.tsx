"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact2, MessageCircle, Phone, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const MAIN_DOCK_PATHS = new Set(["/contacts", "/calls", "/chats", "/profile"]);

const tabs = [
  { href: "/contacts", label: "Контакты", icon: Contact2 },
  { href: "/calls", label: "Звонки", icon: Phone },
  { href: "/chats", label: "Чаты", icon: MessageCircle },
  { href: "/profile", label: "Профиль", icon: UserRound },
] as const;

export function AppBottomDock({ incomingRequestCount }: { incomingRequestCount: number }) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const isChatRoom = /^\/chats\/[^/]+/.test(pathname) && !pathname.endsWith("/new");
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
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.4rem)" }}
      aria-label="Нижняя навигация"
    >
      <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-1.5">
        <div
          className="grid min-w-0 flex-1 rounded-full border border-white/70 bg-white/88 p-0.5 shadow-[0_8px_24px_rgba(15,23,42,0.13)] backdrop-blur-xl dark:border-white/10 dark:bg-neutral-950/78"
          style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
        >{/* search FAB removed — search lives in each screen's top input */}
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
                  "fast-tap flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-full px-1.5 py-1.5 transition-all duration-200",
                  isActive ? "bg-black/[0.08] text-primary dark:bg-white/12" : "text-foreground/78 hover:bg-black/[0.04] dark:text-white/78 dark:hover:bg-white/[0.07]",
                )}
                href={tab.href}
                prefetch={true}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={isActive ? 2.7 : 2.4} />
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
      </div>
    </nav>,
    document.body,
  );
}
