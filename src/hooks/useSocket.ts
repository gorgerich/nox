"use client";

import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import { getSocket } from "@/lib/socket-client";

export function useSocket() {
  const [socket] = useState<Socket>(() => getSocket());
  const [connected, setConnected] = useState(() => socket.connected);

  useEffect(() => {
    function handleConnect() {
      setConnected(true);
    }

    function handleDisconnect() {
      setConnected(false);
    }

    function handleConnectError() {
      // silenced for production
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);

    if (!socket.connected) {
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
