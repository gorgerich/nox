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

export function AppShellChrome({ incomingRequestCount, children }: AppShellChromeProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isChatRoom = /^\/chats\/[^/]+$/.test(pathname) && !pathname.endsWith("/new") && pathname !== "/chats/search";
  const isMainDockScreen = pathname === "/chats" || pathname === "/chats/search" || pathname === "/calls" || pathname === "/profile" || pathname === "/contacts";

  useEffect(() => {
    router.prefetch("/contacts");
    router.prefetch("/chats");
    router.prefetch("/calls");
    router.prefetch("/profile");
  }, [router]);

  if (isChatRoom) {
    return <>{children}</>;
  }

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
