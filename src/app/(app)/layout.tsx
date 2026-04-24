import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";
import { getPrisma } from "@/lib/prisma";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const prisma = getPrisma();
  const incomingRequestCount = await prisma.chatRequest.count({
    where: {
      toUserId: user.id,
      status: "PENDING",
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border-subtle bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <Link className="flex items-center gap-2 transition-opacity hover:opacity-80" href="/chats">
            <span className="text-xl font-bold tracking-tighter text-primary">Nox</span>
          </Link>

          <nav className="flex items-center gap-2">
            <Link 
              className="flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted transition hover:bg-surface-hover hover:text-foreground" 
              href="/chats"
            >
              Чаты
              {incomingRequestCount > 0 ? (
                <span className="ml-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-neutral-950">
                  {incomingRequestCount > 9 ? "9+" : incomingRequestCount}
                </span>
              ) : null}
            </Link>
            {isAdminRole(user.role) ? (
              <Link 
                className="flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted transition hover:bg-surface-hover hover:text-foreground" 
                href="/admin"
              >
                Админ
              </Link>
            ) : null}
            <div className="ml-1 h-6 w-px bg-border-subtle" />
            <form action="/api/auth/logout" method="post">
              <button className="flex h-10 items-center rounded-xl px-3 text-sm font-medium text-muted transition hover:bg-red-500/10 hover:text-red-400">
                Выйти
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}
