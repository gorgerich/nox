import type { Server } from "socket.io";

type GlobalWithSocket = typeof globalThis & {
  pmSocketIo?: Server;
};

export function getRealtimeServer() {
  const io = (globalThis as GlobalWithSocket).pmSocketIo || 
             (process as unknown as GlobalWithSocket).pmSocketIo || 
             (global as unknown as GlobalWithSocket).pmSocketIo;
  
  return io as Server | undefined;
}

export function emitToChat(chatId: string, event: string, payload: unknown) {
  const io = getRealtimeServer();

  if (!io) {
    console.warn(`[realtime] io is undefined in emitToChat. event=${event} chatId=${chatId}`);
    return;
  }

  console.log(`[realtime] emitToChat event=${event} chatId=${chatId}`);
  io.to(`chat:${chatId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  const io = getRealtimeServer();

  if (!io) {
    console.warn(`[realtime] io is undefined in emitToUser. event=${event} userId=${userId}`);
    return;
  }

  console.log(`[realtime] emitToUser event=${event} userId=${userId}`);
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  const io = getRealtimeServer();

  if (!io) {
    console.warn(`[realtime] io is undefined in emitToUsers. event=${event} userIds=${userIds.join(",")}`);
    return;
  }

  userIds.forEach((userId) => {
    console.log(`[realtime] emitToUser event=${event} userId=${userId} (batch)`);
    io.to(`user:${userId}`).emit(event, payload);
  });
}
