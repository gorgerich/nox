import type { Server } from "socket.io";

type GlobalWithSocket = typeof globalThis & {
  pmSocketIo?: Server;
  pmOnlineUsers?: Map<string, Set<string>>;
  pmActiveChatsByUser?: Map<string, Set<string>>;
};

export function getRealtimeServer() {
  const io = (globalThis as GlobalWithSocket).pmSocketIo || 
             (process as unknown as GlobalWithSocket).pmSocketIo || 
             (global as unknown as GlobalWithSocket).pmSocketIo;
  
  return io as Server | undefined;
}

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";

function getOnlineUsersMap() {
  return (globalThis as GlobalWithSocket).pmOnlineUsers ||
    (process as unknown as GlobalWithSocket).pmOnlineUsers ||
    (global as unknown as GlobalWithSocket).pmOnlineUsers;
}

function getActiveChatsByUserMap() {
  return (globalThis as GlobalWithSocket).pmActiveChatsByUser ||
    (process as unknown as GlobalWithSocket).pmActiveChatsByUser ||
    (global as unknown as GlobalWithSocket).pmActiveChatsByUser;
}

export function isUserOnline(userId: string) {
  const onlineUsers = getOnlineUsersMap();
  return Boolean(onlineUsers?.get(userId)?.size);
}

export function isUserActiveInChat(userId: string, chatId: string) {
  const activeChatsByUser = getActiveChatsByUserMap();
  return activeChatsByUser?.get(userId)?.has(chatId) ?? false;
}

export function emitToChat(chatId: string, event: string, payload: unknown) {
  const io = getRealtimeServer();

  if (!io) {
    if (DEBUG_REALTIME) console.warn(`[realtime] io is undefined in emitToChat. event=${event} chatId=${chatId}`);
    return;
  }

  if (DEBUG_REALTIME) console.log(`[realtime] emitToChat event=${event} chatId=${chatId}`);
  io.to(`chat:${chatId}`).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown) {
  const io = getRealtimeServer();

  if (!io) {
    if (DEBUG_REALTIME) console.warn(`[realtime] io is undefined in emitToUser. event=${event} userId=${userId}`);
    return;
  }

  if (DEBUG_REALTIME) console.log(`[realtime] emitToUser event=${event} userId=${userId}`);
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitToUsers(userIds: string[], event: string, payload: unknown) {
  const io = getRealtimeServer();

  if (!io) {
    if (DEBUG_REALTIME) console.warn(`[realtime] io is undefined in emitToUsers. event=${event} userIds=${userIds.join(",")}`);
    return;
  }

  userIds.forEach((userId) => {
    if (DEBUG_REALTIME) console.log(`[realtime] emitToUser event=${event} userId=${userId} (batch)`);
    io.to(`user:${userId}`).emit(event, payload);
  });
}
