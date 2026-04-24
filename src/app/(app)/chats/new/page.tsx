import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { NewChatForm } from "./NewChatForm";

export default async function NewChatPage() {
  const user = await getCurrentUser();
  const prisma = getPrisma();
  const users = user
    ? await prisma.user.findMany({
        where: {
          id: { not: user.id },
          status: "ACTIVE",
        },
        orderBy: { username: "asc" },
        select: {
          id: true,
          username: true,
          profile: {
            select: {
              displayName: true,
            },
          },
        },
      })
    : [];

  return (
    <section className="mx-auto max-w-2xl">
      <Link className="inline-flex min-h-10 items-center text-sm text-neutral-400 transition hover:text-white" href="/chats">
        Назад к чатам
      </Link>

      <div className="mt-4 rounded-lg border border-neutral-800 bg-neutral-900 p-5 sm:p-6">
        <div className="mb-6">
          <p className="text-sm font-medium text-emerald-400">Новый чат</p>
          <h1 className="mt-1 text-2xl font-semibold">Создать чат</h1>
        </div>

        <NewChatForm
          users={users.map((item) => ({
            id: item.id,
            username: item.username,
            displayName: item.profile?.displayName ?? item.username,
          }))}
        />
      </div>
    </section>
  );
}
