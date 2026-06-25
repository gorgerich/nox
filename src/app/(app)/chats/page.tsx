import { getCurrentUser } from "@/lib/auth";
import { getChatsPageData } from "@/lib/chat-list";

import { ChatsPageClient } from "./ChatsPageClient";

export const revalidate = 0;

export default async function ChatsPage() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const data = await getChatsPageData(user.id);

  return (
    <ChatsPageClient
      currentUserId={user.id}
      initialChats={data.chats}
      initialIncomingRequests={data.incomingRequests}
      initialArchivedCount={data.archivedCount}
      initialChatFolders={data.chatFolders}
      initialBuiltInFolders={data.chatFolderSettings.builtIns}
    />
  );
}
