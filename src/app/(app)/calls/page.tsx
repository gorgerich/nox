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
      <div className="app-section-header px-2">
        <div>
          <h1 className="app-section-title">Звонки</h1>
          <p className="mt-2 text-[10px] font-black uppercase tracking-[0.2em] text-muted/60">Ваша история аудиовызовов</p>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-in fade-in zoom-in-95 duration-700">
          <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-[2.5rem] bg-surface-muted border border-border-subtle/50 shadow-inner">
            <Phone className="h-10 w-10 text-muted/40" strokeWidth={1.5} />
          </div>
          
          <h2 className="text-xl font-bold tracking-tight text-foreground/80">Список звонков пуст</h2>
          <p className="mt-3 max-w-[280px] text-sm leading-relaxed text-muted/50 font-medium">
            Вы можете позвонить любому пользователю прямо из личного чата. История звонков появится в этом разделе позже.
          </p>
        </div>
      ) : (
        <div className="space-y-3 px-2 pb-24">
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
                className="group flex items-center gap-4 rounded-3xl bg-surface p-4 border border-border-subtle transition-smooth hover:bg-surface-elevated active:scale-[0.99] shadow-sm"
              >
                <Link href={`/users/${partner.id}`} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-primary/10 text-primary transition-smooth active:scale-95">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl font-black">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-base font-bold text-foreground">{displayName}</p>
                    <span className="shrink-0 text-[10px] font-black uppercase tracking-tighter text-muted/40">
                      {formatTime(log.startedAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusIcon className={`h-3 w-3 ${statusColor}`} />
                    <p className={`text-xs font-bold ${statusColor} opacity-80`}>
                      {statusLabel}
                      {log.durationSec ? ` • ${formatDuration(log.durationSec)}` : ""}
                    </p>
                  </div>
                </div>

                <Link 
                  href={`/chats/${log.chatId}`}
                  className="touch-target h-10 w-10 flex shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-smooth hover:bg-primary hover:text-white active:scale-90"
                >
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
