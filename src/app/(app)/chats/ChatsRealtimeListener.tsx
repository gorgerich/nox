"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

export function ChatsRealtimeListener() {
  const router = useRouter();
  const pathname = usePathname();
  const { socket } = useSocket();
  const lastRefreshRef = useRef<number>(0);

  useEffect(() => {
    if (!socket) {
      return;
    }

    function triggerRefresh() {
      // Only refresh if we are on the main chats list to avoid jank in active chats/other tabs
      if (pathname !== "/chats") {
        return;
      }
      
      const now = Date.now();
      if (now - lastRefreshRef.current > 500) {
        lastRefreshRef.current = now;
        router.refresh();
      }
    }

    function refreshChats() {
      triggerRefresh();
    }

    socket.on("chat:updated", refreshChats);
    socket.on("chat-request:new", triggerRefresh);
    socket.on("chat-request:accepted", triggerRefresh);
    socket.on("chat-request:declined", triggerRefresh);
    socket.on("chat-request:canceled", triggerRefresh);

    return () => {
      socket.off("chat:updated", refreshChats);
      socket.off("chat-request:new", triggerRefresh);
      socket.off("chat-request:accepted", triggerRefresh);
      socket.off("chat-request:declined", triggerRefresh);
      socket.off("chat-request:canceled", triggerRefresh);
    };
  }, [router, socket, pathname]);

  return null;
}
