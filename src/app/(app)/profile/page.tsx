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
    <div className="page-container transition-smooth">
      <div className="mb-12 px-2">
        <h1 className="text-4xl font-black tracking-tight text-foreground">Профиль</h1>
        <p className="mt-2 text-sm text-muted/60 font-medium uppercase tracking-widest">Настройки вашего аккаунта</p>
      </div>

      <ProfileContent user={dbUser} />
    </div>
  );
}
