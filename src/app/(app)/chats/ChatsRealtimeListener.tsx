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
    socket.on("chat-request:canceled", refreshChats);

    return () => {
      socket.off("chat:updated");
      socket.off("chat-request:new");
      socket.off("chat-request:accepted");
      socket.off("chat-request:declined");
      socket.off("chat-request:canceled");
    };
  }, [router, socket]);

  return null;
}
