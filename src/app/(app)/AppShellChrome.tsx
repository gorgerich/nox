"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import clsx from "clsx";
import { AppBottomDock } from "./AppBottomDock";
import { DockDiagnostics } from "./DockDiagnostics";

interface AppShellChromeProps {
  user: {
    role: string;
    avatarUrl: string | null;
  };
  incomingRequestCount: number;
  children: React.ReactNode;
}

const TAB_SCROLL_PATHS = new Set(["/contacts", "/calls", "/chats", "/profile", "/admin"]);
const TAB_ROUTES = ["/contacts", "/calls", "/chats", "/profile"] as const;

type RouteMotion = "route-motion-idle" | "route-pop-search" | "route-slide-left" | "route-slide-right";

type SwipeStart = {
  x: number;
  y: number;
  time: number;
  pointerId: number;
};

function getTabScrollKey(pathname: string) {
  return TAB_SCROLL_PATHS.has(pathname) ? `nox:tab-scroll:${pathname}` : null;
}

function getTabIndex(pathname: string) {
  if (pathname.startsWith("/contacts") || pathname.startsWith("/users/")) return 0;
  if (pathname.startsWith("/calls")) return 1;
  if (pathname.startsWith("/chats")) return 2;
  if (pathname.startsWith("/profile") || pathname.startsWith("/admin")) return 3;
  return -1;
}

function readScrollPosition(key: string) {
  try {
    const saved = window.sessionStorage.getItem(key);
    const value = saved ? Number(saved) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function saveScrollPosition(key: string) {
  try {
    window.sessionStorage.setItem(key, String(Math.max(0, Math.round(window.scrollY))));
  } catch {
    // Tab navigation still works when storage is unavailable.
  }
}

function isFullscreenRoute(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const isChatDetail =
    segments[0] === "chats" &&
    segments.length === 2 &&
    !["archive", "new", "search"].includes(segments[1]);

  return isChatDetail || pathname === "/calls/incoming";
}

export function AppShellChrome({ user, incomingRequestCount, children }: AppShellChromeProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isMainDockScreen = pathname === "/chats" || pathname === "/chats/search" || pathname === "/calls" || pathname === "/profile" || pathname === "/contacts" || pathname === "/admin";
  const fullscreenRoute = isFullscreenRoute(pathname);
  const swipeStartRef = useRef<SwipeStart | null>(null);
  const previousPathnameRef = useRef(pathname);
  const motionTimeoutRef = useRef<number | null>(null);
  const [routeMotion, setRouteMotion] = useState<RouteMotion>("route-motion-idle");
  const activeTabIndex = useMemo(() => getTabIndex(pathname), [pathname]);

  useEffect(() => {
    router.prefetch("/contacts");
    router.prefetch("/chats");
    router.prefetch("/calls");
    router.prefetch("/profile");
  }, [router]);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;

    if (previousPathname === pathname) {
      return;
    }

    if (motionTimeoutRef.current !== null) {
      window.clearTimeout(motionTimeoutRef.current);
    }

    const fromIndex = getTabIndex(previousPathname);
    const toIndex = getTabIndex(pathname);
    const cameFromSearchButton = (() => {
      try {
        return window.sessionStorage.getItem("nox:route-motion") === "search-pop";
      } catch {
        return false;
      }
    })();

    try {
      window.sessionStorage.removeItem("nox:route-motion");
    } catch {
      // ignore unavailable sessionStorage
    }

    const nextMotion: RouteMotion =
      pathname === "/chats/search" && cameFromSearchButton
        ? "route-pop-search"
        : fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex
          ? toIndex > fromIndex ? "route-slide-left" : "route-slide-right"
          : "route-motion-idle";

    setRouteMotion("route-motion-idle");
    const frameId = window.requestAnimationFrame(() => {
      setRouteMotion(nextMotion);
      motionTimeoutRef.current = window.setTimeout(() => {
        setRouteMotion("route-motion-idle");
      }, 360);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (motionTimeoutRef.current !== null) {
        window.clearTimeout(motionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const key = getTabScrollKey(pathname);

    if (!key) {
      return;
    }

    const restoreY = readScrollPosition(key);
    // Restore the saved scroll position over a couple of frames (content paints
    // async), but abort the instant the user touches the screen so we never
    // yank them back mid-scroll. Skip entirely when restoring to the top.
    const restoreTimeouts: number[] =
      restoreY > 0
        ? [0, 50, 150, 350].map((delay) =>
            window.setTimeout(() => {
              window.scrollTo(0, restoreY);
            }, delay),
          )
        : [];
    const cancelRestore = () => {
      restoreTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      window.removeEventListener("wheel", cancelRestore);
      window.removeEventListener("touchstart", cancelRestore);
      window.removeEventListener("keydown", cancelRestore);
    };
    if (restoreTimeouts.length > 0) {
      window.addEventListener("wheel", cancelRestore, { passive: true });
      window.addEventListener("touchstart", cancelRestore, { passive: true });
      window.addEventListener("keydown", cancelRestore);
    }

    let saveFrameId: number | null = null;
    const saveScroll = () => {
      if (saveFrameId !== null) return;
      saveFrameId = window.requestAnimationFrame(() => {
        saveFrameId = null;
        saveScrollPosition(key);
      });
    };

    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", saveScroll);

    return () => {
      cancelRestore();
      if (saveFrameId !== null) {
        window.cancelAnimationFrame(saveFrameId);
      }
      saveScrollPosition(key);
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", saveScroll);
    };
  }, [pathname]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || activeTabIndex < 0 || (event.pointerType === "mouse" && event.button !== 0)) {
      swipeStartRef.current = null;
      return;
    }

    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, button, [role='button'], [data-nox-swipe-ignore='true'], [data-nox-horizontal-scroll='true']")) {
      swipeStartRef.current = null;
      return;
    }

    swipeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      pointerId: event.pointerId,
    };
  }, [activeTabIndex]);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    if (!start || start.pointerId !== event.pointerId) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
      swipeStartRef.current = null;
    }
  }, []);

  const handlePointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const start = swipeStartRef.current;
    swipeStartRef.current = null;
    if (!start || start.pointerId !== event.pointerId || activeTabIndex < 0) {
      return;
    }

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    const elapsed = Date.now() - start.time;
    const isHorizontal = Math.abs(dx) > 74 && Math.abs(dx) > Math.abs(dy) * 1.35;
    if (!isHorizontal || elapsed > 700) {
      return;
    }

    const nextIndex = dx < 0 ? activeTabIndex + 1 : activeTabIndex - 1;
    const nextRoute = TAB_ROUTES[nextIndex];
    if (!nextRoute) {
      return;
    }

    router.push(nextRoute, { scroll: false });
  }, [activeTabIndex, router]);

  const handlePointerCancel = useCallback(() => {
    swipeStartRef.current = null;
  }, []);

  if (fullscreenRoute) {
    return <>{children}</>;
  }

  return (
    <>
      <div
        className="app-screen"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
      >
        <main className={clsx(isMainDockScreen ? "main-app-content flex-1 w-full" : "flex-1 w-full", routeMotion)}>
          {children}
        </main>
      </div>

      <AppBottomDock incomingRequestCount={incomingRequestCount} avatarUrl={user.avatarUrl} />
      {/* Renders nothing and attaches nothing unless ?dockDiagnostics=1. */}
      <DockDiagnostics />
    </>
  );
}
