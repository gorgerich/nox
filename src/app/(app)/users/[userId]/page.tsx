import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { BackButton } from "./BackButton";
import { DirectChatButton } from "./DirectChatButton";
import { E2EEUserDevices } from "./E2EEUserDevices";
import { UserAvatar } from "./UserAvatar";
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
    <div className="app-section app-section-compact">
      <header className="nox-detail-header app-section-header !grid">
        <BackButton />
        <h1 className="nox-detail-title">Профиль</h1>
        <div className="h-11 w-11" />
      </header>

      <div className="mt-3 flex flex-col items-center">
        <UserAvatar src={fullAvatarUrl} displayName={displayName} username={username} />
        
        <h2 className="mt-4 max-w-full truncate px-4 text-2xl font-semibold tracking-tight text-foreground">{displayName}</h2>
        <p className="mt-0.5 text-sm text-primary">@{username}</p>

        {bio ? (
          <p className="mt-3 max-w-sm px-5 text-center text-sm leading-6 text-foreground/80">
            {bio}
          </p>
        ) : null}

        <div className="mt-6 flex w-full max-w-xs gap-4 px-4">
          <DirectChatButton userId={targetUser.id} />
        </div>
        <E2EEUserDevices userId={targetUser.id} />
      </div>
    </div>
  );
}
