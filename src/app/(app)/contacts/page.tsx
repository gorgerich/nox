"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle, Search, UsersRound } from "lucide-react";
import { normalizeAvatarUrl } from "@/lib/media-url";

type Contact = {
  id: string;
  username: string;
  profile: {
    displayName: string;
    avatarUrl: string | null;
  } | null;
};

let sessionContacts: Contact[] | null = null;
let sessionMe: Contact | null = null;

export default function ContactsPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>(sessionContacts || []);
  const [me, setMe] = useState<Contact | null>(sessionMe);
  const [loading, setLoading] = useState(!sessionContacts);
  const [actionPending, setActionPending] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/me").then(res => res.json()),
      fetch("/api/chats").then(res => res.json())
    ])
      .then(([meData, chatsData]) => {
        if (meData.user) {
          const meContact = {
            id: meData.user.id,
            username: meData.user.username,
            profile: meData.user.profile || { displayName: meData.user.username, avatarUrl: null }
          };
          setMe(meContact);
          sessionMe = meContact;
        }

        if (chatsData.chats) {
          interface ChatEntry { type: string; otherMember: { id: string; username: string; displayName: string; avatarUrl: string | null } | null }
          const chatList = chatsData.chats as ChatEntry[];
          const directChats = chatList.filter((c) => c.type === "DIRECT");
          const users = directChats.map((c) => {
            if (c.otherMember) {
              const om = c.otherMember;
              return {
                id: om.id,
                username: om.username,
                profile: {
                  displayName: om.displayName,
                  avatarUrl: om.avatarUrl,
                }
              };
            }
            return null;
          }).filter(Boolean) as Contact[];
          
          const allContacts = [...users];
          if (meData.user) {
            const meContact = {
              id: meData.user.id,
              username: meData.user.username,
              profile: meData.user.profile || { displayName: meData.user.username, avatarUrl: null }
            };
            if (!allContacts.some(u => u.id === meContact.id)) {
              allContacts.push(meContact);
            }
          }

          const uniqueUsers = Array.from(new Map(allContacts.map((u: Contact) => [u.id, u])).values()) as Contact[];
          
          uniqueUsers.sort((a, b) => {
            if (meData.user && a.id === meData.user.id) return -1;
            if (meData.user && b.id === meData.user.id) return 1;
            
            const nameA = a.profile?.displayName || a.username;
            const nameB = b.profile?.displayName || b.username;
            return nameA.localeCompare(nameB);
          });
          
          setContacts(uniqueUsers);
          sessionContacts = uniqueUsers;
        }
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const handleWriteClick = async (e: React.MouseEvent, userId: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (actionPending) return;
    setActionPending(userId);
    
    try {
      const response = await fetch("/api/chats/direct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId })
      });
      
      if (response.ok) {
        const data = await response.json();
        router.push(`/chats/${data.chat.id}`);
      } else {
        alert("Не удалось открыть чат");
        setActionPending(null);
      }
    } catch {
      alert("Ошибка сети");
      setActionPending(null);
    }
  };

  if (loading) {
    return (
      <div className="app-section animate-in fade-in duration-300">
        <header className="app-section-header">
          <h1 className="app-section-title">Контакты</h1>
        </header>
        <div className="flex justify-center p-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </div>
    );
  }

  return (
    <div className="app-section animate-in fade-in duration-300">
      <header className="app-section-header items-center">
        <div>
          <h1 className="app-section-title">Контакты</h1>
          <p className="mt-1 text-sm font-medium text-muted">Люди из ваших личных чатов</p>
        </div>
      </header>

      {contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center animate-in zoom-in-95 duration-500 delay-100">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-surface-muted text-muted">
            <UsersRound className="h-9 w-9" strokeWidth={1.7} />
          </div>
          <h2 className="mb-2 text-xl font-semibold tracking-tight text-foreground/80">Контактов пока нет</h2>
          <p className="max-w-xs text-sm font-medium text-muted-foreground leading-relaxed">
            Начните новый чат, чтобы контакт появился здесь.
          </p>
          <Link href="/chats/new" className="mt-8 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground transition-smooth active:scale-95">
            <Search className="h-4 w-4" strokeWidth={2.2} />
            Найти людей
          </Link>
        </div>
      ) : (
        <div className="-mx-5 divide-y divide-border-subtle border-y border-border-subtle bg-surface md:mx-0 md:rounded-2xl md:border">
          {contacts.map((contact) => {
            const isMe = me && contact!.id === me.id;
            const displayName = isMe ? "Избранное" : (contact!.profile?.displayName || contact!.username);
            const avatarUrl = contact!.profile?.avatarUrl;
            const fullAvatarUrl = normalizeAvatarUrl(avatarUrl);
            return (
              <Link 
                key={contact!.id} 
                href={isMe ? "/profile" : `/users/${contact!.id}`}
                className="group flex min-h-[72px] items-center gap-3 px-5 py-2.5 transition-smooth hover:bg-foreground/5 active:bg-foreground/10 fast-tap"
              >
                <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary/10 text-primary">
                  {fullAvatarUrl ? (
                    <Image src={fullAvatarUrl} alt="" fill className="object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-lg font-semibold">
                      {displayName[0].toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[17px] font-semibold leading-tight text-foreground">
                    {displayName}
                  </p>
                  <p className="mt-0.5 truncate text-sm font-normal text-muted">
                    {isMe ? `@${contact!.username} (вы)` : `@${contact!.username}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center">
                  <button
                    onClick={(e) => handleWriteClick(e, contact!.id)}
                    disabled={actionPending === contact!.id}
                    className="flex h-10 min-w-10 items-center justify-center rounded-full bg-primary/10 px-3 text-primary transition-smooth hover:bg-primary hover:text-primary-foreground active:scale-95 fast-tap disabled:opacity-50"
                    aria-label={isMe ? "Открыть избранное" : "Написать"}
                  >
                    {actionPending === contact!.id ? (
                      <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                    ) : (
                      <MessageCircle className="h-5 w-5" strokeWidth={2.1} />
                    )}
                  </button>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  );
}
