import { getCurrentUser } from "@/lib/auth";
import { getPrisma } from "@/lib/prisma";
import { getChatsPageData } from "@/lib/chat-list";
import { ProfileContent } from "./ProfileContent";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const prisma = getPrisma();
  const [dbUser, chatsData] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true },
    }),
    getChatsPageData(user.id),
  ]);

  if (!dbUser) return null;

  return (
    <div className="app-section transition-smooth">
      {/* No page title: the avatar and name are the heading on this screen, and
          a second "Профиль" above them only pushed everything down. */}
      <h1 className="sr-only">Профиль</h1>

      <ProfileContent
        user={dbUser}
        initialChatFolders={chatsData.chatFolders}
        initialBuiltInFolders={chatsData.chatFolderSettings.builtIns}
        folderChats={chatsData.chats.map((chat) => ({
          id: chat.id,
          title: chat.isSelfChat
            ? "Личное"
            : chat.type === "GROUP"
              ? chat.title || "Группа"
              : chat.otherMember?.displayName || chat.otherMember?.username || "Чат",
          subtitle: chat.type === "GROUP" ? "Группа" : chat.isSelfChat ? "Сообщения самому себе" : chat.otherMember?.username ? `@${chat.otherMember.username}` : "Личный чат",
        }))}
      />
    </div>
  );
}
