import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Phone, PhoneMissed, PhoneOutgoing, PhoneIncoming, Info } from "lucide-react";
import { CallBackButton } from "./CallBackButton";

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

  const formatDuration = (sec: number | null) => {
    if (!sec) return "";
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    if (mins > 0) return `${mins}м ${s}с`;
    return `${s}с`;
  };

  const formatTime = (date: Date) => {
    return new Intl.DateTimeFormat("ru-RU", { 
      hour: "2-digit", 
      minute: "2-digit",
      day: "numeric",
      month: "short"
    }).format(date);
  };

  return (
    <div className="app-section transition-smooth">
      <div className="nox-page-header">
        <div>
          <h1 className="nox-page-title">Звонки</h1>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="nox-empty-state animate-in fade-in zoom-in-95 duration-200">
          <div className="nox-empty-icon">
            <Phone className="h-9 w-9" strokeWidth={1.6} />
          </div>
          
          <h2 className="nox-empty-title">Список звонков пуст</h2>
          <p className="nox-empty-copy">
            Вы можете позвонить любому пользователю прямо из личного чата. История звонков появится в этом разделе позже.
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

            let StatusIcon = PhoneIncoming;
            let statusColor = "text-foreground/70";
            let statusLabel = isOutgoing ? "Исходящий" : "Входящий";

            if (log.status === "missed" || log.status === "declined") {
              StatusIcon = PhoneMissed;
              statusColor = "text-danger";
              statusLabel = log.status === "missed" ? "Пропущенный" : "Отклонён";
            } else if (isOutgoing) {
              StatusIcon = PhoneOutgoing;
            }

            return (
              <div 
                key={log.id} 
                className="nox-list-row group"
              >
                <Link href={`/users/${partner.id}`} className="nox-avatar transition-smooth active:scale-[0.96]">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="nox-row-title">{displayName}</p>
                    <span className="nox-row-meta">
                      {formatTime(log.startedAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
                    <p className={`nox-row-subtitle !mt-0 ${statusColor}`}>
                      {statusLabel}
                      {log.durationSec ? ` • ${formatDuration(log.durationSec)}` : ""}
                    </p>
                  </div>
                </div>

                <CallBackButton
                  chatId={log.chatId}
                  displayName={displayName}
                  avatarUrl={avatarUrl ?? null}
                />

                <Link
                  href={`/users/${partner.id}`}
                  className="touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted/50 transition-smooth hover:bg-foreground/5 hover:text-muted active:scale-[0.96]"
                  aria-label={`Профиль: ${displayName}`}
                >
                  <Info className="h-5 w-5" strokeWidth={2} />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
