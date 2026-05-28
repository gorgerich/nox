import { redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { Phone, PhoneMissed, PhoneOutgoing, PhoneIncoming, ArrowRight } from "lucide-react";

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
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Звонки</h1>
          <p className="mt-1 text-sm font-medium text-muted">История аудио и видеовызовов</p>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in-95 duration-700">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-muted">
            <Phone className="h-10 w-10 text-muted/40" strokeWidth={1.5} />
          </div>
          
          <h2 className="text-xl font-semibold tracking-tight text-foreground/80">Список звонков пуст</h2>
          <p className="mt-3 max-w-[280px] text-sm leading-relaxed text-muted/50 font-medium">
            Вы можете позвонить любому пользователю прямо из личного чата. История звонков появится в этом разделе позже.
          </p>
        </div>
      ) : (
        <div className="-mx-5 divide-y divide-border-subtle border-y border-border-subtle bg-surface pb-24 md:mx-0 md:rounded-2xl md:border">
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
                className="group flex min-h-[72px] items-center gap-3 px-5 py-2.5 transition-smooth hover:bg-foreground/5 active:bg-foreground/10"
              >
                <Link href={`/users/${partner.id}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary/10 text-primary transition-smooth active:scale-95">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg font-semibold">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[17px] font-semibold leading-tight text-foreground">{displayName}</p>
                    <span className="shrink-0 text-xs font-medium text-muted">
                      {formatTime(log.startedAt)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
                    <p className={`text-sm font-normal ${statusColor}`}>
                      {statusLabel}
                      {log.durationSec ? ` • ${formatDuration(log.durationSec)}` : ""}
                    </p>
                  </div>
                </div>

                <Link 
                  href={`/chats/${log.chatId}`}
                  className="touch-target flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-smooth hover:bg-primary hover:text-primary-foreground active:scale-95"
                  aria-label="Открыть чат"
                >
                  <ArrowRight className="h-5 w-5" strokeWidth={2.1} />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
