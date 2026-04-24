import type { Server } from "socket.io";

type GlobalWithSocket = typeof globalThis & {
  pmSocketIo?: Server;
};

export function getRealtimeServer() {
  return (globalThis as GlobalWithSocket).pmSocketIo;
}

export function emitToChat(chatId: string, event: string, payload: unknown) {
  getRealtimeServer()?.to(`chat:${chatId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  getRealtimeServer()?.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  const io = getRealtimeServer();

  if (!io) {
    return;
  }

  userIds.forEach((userId) => {
    io.to(`user:${userId}`).emit(event, payload);
  });
}
