"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppBottomDock } from "./AppBottomDock";

interface AppShellChromeProps {
  user: {
    role: string;
  };
  incomingRequestCount: number;
  children: React.ReactNode;
}

const TAB_SCROLL_PATHS = new Set(["/contacts", "/calls", "/chats", "/profile"]);

function getTabScrollKey(pathname: string) {
  return TAB_SCROLL_PATHS.has(pathname) ? `nox:tab-scroll:${pathname}` : null;
}

export function AppShellChrome({ incomingRequestCount, children }: AppShellChromeProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isMainDockScreen = pathname === "/chats" || pathname === "/chats/search" || pathname === "/calls" || pathname === "/profile" || pathname === "/contacts";

  useEffect(() => {
    router.prefetch("/contacts");
    router.prefetch("/chats");
    router.prefetch("/calls");
    router.prefetch("/profile");
  }, [router]);

  useEffect(() => {
    const key = getTabScrollKey(pathname);

    if (!key) {
      return;
    }

    const saved = window.sessionStorage.getItem(key);
    const nextY = saved ? Number(saved) : 0;
    const restoreY = Number.isFinite(nextY) ? nextY : 0;
    const restoreTimeouts = [0, 50, 150, 350, 700, 1200].map((delay) =>
      window.setTimeout(() => {
        window.scrollTo(0, restoreY);
      }, delay),
    );

    let saveFrameId: number | null = null;
    const saveScroll = () => {
      if (saveFrameId !== null) return;
      saveFrameId = window.requestAnimationFrame(() => {
        saveFrameId = null;
        window.sessionStorage.setItem(key, String(Math.max(0, Math.round(window.scrollY))));
      });
    };

    window.addEventListener("scroll", saveScroll, { passive: true });
    window.addEventListener("pagehide", saveScroll);

    return () => {
      restoreTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
      if (saveFrameId !== null) {
        window.cancelAnimationFrame(saveFrameId);
      }
      window.sessionStorage.setItem(key, String(Math.max(0, Math.round(window.scrollY))));
      window.removeEventListener("scroll", saveScroll);
      window.removeEventListener("pagehide", saveScroll);
    };
  }, [pathname]);

  return (
    <>
      <div className="app-screen">
        <main className={isMainDockScreen ? "main-app-content flex-1 w-full" : "flex-1 w-full"}>
          {children}
        </main>
      </div>

      <AppBottomDock incomingRequestCount={incomingRequestCount} />
    </>
  );
}
