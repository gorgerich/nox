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

    function refreshChats(event: string) {
      console.log(`[client socket] received ${event}, refreshing chats...`);
      router.refresh();
    }

    socket.on("server:heartbeat", (payload) => {
      console.log("[client socket] heartbeat received:", payload);
    });

    socket.on("chat:updated", () => refreshChats("chat:updated"));
    socket.on("chat-request:new", () => refreshChats("chat-request:new"));
    socket.on("chat-request:accepted", () => refreshChats("chat-request:accepted"));
    socket.on("chat-request:declined", () => refreshChats("chat-request:declined"));
    socket.on("chat-request:canceled", () => refreshChats("chat-request:canceled"));

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
