"use client";

import { useEffect, useState } from "react";

import { useSocket } from "@/hooks/useSocket";
import { formatUserPresence } from "@/lib/presence";

export function usePresence(params: {
  userId?: string | null;
  initialIsOnline?: boolean;
  initialLastSeenAt?: string | null;
}) {
  const { socket } = useSocket();
  const [isOnline, setIsOnline] = useState(Boolean(params.initialIsOnline));
  const [lastSeenAt, setLastSeenAt] = useState<string | null>(params.initialLastSeenAt ?? null);

  useEffect(() => {
    if (!socket || !params.userId) {
      return;
    }

    const handlePresence = (payload: { userId: string; status: "online" | "offline"; lastSeenAt?: string | null }) => {
      if (payload.userId !== params.userId) {
        return;
      }

      setIsOnline(payload.status === "online");
      if (payload.status === "offline") {
        setLastSeenAt(payload.lastSeenAt ?? null);
      }
    };

    socket.on("presence:update", handlePresence);
    return () => {
      socket.off("presence:update", handlePresence);
    };
  }, [params.userId, socket]);

  return {
    isOnline,
    lastSeenAt,
    label: formatUserPresence({ isOnline, lastSeenAt }),
  };
}
