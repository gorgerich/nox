"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { MessageCircle, Phone, UserRound, Contact2 } from "lucide-react";

const LIQUID_FILTER_ID = "nox-liquid-glass-distortion";
const MAIN_DOCK_PATHS = new Set(["/contacts", "/calls", "/chats", "/profile"]);

const tabs = [
  { href: "/contacts", label: "Контакты", icon: Contact2 },
  { href: "/calls", label: "Звонки", icon: Phone },
  { href: "/chats", label: "Чаты", icon: MessageCircle },
  { href: "/profile", label: "Профиль", icon: UserRound },
] as const;

export function AppBottomDock({ incomingRequestCount }: { incomingRequestCount: number }) {
  const pathname = usePathname();
  const [optimisticPath, setOptimisticPath] = useState<string | null>(pathname);
  const [prevPathname, setPrevPathname] = useState<string | null>(pathname);

  if (pathname !== prevPathname) {
    setOptimisticPath(pathname);
    setPrevPathname(pathname);
  }

  const isChatRoom = /^\/chats\/[^/]+/.test(pathname) && !pathname.endsWith("/new");
  const isMainAppScreen = MAIN_DOCK_PATHS.has(pathname);

  // Requirement: hidden inside /chats/[chatId], visible on main tabs.
  // We also show it on main app screens to ensure it's there when needed.
  if (isChatRoom || !isMainAppScreen) {
    return null;
  }

  const currentPath = optimisticPath || pathname;

  return (
    <nav className="app-bottom-dock-shell lg:hidden" aria-label="Нижняя навигация">
      <svg
        aria-hidden="true"
        className="pointer-events-none absolute h-0 w-0 overflow-hidden"
        focusable="false"
      >
        <defs>
          <filter id={LIQUID_FILTER_ID} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence
              baseFrequency="0.008 0.012"
              numOctaves="2"
              result="noise"
              seed="17"
              type="fractalNoise"
            />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="32" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      <div className="liquid-dock-frame">
        <div className="liquid-dock-distortion" aria-hidden="true" />
        <div className="liquid-dock-highlight" aria-hidden="true" />

        <div className="app-bottom-dock" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentPath === tab.href;
            const isChatsTab = tab.href === "/chats";
            const shouldShowBadge = isChatsTab && incomingRequestCount > 0;

            return (
              <Link
                key={tab.href}
                aria-current={isActive ? "page" : undefined}
                className="liquid-dock-item"
                data-active={isActive ? "true" : "false"}
                href={tab.href}
                prefetch={true}
                onClick={() => setOptimisticPath(tab.href)}
                onPointerDown={() => setOptimisticPath(tab.href)}
              >
                <span className="liquid-dock-pill">
                  <span className="relative">
                    <Icon className="liquid-dock-icon" strokeWidth={2.2} />
                    {shouldShowBadge ? (
                      <span className={clsx("liquid-dock-badge", isActive && "liquid-dock-badge-active")}>
                        {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
                      </span>
                    ) : null}
                  </span>
                  <span className="liquid-dock-label">{tab.label}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
