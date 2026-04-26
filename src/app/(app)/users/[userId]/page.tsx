import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { userId } = await params;
  const prisma = getPrisma();

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  });

  if (!targetUser || targetUser.status !== "ACTIVE") {
    redirect("/contacts");
  }

  const displayName = targetUser.profile?.displayName || targetUser.username;
  const avatarUrl = targetUser.profile?.avatarUrl;
  const fullAvatarUrl = avatarUrl
    ? avatarUrl.startsWith("http")
      ? avatarUrl
      : `/api/avatars/${avatarUrl}`
    : null;

  return (
    <div className="app-section animate-in fade-in duration-300">
      <header className="app-section-header">
        <h1 className="app-section-title">Профиль</h1>
      </header>

      <div className="flex flex-col items-center mt-10">
        <div className="relative h-32 w-32 overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-primary/20 to-primary/5 text-primary shadow-xl">
          {fullAvatarUrl ? (
            <Image src={fullAvatarUrl} alt={displayName} fill className="object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-4xl font-black">
              {displayName[0].toUpperCase()}
            </div>
          )}
        </div>
        
        <h2 className="mt-6 text-2xl font-black text-foreground tracking-tight">{displayName}</h2>
        <p className="mt-1 text-sm font-bold text-muted-foreground">@{targetUser.username}</p>

        {targetUser.profile?.bio && (
          <p className="mt-4 text-center text-sm font-medium text-foreground/80 max-w-sm">
            {targetUser.profile.bio}
          </p>
        )}

        <div className="mt-10 flex gap-4 w-full max-w-xs">
          <Link
            href={`/chats/direct?userId=${targetUser.id}`}
            className="btn-nox flex-1 bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary-hover fast-tap"
          >
            Написать
          </Link>
        </div>
      </div>
    </div>
  );
}
