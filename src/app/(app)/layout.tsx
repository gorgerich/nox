import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminRole } from "@/lib/permissions";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 bg-neutral-950/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-4">
          <Link className="shrink-0 text-sm font-semibold tracking-wide text-emerald-300 sm:text-base" href="/chats">
            <span className="sm:hidden">Мессенджер</span>
            <span className="hidden sm:inline">Закрытый мессенджер</span>
          </Link>

          <nav className="flex items-center gap-1.5 text-sm sm:gap-3">
            <Link className="inline-flex min-h-10 items-center px-1 text-neutral-300 transition hover:text-white" href="/chats">
              Чаты
            </Link>
            {isAdminRole(user.role) ? (
              <Link className="inline-flex min-h-10 items-center px-1 text-neutral-300 transition hover:text-white" href="/admin">
                Админка
              </Link>
            ) : null}
            <form action="/api/auth/logout" method="post">
              <button className="min-h-10 rounded-md border border-neutral-700 px-2.5 py-2 text-neutral-200 transition hover:border-neutral-500 hover:text-white sm:px-3">
                Выйти
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-3 py-3 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
