"use client";

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

export function ChatsRealtimeListener() {
  const router = useRouter();
  const pathname = usePathname();
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) {
      return;
    }

    function refreshChats(payload?: { chatId?: string }) {
      // If we are currently inside the chat that was updated, 
      // do NOT router.refresh() because it breaks scroll and local state.
      // ChatMessages handles its own realtime updates.
      if (payload?.chatId && pathname === `/chats/${payload.chatId}`) {
        return;
      }
      
      router.refresh();
    }

    socket.on("chat:updated", refreshChats);
    socket.on("chat-request:new", () => router.refresh());
    socket.on("chat-request:accepted", () => router.refresh());
    socket.on("chat-request:declined", () => router.refresh());
    socket.on("chat-request:canceled", () => router.refresh());

    return () => {
      socket.off("chat:updated");
      socket.off("chat-request:new");
      socket.off("chat-request:accepted");
      socket.off("chat-request:declined");
      socket.off("chat-request:canceled");
    };
  }, [router, socket, pathname]);

  return null;
}
