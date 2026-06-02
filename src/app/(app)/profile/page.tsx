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
    <div className="app-section transition-smooth">
      <div className="app-section-header px-2">
        <div>
          <h1 className="app-section-title">Профиль</h1>
        </div>
      </div>

      <ProfileContent user={dbUser} />
    </div>
  );
}
