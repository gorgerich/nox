import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { isUserOnline } from "@/lib/realtime";
import { ContactsList, type Contact } from "./ContactsList";

export const revalidate = 0;

export default async function ContactsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const prisma = getPrisma();

  // Server-render the contact list (people from the user's direct chats + self)
  // so the page paints instantly on navigation instead of showing a client-side
  // spinner while it fetched /api/me + the heavy /api/chats.
  const [memberships, me] = await Promise.all([
    prisma.chatMember.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
        deletedAt: null,
        chat: { type: "DIRECT" },
      },
      select: {
        chat: {
          select: {
            members: {
              where: { status: "ACTIVE" },
              select: {
                user: {
                  select: {
                    id: true,
                    username: true,
                    profile: { select: { displayName: true, avatarUrl: true } },
                  },
                },
              },
            },
          },
        },
      },
    }),
    prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        username: true,
        profile: { select: { displayName: true, avatarUrl: true } },
      },
    }),
  ]);

  const byId = new Map<string, Contact>();
  for (const membership of memberships) {
    for (const member of membership.chat.members) {
      if (member.user.id === user.id) continue;
      byId.set(member.user.id, {
        id: member.user.id,
        username: member.user.username,
        isOnline: isUserOnline(member.user.id),
        profile: member.user.profile
          ? { displayName: member.user.profile.displayName, avatarUrl: member.user.profile.avatarUrl }
          : { displayName: member.user.username, avatarUrl: null },
      });
    }
  }

  const others = Array.from(byId.values()).sort((a, b) => {
    const nameA = a.profile?.displayName || a.username;
    const nameB = b.profile?.displayName || b.username;
    return nameA.localeCompare(nameB);
  });

  const contacts: Contact[] = [];
  if (me) {
    contacts.push({
      id: me.id,
      username: me.username,
      isMe: true,
      profile: me.profile
        ? { displayName: me.profile.displayName, avatarUrl: me.profile.avatarUrl }
        : { displayName: me.username, avatarUrl: null },
    });
  }
  contacts.push(...others);

  return <ContactsList contacts={contacts} />;
}
