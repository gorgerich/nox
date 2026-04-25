import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { ProfileContent } from "./ProfileContent";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const prisma = getPrisma();
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    include: { profile: true },
  });

  if (!dbUser) return null;

  return (
    <div className="mx-auto max-w-2xl py-8 pb-20">
      <div className="mb-8 px-2">
        <h1 className="text-2xl font-bold tracking-tight">Профиль</h1>
      </div>

      <ProfileContent user={dbUser} />
    </div>
  );
}
