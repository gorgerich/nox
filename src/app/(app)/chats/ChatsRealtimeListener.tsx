"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSocket } from "@/hooks/useSocket";

export function ChatsRealtimeListener() {
  const router = useRouter();
  const { socket } = useSocket();

  useEffect(() => {
    if (!socket) {
      return;
    }

    function refreshChats() {
      router.refresh();
    }

    socket.on("chat:updated", refreshChats);
    socket.on("chat-request:new", refreshChats);
    socket.on("chat-request:accepted", refreshChats);
    socket.on("chat-request:declined", refreshChats);

    return () => {
      socket.off("chat:updated", refreshChats);
      socket.off("chat-request:new", refreshChats);
      socket.off("chat-request:accepted", refreshChats);
      socket.off("chat-request:declined", refreshChats);
    };
  }, [router, socket]);

  return null;
}
