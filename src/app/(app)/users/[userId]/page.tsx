import { redirect } from "next/navigation";
import Image from "next/image";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { BackButton } from "./BackButton";
import { DirectChatButton } from "./DirectChatButton";
import { E2EEUserDevices } from "./E2EEUserDevices";
import { normalizeAvatarUrl } from "@/lib/media-url";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { userId } = await params;
  const prisma = getPrisma();

  const [targetUser, contactSettings] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    }),
    prisma.contactSettings.findUnique({
      where: {
        ownerId_targetUserId: {
          ownerId: user.id,
          targetUserId: userId,
        },
      },
      select: {
        nickname: true,
      },
    }),
  ]);

  if (!targetUser || targetUser.status !== "ACTIVE") {
    redirect("/contacts");
  }

  const displayName =
    contactSettings?.nickname ||
    targetUser.profile?.displayName ||
    targetUser.username ||
    "Пользователь";
  const username = targetUser.username || "Без username";
  const bio = targetUser.profile?.bio || "";
  const avatarUrl = targetUser.profile?.avatarUrl ?? null;
  const fullAvatarUrl = normalizeAvatarUrl(avatarUrl);

      return (
    <div className="app-section animate-in fade-in duration-300">
      <header className="app-section-header flex items-center gap-3">
        <BackButton />
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
        <p className="mt-1 text-sm font-bold text-muted-foreground">@{username}</p>

        {bio ? (
          <p className="mt-4 text-center text-sm font-medium text-foreground/80 max-w-sm">
            {bio}
          </p>
        ) : null}

        <div className="mt-10 flex gap-4 w-full max-w-xs">
          <DirectChatButton userId={targetUser.id} />
        </div>
        <E2EEUserDevices userId={targetUser.id} />
      </div>
    </div>
  );
}
