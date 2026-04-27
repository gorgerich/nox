/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const webpush = require("web-push");
/* eslint-enable @typescript-eslint/no-require-imports */

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";
const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";
const DEBUG_PRESENCE = process.env.DEBUG_PRESENCE === "true";
const CALL_TIMEOUT_MS = 45_000;
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

if (process.env.VAPID_PRIVATE_KEY && process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "https://noxchat.ru",
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: databaseUrl,
  }),
});

const activeCalls = new Map();
const callExpiryTimers = new Map();
const onlineUsers = new Map();
const activeChatsByUser = new Map();

function logCall(label, data = {}) {
  if (!DEBUG_CALLS) {
    return;
  }

  console.log(`[call-server] ${label}`, data);
}

function logRealtime(label, data = {}) {
  if (!DEBUG_REALTIME) {
    return;
  }

  console.log(`[realtime-server] ${label}`, data);
}

function logPresence(label, data = {}) {
  if (!DEBUG_PRESENCE) {
    return;
  }

  console.log(`[presence] ${label}`, data);
}

function getUserRoomSize(io, userId) {
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return room ? room.size : 0;
}

function isCallExpired(call) {
  // Only ringing calls should expire based on expiresAt
  return !call || (call.status === "ringing" && Date.now() > call.expiresAt);
}

function clearCallExpiryTimer(callId) {
  const timeoutId = callExpiryTimers.get(callId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    callExpiryTimers.delete(callId);
  }
}

function deleteCall(callId) {
  clearCallExpiryTimer(callId);
  activeCalls.delete(callId);
}

function scheduleCallMissedTimeout(io, callId) {
  clearCallExpiryTimer(callId);

  const call = activeCalls.get(callId);
  if (!call) {
    return;
  }

  const timeoutMs = Math.max(0, call.expiresAt - Date.now());
  logCall("missed timeout scheduled", { callId, ms: timeoutMs });

  const timeoutId = setTimeout(() => {
    callExpiryTimers.delete(callId);
    const currentCall = activeCalls.get(callId);
    logCall("missed timeout fired", { callId, status: currentCall?.status ?? "missing" });

    if (!currentCall || currentCall.status !== "ringing") {
      return;
    }

    io.to(`user:${currentCall.callerId}`).emit("call:ended", { callId, reason: "expired" });
    io.to(`user:${currentCall.calleeId}`).emit("call:ended", { callId, reason: "expired" });
    activeCalls.delete(callId);
  }, timeoutMs);

  callExpiryTimers.set(callId, timeoutId);
}

function sweepExpiredCalls(io) {
  for (const [callId, call] of activeCalls.entries()) {
    if (!isCallExpired(call)) {
      continue;
    }

    io.to(`user:${call.callerId}`).emit("call:ended", { callId, reason: "expired" });
    io.to(`user:${call.calleeId}`).emit("call:ended", { callId, reason: "expired" });
    deleteCall(callId);
    logCall("call expired", { callId, chatId: call.chatId });
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sendPushToUser(userId, payload) {
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    logCall("push skipped for offline callee", { userId, reason: "vapid_not_configured" });
    return { sent: 0, total: 0 };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId, disabledAt: null },
  });

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify(payload),
        );
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) {
          await prisma.pushSubscription.update({
            where: { endpoint: sub.endpoint },
            data: { disabledAt: new Date() },
          });
        }
        throw error;
      }
    }),
  );

  return {
    sent: results.filter((result) => result.status === "fulfilled").length,
    total: subscriptions.length,
  };
}

function addActiveChat(userId, chatId) {
  const currentChats = activeChatsByUser.get(userId) ?? new Set();
  currentChats.add(chatId);
  activeChatsByUser.set(userId, currentChats);
}

function removeActiveChat(userId, chatId) {
  const currentChats = activeChatsByUser.get(userId);
  if (!currentChats) {
    return;
  }

  currentChats.delete(chatId);
  if (currentChats.size === 0) {
    activeChatsByUser.delete(userId);
  }
}

async function getRelatedUserIds(userId) {
  const memberships = await prisma.chatMember.findMany({
    where: {
      userId,
      status: "ACTIVE",
    },
    select: {
      chatId: true,
    },
  });

  if (memberships.length === 0) {
    return [];
  }

  const relatedMemberships = await prisma.chatMember.findMany({
    where: {
      chatId: { in: memberships.map((membership) => membership.chatId) },
      status: "ACTIVE",
      userId: { not: userId },
    },
    select: {
      userId: true,
    },
  });

  return [...new Set(relatedMemberships.map((membership) => membership.userId))];
}

async function emitPresenceUpdateToRelated(io, userId, status, lastSeenAt = null) {
  const relatedUserIds = await getRelatedUserIds(userId);

  for (const relatedUserId of relatedUserIds) {
    io.to(`user:${relatedUserId}`).emit("presence:update", {
      userId,
      status,
      lastSeenAt: lastSeenAt ? lastSeenAt.toISOString() : null,
    });
  }

  logPresence(`emit update ${status}`, {
    userId,
    relatedCount: relatedUserIds.length,
  });
}

function getJwtSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required.");
  }
  return new TextEncoder().encode(secret);
}

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((part) => part.trim());
  const cookie = cookies.find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

async function verifySocketUser(socket) {
  const token = getCookie(socket.handshake.headers.cookie, "pm_session");
  if (!token) {
    return null;
  }

  const { jwtVerify } = await import("jose");
  const { payload } = await jwtVerify(token, getJwtSecret());

  if (typeof payload.userId !== "string") {
    return null;
  }

  const [user, emergencyLock] = await Promise.all([
    prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        username: true,
        role: true,
        status: true,
        profile: {
          select: {
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    }),
    prisma.systemSetting.findUnique({
      where: { key: "emergency_lock" },
      select: { value: true },
    }),
  ]);

  if (!user || user.status !== "ACTIVE") {
    return null;
  }

  if (emergencyLock?.value === "true" && user.role === "MEMBER") {
    return null;
  }

  return user;
}

async function getDirectCallContext(chatId, userId) {
  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      type: true,
      members: {
        where: { status: "ACTIVE" },
        select: {
          userId: true,
          user: {
            select: {
              id: true,
              username: true,
              profile: {
                select: {
                  displayName: true,
                  avatarUrl: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!chat || chat.type !== "DIRECT") {
    return null;
  }

  const callerMember = chat.members.find((member) => member.userId === userId);
  const calleeMember = chat.members.find((member) => member.userId !== userId);

  if (!callerMember || !calleeMember) {
    return null;
  }

  return {
    chatId: chat.id,
    callerId: callerMember.userId,
    calleeId: calleeMember.userId,
    callee: calleeMember.user,
  };
}

async function isActiveMember(chatId, userId) {
  const membership = await prisma.chatMember.findFirst({
    where: {
      chatId,
      userId,
      status: "ACTIVE",
    },
    select: { id: true },
  });

  return Boolean(membership);
}

async function joinUserChatRooms(socket, userId) {
  const memberships = await prisma.chatMember.findMany({
    where: {
      userId,
      status: "ACTIVE",
    },
    select: { chatId: true },
  });

  memberships.forEach((membership) => {
    socket.join(`chat:${membership.chatId}`);
    logRealtime("joined chat room", { chatId: membership.chatId, userId, socketId: socket.id, source: "membership-sync" });
  });
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  globalThis.pmSocketIo = io;
  globalThis.pmOnlineUsers = onlineUsers;
  globalThis.pmActiveChatsByUser = activeChatsByUser;
  global.pmSocketIo = io;
  global.pmOnlineUsers = onlineUsers;
  global.pmActiveChatsByUser = activeChatsByUser;
  process.pmSocketIo = io;
  process.pmOnlineUsers = onlineUsers;
  process.pmActiveChatsByUser = activeChatsByUser;

  io.use(async (socket, nextSocket) => {
    try {
      const user = await verifySocketUser(socket);
      if (!user) {
        nextSocket(new Error("Нет доступа"));
        return;
      }

      socket.data.user = user;
      nextSocket();
    } catch (error) {
      console.error("Socket auth failed", error);
      nextSocket(new Error("Нет доступа"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;
    const userId = user.id;

    logRealtime("user connected", { userId, socketId: socket.id });

    socket.join(`user:${userId}`);
    logRealtime("joined user room", { userId, socketId: socket.id });
    await joinUserChatRooms(socket, userId);
    logRealtime("joined chat rooms", { userId, socketId: socket.id });

    let userBecameOnline = false;
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      userBecameOnline = true;
    }
    onlineUsers.get(userId).add(socket.id);
    logPresence("user online", { userId, socketCount: onlineUsers.get(userId)?.size ?? 0 });
    if (userBecameOnline) {
      void emitPresenceUpdateToRelated(io, userId, "online");
    }

    socket.on("chat:join", async (chatId, callback) => {
      if (typeof chatId !== "string") {
        callback?.({ ok: false, error: "Некорректный чат" });
        return;
      }

      const allowed = await isActiveMember(chatId, userId);
      if (!allowed) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      socket.join(`chat:${chatId}`);
      logRealtime("joined chat room", { chatId, userId, socketId: socket.id });
      callback?.({ ok: true });
    });

    socket.on("chat:leave", (chatId, callback) => {
      if (typeof chatId === "string") {
        socket.leave(`chat:${chatId}`);
        logRealtime("left chat room", { chatId, userId, socketId: socket.id });
      }
      callback?.({ ok: true });
    });

    socket.on("chat:active", async ({ chatId } = {}, callback) => {
      if (typeof chatId !== "string" || !(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      addActiveChat(userId, chatId);
      logRealtime("active chat set", { chatId, userId, socketId: socket.id });
      callback?.({ ok: true });
    });

    socket.on("chat:inactive", ({ chatId } = {}, callback) => {
      if (typeof chatId === "string") {
        removeActiveChat(userId, chatId);
        logRealtime("active chat cleared", { chatId, userId, socketId: socket.id });
      }
      callback?.({ ok: true });
    });

    socket.on("typing:start", async ({ chatId }, callback) => {
      if (typeof chatId !== "string" || !(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      socket.to(`chat:${chatId}`).emit("typing:update", {
        chatId,
        userId,
        displayName: user.profile?.displayName ?? user.username,
        isTyping: true,
      });
      callback?.({ ok: true });
    });

    socket.on("typing:stop", async ({ chatId }, callback) => {
      if (typeof chatId !== "string" || !(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      socket.to(`chat:${chatId}`).emit("typing:update", {
        chatId,
        userId,
        displayName: user.profile?.displayName ?? user.username,
        isTyping: false,
      });
      callback?.({ ok: true });
    });

    socket.on("call:start", async ({ callId: requestedCallId, chatId, offer }, callback) => {
      sweepExpiredCalls(io);
      logCall("call:start received", { chatId, userId });

      if (typeof chatId !== "string" || !offer) {
        callback?.({ ok: false, error: "Некорректный звонок" });
        return;
      }

      const context = await getDirectCallContext(chatId, userId);
      if (!context) {
        callback?.({ ok: false, error: "Чат недоступен для звонка" });
        return;
      }

      const calleeSockets = onlineUsers.get(context.calleeId);
      const mapSize = calleeSockets ? calleeSockets.size : 0;
      const roomSize = getUserRoomSize(io, context.calleeId);
      const calleeOnline = mapSize > 0 || roomSize > 0;

      logCall(`callee ${calleeOnline ? "online" : "offline"}`, {
        chatId,
        callerId: context.callerId,
        calleeId: context.calleeId,
        mapSize,
        roomSize,
      });
      if (context.calleeId === context.callerId) {
        callback?.({ ok: false, error: "Собеседник не найден" });
        return;
      }

      if (!calleeOnline) {
        callback?.({ ok: false, error: "USER_OFFLINE" });
        return;
      }

      const callId = typeof requestedCallId === "string" && requestedCallId.length >= 8 && requestedCallId.length <= 128 && !activeCalls.has(requestedCallId)
        ? requestedCallId
        : uuidv4();
      const callerDisplayName = user.profile?.displayName ?? user.username;
      const callerAvatarUrl = user.profile?.avatarUrl ?? null;
      const expiresAt = Date.now() + CALL_TIMEOUT_MS;
      activeCalls.set(callId, {
        callId,
        chatId,
        callerId: context.callerId,
        calleeId: context.calleeId,
        status: "ringing",
        offer,
        fromUser: {
          id: user.id,
          username: user.username,
          displayName: callerDisplayName,
          avatarUrl: callerAvatarUrl,
        },
        createdAt: Date.now(),
        expiresAt,
      });
      scheduleCallMissedTimeout(io, callId);
      logCall("active call created", {
        callId,
        chatId,
        callerId: context.callerId,
        calleeId: context.calleeId,
        expiresIn: CALL_TIMEOUT_MS,
      });

      io.to(`user:${context.calleeId}`).emit("call:incoming", {
        callId,
        chatId,
        offer,
        fromUser: {
          id: user.id,
          username: user.username,
          displayName: callerDisplayName,
          avatarUrl: callerAvatarUrl,
        },
      });
      logCall("incoming emitted", { callId, chatId, calleeId: context.calleeId });

      callback?.({
        ok: true,
        callId,
      });
    });

    socket.on("call:answer", async ({ callId, chatId, answer }, callback) => {
      sweepExpiredCalls(io);
      const call = activeCalls.get(callId);
      logCall("call:answer received", {
        callId,
        chatId,
        userId,
        status: call?.status ?? null,
        exists: Boolean(call),
      });

      if (!call || call.chatId !== chatId) {
        callback?.({ ok: false, error: "CALL_NOT_FOUND" });
        return;
      }

      if (call.calleeId !== userId) {
        callback?.({ ok: false, error: "NOT_CALL_PARTICIPANT" });
        return;
      }

      if (isCallExpired(call)) {
        if (call && isCallExpired(call)) {
          deleteCall(callId);
        }
        callback?.({ ok: false, error: "CALL_EXPIRED" });
        return;
      }

      if (call.status !== "ringing" && call.status !== "connecting") {
        callback?.({ ok: false, error: "INVALID_STATE" });
        return;
      }

      if (!(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      call.status = "connecting";
      clearCallExpiryTimer(callId);
      io.to(`user:${call.callerId}`).emit("call:answer", { callId, chatId, answer });
      logCall("call:answer forwarded", { callId, fromUserId: userId, toUserId: call.callerId });
      callback?.({ ok: true });
    });

    socket.on("call:ice-candidate", async ({ callId, chatId, candidate }, callback) => {
      sweepExpiredCalls(io);
      const call = activeCalls.get(callId);
      if (!call || call.chatId !== chatId) {
        callback?.({ ok: false, error: "CALL_NOT_FOUND" });
        return;
      }

      if (isCallExpired(call)) {
        if (call && isCallExpired(call)) {
          deleteCall(callId);
        }
        callback?.({ ok: false, error: "CALL_EXPIRED" });
        return;
      }

      if (userId !== call.callerId && userId !== call.calleeId) {
        callback?.({ ok: false, error: "NOT_CALL_PARTICIPANT" });
        return;
      }

      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      logCall("ice received", { callId, fromUserId: userId });
      io.to(`user:${targetId}`).emit("call:ice-candidate", { callId, chatId, candidate });
      logCall("ice forwarded", {
        callId,
        fromRole: userId === call.callerId ? "caller" : "callee",
        toRole: targetId === call.callerId ? "caller" : "callee",
      });
      callback?.({ ok: true });
    });

    socket.on("call:declined", async ({ callId, reason }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) {
        callback?.({ ok: false, error: "CALL_NOT_FOUND" });
        return;
      }

      if (userId !== call.calleeId) {
        callback?.({ ok: false, error: "NOT_CALL_PARTICIPANT" });
        return;
      }

      io.to(`user:${call.callerId}`).emit("call:declined", { callId, reason: reason ?? "declined" });
      deleteCall(callId);
      logCall("call ended", { callId, reason: reason ?? "declined" });
      callback?.({ ok: true });
    });

    socket.on("call:ended", async ({ callId, reason }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) {
        callback?.({ ok: false, error: "CALL_NOT_FOUND" });
        return;
      }

      if (userId !== call.callerId && userId !== call.calleeId) {
        callback?.({ ok: false, error: "NOT_CALL_PARTICIPANT" });
        return;
      }

      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit("call:ended", { callId, reason: reason ?? "ended" });
      deleteCall(callId);
      logCall("call ended", { callId, reason: reason ?? "ended" });
      callback?.({ ok: true });
    });

    socket.on("disconnect", async () => {
      const userSockets = onlineUsers.get(userId);
      let userStillOnline = false;
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          const lastSeenAt = new Date();
          try {
            await prisma.user.update({
              where: { id: userId },
              data: { lastSeenAt },
            });
          } catch (error) {
            console.error("Failed to update lastSeenAt", error);
          }

          logPresence("user offline", { userId, lastSeenAt: lastSeenAt.toISOString() });
          await emitPresenceUpdateToRelated(io, userId, "offline", lastSeenAt);
        } else {
          userStillOnline = true;
          logPresence("user online", { userId, socketCount: userSockets.size });
        }
      }

      if (userStillOnline) {
        return;
      }

      // Cleanup active calls when user is fully offline
      for (const [callId, call] of activeCalls.entries()) {
        if (call.callerId === userId || call.calleeId === userId) {
          const targetId = userId === call.callerId ? call.calleeId : call.callerId;
          io.to(`user:${targetId}`).emit("call:ended", { callId, reason: "peer_disconnected" });
          deleteCall(callId);
          logCall("call ended due to disconnect", { callId, userId });
        }
      }

      activeChatsByUser.delete(userId);
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
  });
});
