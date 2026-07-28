"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Phone, Search, UserRound, UsersRound } from "lucide-react";
import { normalizeAvatarUrl } from "@/lib/media-url";

// Four section tabs in the bar; search stays a separate adjacent control (see
// the search button below), sharing the dock's material and height so the two
// read as one bottom assembly rather than two unrelated islands.
const tabs = [
  { href: "/contacts", label: "Контакты", icon: UsersRound, match: (pathname: string) => pathname.startsWith("/contacts") || pathname.startsWith("/users/") },
  { href: "/calls", label: "Звонки", icon: Phone, match: (pathname: string) => pathname.startsWith("/calls") },
  { href: "/chats", label: "Чаты", icon: MessageCircle, match: (pathname: string) => pathname.startsWith("/chats") },
  { href: "/profile", label: "Профиль", icon: UserRound, match: (pathname: string) => pathname.startsWith("/profile") || pathname.startsWith("/admin") },
] as const;

type DockSwipeStart = {
  x: number;
  y: number;
  pointerId: number;
  dragging: boolean;
};

function getTabScrollKey(href: string) {
  return `nox:tab-scroll:${href}`;
}

function isFullscreenRoute(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const isChatDetail =
    segments[0] === "chats" &&
    segments.length === 2 &&
    !["archive", "new", "search"].includes(segments[1]);

  return isChatDetail || pathname === "/calls/incoming";
}

export function AppBottomDock({
  incomingRequestCount,
  avatarUrl,
}: {
  incomingRequestCount: number;
  avatarUrl: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const dockRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<DockSwipeStart | null>(null);
  const suppressClickRef = useRef(false);
  const [isSuppressed, setIsSuppressed] = useState(false);
  const activeTab = tabs.find((tab) => tab.match(pathname)) ?? null;
  const activeTabIndex = activeTab ? tabs.findIndex((tab) => tab.href === activeTab.href) : -1;

  // Sliding highlight pill (expo-glass-tabs style): a single element that
  // glides between tabs instead of each tab swapping its own background. Its
  // geometry is measured from the active tab and tracked while that tab grows
  // (the label expands over 220ms), so the pill follows in lockstep.
  const tabsBoxRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const pillAnimatedRef = useRef(false);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const isDockRoute = Boolean(activeTab);
  const isSearchActive = pathname === "/chats/search";
  const normalizedAvatarUrl = normalizeAvatarUrl(avatarUrl);

  const markSearchMotion = () => {
    try {
      window.sessionStorage.setItem("nox:route-motion", "search-pop");
    } catch {
      // ignore unavailable sessionStorage
    }
  };

  useEffect(() => {
    const dock = dockRef.current;
    if (!dock || activeTabIndex < 0) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
        swipeStartRef.current = null;
        return;
      }

      swipeStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        pointerId: event.pointerId,
        dragging: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const start = swipeStartRef.current;
      if (!start || start.pointerId !== event.pointerId) {
        return;
      }

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (!start.dragging && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        start.dragging = true;
        suppressClickRef.current = true;
        dock.setPointerCapture(event.pointerId);
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const start = swipeStartRef.current;
      swipeStartRef.current = null;
      if (!start || start.pointerId !== event.pointerId) {
        return;
      }

      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.25) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const nextIndex = dx < 0 ? activeTabIndex + 1 : activeTabIndex - 1;
      const nextTab = tabs[nextIndex];
      if (nextTab) {
        router.push(nextTab.href, { scroll: false });
      }
    };

    const handlePointerCancel = () => {
      swipeStartRef.current = null;
    };

    dock.addEventListener("pointerdown", handlePointerDown);
    dock.addEventListener("pointermove", handlePointerMove);
    dock.addEventListener("pointerup", handlePointerUp);
    dock.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      dock.removeEventListener("pointerdown", handlePointerDown);
      dock.removeEventListener("pointermove", handlePointerMove);
      dock.removeEventListener("pointerup", handlePointerUp);
      dock.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [activeTabIndex, router]);

  useEffect(() => {
    const handleDockVisibility = (event: Event) => {
      const detail = (event as CustomEvent<{ hidden?: boolean }>).detail;
      setIsSuppressed(Boolean(detail?.hidden));
    };

    window.addEventListener("nox:dock-visibility", handleDockVisibility);
    return () => {
      window.removeEventListener("nox:dock-visibility", handleDockVisibility);
    };
  }, []);

  const measurePill = useCallback(() => {
    const box = tabsBoxRef.current;
    const el = tabRefs.current[activeTabIndex];
    if (!box || !el || activeTabIndex < 0) {
      setPill(null);
      return;
    }
    const boxRect = box.getBoundingClientRect();
    const tabRect = el.getBoundingClientRect();
    setPill({ left: tabRect.left - boxRect.left, width: tabRect.width });
  }, [activeTabIndex]);

  // Measure the active tab and keep tracking it while it grows (label expand)
  // or the viewport resizes, so the sliding pill stays glued to it.
  useEffect(() => {
    measurePill();
    const box = tabsBoxRef.current;
    const el = tabRefs.current[activeTabIndex];
    if (!box || !el || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => measurePill());
    observer.observe(box);
    observer.observe(el);
    window.addEventListener("resize", measurePill);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measurePill);
    };
  }, [measurePill, activeTabIndex]);

  // Enable the glide only after the first placement so the pill doesn't slide
  // in from the corner on mount.
  useEffect(() => {
    if (pill) {
      const id = window.requestAnimationFrame(() => { pillAnimatedRef.current = true; });
      return () => window.cancelAnimationFrame(id);
    }
  }, [pill]);

  // Subtle haptic tick when the active tab actually changes (native/coarse only).
  const prevTabIndexRef = useRef(activeTabIndex);
  useEffect(() => {
    if (
      prevTabIndexRef.current !== activeTabIndex &&
      prevTabIndexRef.current !== -1 &&
      activeTabIndex !== -1 &&
      typeof navigator !== "undefined" &&
      typeof navigator.vibrate === "function" &&
      window.matchMedia("(pointer: coarse)").matches
    ) {
      navigator.vibrate(8);
    }
    prevTabIndexRef.current = activeTabIndex;
  }, [activeTabIndex]);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
  }, []);

  const handleTabClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string, isActive: boolean) => {
    if (!isActive || pathname !== href) {
      return;
    }

    event.preventDefault();
    try {
      window.sessionStorage.setItem(getTabScrollKey(href), "0");
    } catch {
      // ignore unavailable sessionStorage
    }

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [pathname]);

  // Four section tabs + one search action = five visible nav items. Section
  // screens keep dock; fullscreen task routes (active chat/call) own bottom UI.
  if (!isDockRoute || isFullscreenRoute(pathname) || isSuppressed) {
    return null;
  }

  return (
    <nav
      // The bottom offset is a plain CSS token, identical on the server and in
      // the first client frame, so the dock is already in its final place in the
      // first painted frame. No measurement, no effect and no viewport listener
      // participates in the closed-keyboard position — the real keyboard is a
      // separate concern and does not move this element.
      className="messenger-dock pointer-events-none fixed left-1/2 z-[1000] w-[calc(100vw-1.75rem)] max-w-[22.5rem] lg:hidden"
      aria-label="Нижняя навигация"
    >
      <div
        ref={dockRef}
        className="pointer-events-auto flex w-full touch-pan-y select-none items-center gap-1.5"
        onClickCapture={handleClickCapture}
      >
        <div
          ref={tabsBoxRef}
          className="premium-glass dock-liquid relative flex min-w-0 flex-1 items-center rounded-full p-1.5"
        >
          {pill ? (
            <span
              aria-hidden="true"
              className="dock-slide-pill"
              style={{
                transform: `translateX(${pill.left}px)`,
                width: `${pill.width}px`,
                transition: pillAnimatedRef.current
                  ? "transform 340ms var(--ease-out), width 340ms var(--ease-out)"
                  : "none",
              }}
            />
          ) : null}
          {tabs.map((tab, index) => {
            const Icon = tab.icon;
            const isActive = activeTab?.href === tab.href;
            const isChatsTab = tab.href === "/chats";
            const shouldShowBadge = isChatsTab && incomingRequestCount > 0;

            return (
              <Link
                key={tab.href}
                ref={(node) => { tabRefs.current[index] = node; }}
                aria-current={isActive ? "page" : undefined}
                className={clsx(
                  "dock-tab fast-tap fluid-hit relative z-10 flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-full px-2 py-1",
                  isActive ? "dock-tab-active flex-[1.45]" : "flex-1",
                  // Inactive items used to sit at 62-64% opacity, which made them
                  // nearly invisible on the light dock. They now use the
                  // secondary-text token, which is contrast-checked in both themes.
                  isActive ? "text-primary" : "text-[var(--dock-inactive)] hover:bg-[var(--dock-hover-bg)]",
                )}
                href={tab.href}
                prefetch={true}
                scroll={false}
                draggable={false}
                onClick={(event) => handleTabClick(event, tab.href, isActive)}
                onDragStart={(event) => event.preventDefault()}
              >
                <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
                  {tab.href === "/profile" && normalizedAvatarUrl ? (
                    <Image
                      src={normalizedAvatarUrl}
                      alt=""
                      width={24}
                      height={24}
                      className={clsx(
                        "dock-profile-avatar h-6 w-6 rounded-full object-cover outline-none",
                        isActive && "dock-profile-avatar-active",
                      )}
                    />
                  ) : (
                    <Icon
                      className={clsx("dock-tab-icon h-[1.28rem] w-[1.28rem]", isActive && "dock-tab-icon-active")}
                      strokeWidth={isActive ? 2.45 : 2.05}
                    />
                  )}
                  {shouldShowBadge ? (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                      {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
                    </span>
                  ) : null}
                </span>
                <span
                  className={clsx(
                    "dock-tab-label overflow-hidden whitespace-nowrap text-[11px] font-semibold leading-none tracking-normal",
                    isActive ? "max-w-16 opacity-100" : "max-w-0 opacity-0",
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            );
          })}
        </div>
        <Link
          aria-label="Поиск"
          aria-current={isSearchActive ? "page" : undefined}
          className={clsx(
            "premium-glass dock-liquid fast-tap fluid-hit flex h-[3.25rem] w-[3.25rem] shrink-0 items-center justify-center rounded-full transition-smooth active:scale-[0.94]",
            isSearchActive ? "text-primary" : "text-[var(--dock-inactive)]",
          )}
          href="/chats/search"
          prefetch={true}
          scroll={false}
          onClick={markSearchMotion}
          draggable={false}
          onDragStart={(event) => event.preventDefault()}
        >
          <Search className="h-[1.3rem] w-[1.3rem]" strokeWidth={2.2} />
        </Link>
      </div>
    </nav>
  );
}
