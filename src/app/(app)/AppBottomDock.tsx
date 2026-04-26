"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircle, Phone, UserRound } from "lucide-react";

const LIQUID_FILTER_ID = "nox-liquid-glass-distortion";
const MAIN_DOCK_PATHS = new Set(["/calls", "/chats", "/profile"]);

const tabs = [
  { href: "/calls", label: "Звонки", icon: Phone },
  { href: "/chats", label: "Чаты", icon: MessageCircle },
  { href: "/profile", label: "Профиль", icon: UserRound },
] as const;

export function AppBottomDock({ incomingRequestCount }: { incomingRequestCount: number }) {
  const pathname = usePathname();
  const isOpenChat = /^\/chats\/[^/]+/.test(pathname);
  const isMainAppScreen = MAIN_DOCK_PATHS.has(pathname);

  if (isOpenChat || !isMainAppScreen) {
    return null;
  }

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

        <div className="app-bottom-dock">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = pathname === tab.href;
            const isChatsTab = tab.href === "/chats";
            const shouldShowBadge = isChatsTab && incomingRequestCount > 0;

            return (
              <Link
                key={tab.href}
                aria-current={isActive ? "page" : undefined}
                className="liquid-dock-item"
                data-active={isActive ? "true" : "false"}
                href={tab.href}
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
