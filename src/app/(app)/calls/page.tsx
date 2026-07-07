import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Phone } from "lucide-react";
import { CallLogRow } from "./CallLogRow";

export const revalidate = 0;

export default async function CallsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const prisma = getPrisma();
  const logs = await prisma.callLog.findMany({
    where: {
      OR: [
        { callerId: user.id },
        { calleeId: user.id }
      ]
    },
    include: {
      caller: {
        include: { profile: true }
      },
      callee: {
        include: { profile: true }
      },
      chat: true
    },
    orderBy: {
      startedAt: "desc"
    },
    take: 50
  });

  return (
    <div className="app-section transition-smooth">
      <div className="nox-page-header">
        <div>
          <h1 className="nox-page-title">Звонки</h1>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="nox-empty-state animate-in fade-in zoom-in-95 duration-200">
          <div className="nox-empty-icon text-primary">
            <Phone className="h-9 w-9" strokeWidth={1.6} />
          </div>
          
          <h2 className="nox-empty-title">Звонков пока нет</h2>
          <p className="nox-empty-copy">
            История появится здесь после первого аудио или видеозвонка.
          </p>
        </div>
      ) : (
        <div className="nox-list -mx-5 md:mx-0">
          {logs.map((log) => {
            const isOutgoing = log.callerId === user.id;
            const partner = isOutgoing ? log.callee : log.caller;
            const displayName = partner.profile?.displayName || partner.username;
            const avatarUrl = partner.profile?.avatarUrl;
            const fullAvatarUrl = avatarUrl 
              ? (avatarUrl.startsWith('http') ? avatarUrl : `/api/avatars/${avatarUrl}`)
              : null;

            return (
              <CallLogRow
                key={log.id}
                chatId={log.chatId}
                partnerId={partner.id}
                displayName={displayName}
                avatarUrl={avatarUrl ?? null}
                fullAvatarUrl={fullAvatarUrl}
                status={log.status}
                isOutgoing={isOutgoing}
                startedAt={log.startedAt.toISOString()}
                durationSec={log.durationSec}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
