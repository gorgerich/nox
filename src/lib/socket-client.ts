"use client";

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

export function getSocket() {
  if (!socket) {
    socket = io({
      path: "/socket.io",
      withCredentials: true,
      autoConnect: false,
    });
  }

  return socket;
}
