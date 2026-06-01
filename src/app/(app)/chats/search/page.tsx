import { getCurrentUser } from "@/lib/auth";
import { getChatsPageData } from "@/lib/chat-list";

import { ChatsSearchPageClient } from "./ChatsSearchPageClient";

export const revalidate = 0;

export default async function ChatsSearchPage() {
  const user = await getCurrentUser();

  if (!user) {
    return null;
  }

  const data = await getChatsPageData(user.id);

  return (
    <ChatsSearchPageClient
      chats={data.chats}
      incomingRequests={data.incomingRequests}
    />
  );
}
