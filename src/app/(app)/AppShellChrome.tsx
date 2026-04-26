"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useLayoutEffect } from "react";

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
  const isAdmin = user.role === "OWNER" || user.role === "ADMIN";

  useEffect(() => {
    if (isChatRoom) {
      document.body.classList.add("hide-bottom-nav");
    } else {
      document.body.classList.remove("hide-bottom-nav");
    }
    return () => {
      document.body.classList.remove("hide-bottom-nav");
    };
  }, [isChatRoom]);

  useLayoutEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const root = document.documentElement;
    const probe = document.createElement("div");
    probe.className = "safe-area-bottom-probe";
    document.body.appendChild(probe);

    const syncSafeArea = () => {
      const computed = window.getComputedStyle(probe).paddingBottom;
      const inset = Number.parseFloat(computed) || 0;
      root.style.setProperty("--app-safe-bottom", `${Math.round(inset)}px`);
    };

    syncSafeArea();
    window.addEventListener("orientationchange", syncSafeArea);
    window.addEventListener("resize", syncSafeArea);

    return () => {
      window.removeEventListener("orientationchange", syncSafeArea);
      window.removeEventListener("resize", syncSafeArea);
      probe.remove();
    };
  }, []);

  if (isChatRoom) {
    return <>{children}</>;
  }

  return (
    <div className="app-screen">
      {/* Desktop Header */}
      <header className="hidden lg:sticky lg:top-0 lg:z-40 lg:block lg:border-b lg:border-border-subtle lg:bg-background/80 lg:backdrop-blur-lg transition-smooth">
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
        <header className="sticky top-0 z-40 bg-background/80 backdrop-blur-lg lg:hidden safe-top transition-smooth border-b border-border-subtle/50">
          <div className="flex items-center justify-between px-6 py-4">
            <span className="text-xl font-black tracking-tighter text-primary">Nox</span>
          </div>
        </header>
      )}

      <main className="flex-1 w-full">
        {children}
      </main>

      <nav className="app-bottom-dock-shell lg:hidden">
        <div className="app-bottom-dock relative h-[72px] overflow-hidden border border-white/10 bg-black/90 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.3)] backdrop-blur-2xl">
          {/* Active Tab Highlight Pill */}
          {(pathname === '/calls' || pathname === '/chats' || pathname === '/profile') && (
            <div 
              className="absolute h-[56px] bg-white rounded-[2rem] transition-all duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] shadow-xl"
              style={{ 
                width: 'calc((100% - 16px) / 3)',
                left: `calc(8px + ((${pathname === '/calls' ? 0 : pathname === '/chats' ? 1 : 2}) * (100% - 16px) / 3))`,
              }}
            />
          )}
          
          <NavLink href="/calls" icon={<CallIcon />} label="Звонки" isActive={pathname === '/calls'} />
          <NavLink href="/chats" icon={<ChatIcon />} label="Чаты" isActive={pathname === '/chats'} count={incomingRequestCount} />
          <NavLink href="/profile" icon={<ProfileIcon />} label="Профиль" isActive={pathname === '/profile'} />
        </div>
      </nav>
    </div>
  );
}

function NavLink({ href, icon, label, count, isActive }: { href: string; icon: React.ReactNode; label: string; count?: number; isActive: boolean }) {
  return (
    <Link
      href={href}
      className={`relative z-10 flex flex-col items-center justify-center gap-1 w-full h-full transition-colors duration-300 ${isActive ? 'text-black' : 'text-white/60 dark:text-white/50'}`}
    >
      <div className="relative">
        {icon}
        {count && count > 0 ? (
          <span className={`absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-black ring-2 ${isActive ? 'bg-primary text-white ring-white' : 'bg-primary text-white ring-black'}`}>
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </div>
      <span className="text-[10px] font-black uppercase tracking-tighter opacity-90">{label}</span>
    </Link>
  );
}

function ChatIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  );
}

function CallIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

function ProfileIcon() {
  return (
    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}
