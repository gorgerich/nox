"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket-client";

export function useSocket() {
  const [socket] = useState<Socket>(() => getSocket());
  const [connected, setConnected] = useState(() => socket.connected);

  useEffect(() => {
    function handleConnect() {
      console.log("[client socket] connected socketId=", socket.id);
      setConnected(true);
    }

    function handleDisconnect(reason: string) {
      console.log("[client socket] disconnected reason=", reason);
      setConnected(false);
    }

    function handleConnectError(error: Error) {
      console.error("[client socket] connect_error:", error.message);
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);

    if (!socket.connected) {
      console.log("[client socket] initiating connection...");
      socket.connect();
    }

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
    };
  }, [socket]);

  return { socket, connected };
}
