import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";

export default async function ContactsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const prisma = getPrisma();
  
  // Find all DIRECT chats the user is part of and extract the other member
  const memberships = await prisma.chatMember.findMany({
    where: {
      userId: user.id,
      status: "ACTIVE",
      chat: { type: "DIRECT" }
    },
    include: {
      chat: {
        include: {
          members: {
            where: { status: "ACTIVE", userId: { not: user.id } },
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                  profile: {
                    select: {
                      displayName: true,
                      avatarUrl: true
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  const contacts = memberships
    .map(m => m.chat.members[0]?.user)
    .filter(Boolean)
    .sort((a, b) => {
      const nameA = a!.profile?.displayName || a!.username;
      const nameB = b!.profile?.displayName || b!.username;
      return nameA.localeCompare(nameB);
    });

  return (
    <div className="app-section animate-in fade-in duration-300">
      <header className="app-section-header">
        <h1 className="app-section-title">Контакты</h1>
      </header>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-in zoom-in-95 duration-500 delay-100">
          <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-[2rem] bg-surface-elevated shadow-xl ring-1 ring-border-subtle/50">
            <svg className="h-10 w-10 text-muted/50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-black tracking-tight text-foreground/80">Контактов пока нет</h2>
          <p className="max-w-xs text-sm font-medium text-muted-foreground leading-relaxed">
            Начните новый чат, чтобы контакт появился здесь.
          </p>
          <Link href="/chats/new" className="mt-8 btn-nox bg-primary text-primary-foreground px-8 shadow-xl shadow-primary/20 hover:scale-105 active:scale-95">
            Найти людей
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {contacts.map((contact) => (
            <Link 
              key={contact!.id} 
              href={`/chats/direct?userId=${contact!.id}`}
              className="group flex items-center gap-4 rounded-3xl bg-surface p-4 border border-border-subtle transition-all duration-200 hover:bg-surface-elevated hover:scale-[1.02] active:scale-[0.98] shadow-sm hover:shadow-md"
            >
              <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[1.25rem] bg-gradient-to-br from-primary/20 to-primary/5 text-primary">
                {contact!.profile?.avatarUrl ? (
                  <Image src={contact!.profile.avatarUrl} alt="" fill className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-xl font-black">
                    {(contact!.profile?.displayName || contact!.username)[0].toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[17px] font-bold text-foreground group-hover:text-primary transition-colors">
                  {contact!.profile?.displayName || contact!.username}
                </p>
                <p className="truncate text-sm font-medium text-muted-foreground">
                  @{contact!.username}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground/5 text-foreground/40 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
