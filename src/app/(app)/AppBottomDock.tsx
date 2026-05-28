"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, Phone, UserRound, Contact2 } from "lucide-react";

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
      className="fixed inset-x-0 bottom-0 z-60 border-t border-border-subtle/60 lg:hidden"
      style={{
        backgroundColor: "var(--nav-background)",
        paddingBottom: "env(safe-area-inset-bottom)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
      }}
      aria-label="Нижняя навигация"
    >
      <div
        className="mx-auto grid w-full max-w-lg"
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
                "flex flex-col items-center justify-center gap-1 pt-2 pb-1.5 transition-colors duration-150 fast-tap",
                isActive ? "text-primary" : "text-muted/70",
              )}
              href={tab.href}
              prefetch={true}
            >
              <span className="relative">
                <Icon className="h-6 w-6" strokeWidth={isActive ? 2.4 : 2} />
                {shouldShowBadge ? (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                    {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] font-medium tracking-tight">{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
