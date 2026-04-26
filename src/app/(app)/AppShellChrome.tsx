"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { AppBottomDock } from "./AppBottomDock";

interface AppShellChromeProps {
  user: {
    role: string;
  };
  incomingRequestCount: number;
  children: React.ReactNode;
}

export function AppShellChrome({ user, incomingRequestCount, children }: AppShellChromeProps) {
  const pathname = usePathname();
  const isChatRoom = /^\/chats\/[^/]+$/.test(pathname) && !pathname.endsWith("/new");
  const isChatsList = pathname === "/chats";
  const isMainDockScreen = pathname === "/chats" || pathname === "/calls" || pathname === "/profile";
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";

  if (isChatRoom) {
    return <>{children}</>;
  }

  return (
    <div className="app-screen">
      {/* Desktop Header */}
      <header className="liquid-top-chrome hidden lg:sticky lg:top-0 lg:z-40 lg:block lg:border-b transition-smooth">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link className="flex items-center gap-2 transition-smooth hover:opacity-80 active:scale-[0.98]" href="/chats">
            <span className="text-2xl font-black tracking-tighter text-primary">Nox</span>
          </Link>

          <nav className="flex items-center gap-6">
            <Link className="text-sm font-bold text-muted transition-smooth hover:text-foreground active:scale-95" href="/chats">Чаты</Link>
            <Link className="text-sm font-bold text-muted transition-smooth hover:text-foreground active:scale-95" href="/calls">Звонки</Link>
            {isAdmin && (
              <Link className="text-sm font-bold text-muted transition-smooth hover:text-foreground active:scale-95" href="/admin">Админ</Link>
            )}
            <Link className="text-sm font-bold text-muted transition-smooth hover:text-foreground active:scale-95" href="/profile">Профиль</Link>
          </nav>
        </div>
      </header>

      {/* Mobile Top Header - ONLY for subpages, not for main tabs with large titles */}
      {!isChatsList && pathname !== "/calls" && pathname !== "/profile" && (
        <header className="liquid-top-chrome sticky top-0 z-40 lg:hidden safe-top transition-smooth border-b">
          <div className="flex items-center justify-between px-6 py-4">
            <span className="text-xl font-black tracking-tighter text-primary">Nox</span>
          </div>
        </header>
      )}

      <main className={isMainDockScreen ? "main-app-content flex-1 w-full" : "flex-1 w-full"}>
        {children}
      </main>

      <AppBottomDock incomingRequestCount={incomingRequestCount} />
    </div>
  );
}
