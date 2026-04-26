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
const onlineUsers = new Map();

function logCall(label, data = {}) {
  if (!DEBUG_CALLS) {
    return;
  }

  console.log(`[call-server] ${label}`, data);
}

function getUserRoomSize(io, userId) {
  const room = io.sockets.adapter.rooms.get(`user:${userId}`);
  return room ? room.size : 0;
}

function isCallExpired(call) {
  return !call || Date.now() > call.expiresAt;
}

function sweepExpiredCalls(io) {
  for (const [callId, call] of activeCalls.entries()) {
    if (!isCallExpired(call)) {
      continue;
    }

    io.to(`user:${call.callerId}`).emit("call:ended", { callId, reason: "expired" });
    io.to(`user:${call.calleeId}`).emit("call:ended", { callId, reason: "expired" });
    activeCalls.delete(callId);
    logCall("call expired", { callId, chatId: call.chatId });
  }
}

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

function emitStoredIce(io, call, targetUserId) {
  const queuedCandidates = targetUserId === call.callerId ? call.calleeIceCandidates : call.callerIceCandidates;
  if (!queuedCandidates || queuedCandidates.length === 0) {
    return;
  }

  for (const candidate of queuedCandidates) {
    io.to(`user:${targetUserId}`).emit("call:ice-candidate", {
      callId: call.callId,
      chatId: call.chatId,
      candidate,
    });
  }

  logCall("ICE flushed", {
    callId: call.callId,
    toUserId: targetUserId,
    count: queuedCandidates.length,
  });
}

function emitPendingCallsForUser(io, userId, incomingCallId) {
  sweepExpiredCalls(io);

  let emitted = 0;
  let foundIncomingCallId = false;

  for (const call of activeCalls.values()) {
    if (call.calleeId !== userId || call.status !== "ringing") {
      continue;
    }

    if (incomingCallId && call.callId === incomingCallId) {
      foundIncomingCallId = true;
    }

    io.to(`user:${userId}`).emit("call:incoming", {
      callId: call.callId,
      chatId: call.chatId,
      offer: call.offer,
      fromUser: call.fromUser,
      expiresAt: call.expiresAt,
    });
    emitStoredIce(io, call, userId);
    emitted += 1;
    logCall("incoming emitted to socket", { callId: call.callId, chatId: call.chatId, userId, source: "sync" });
  }

  return {
    emitted,
    foundIncomingCallId,
    expiredIncomingCallId: Boolean(incomingCallId && !foundIncomingCallId),
  };
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

    socket.join(`user:${userId}`);
    await joinUserChatRooms(socket, userId);

    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      io.emit("presence:update", { userId, status: "online" });
    }
    onlineUsers.get(userId).add(socket.id);

    setTimeout(() => {
      emitPendingCallsForUser(io, userId);
    }, 250);

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
      callback?.({ ok: true });
    });

    socket.on("chat:leave", (chatId, callback) => {
      if (typeof chatId === "string") {
        socket.leave(`chat:${chatId}`);
      }
      callback?.({ ok: true });
    });

    socket.on("typing:start", async ({ chatId }, callback) => {
      if (typeof chatId !== "string" || !(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      socket.to(`chat:${chatId}`).emit("typing:update", { chatId, userId, isTyping: true });
      callback?.({ ok: true });
    });

    socket.on("typing:stop", async ({ chatId }, callback) => {
      if (typeof chatId !== "string" || !(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      socket.to(`chat:${chatId}`).emit("typing:update", { chatId, userId, isTyping: false });
      callback?.({ ok: true });
    });

    socket.on("call:sync-pending", ({ incomingCallId } = {}, callback) => {
      const result = emitPendingCallsForUser(io, userId, typeof incomingCallId === "string" ? incomingCallId : undefined);
      callback?.({ ok: true, ...result });
    });

    socket.on("call:start", async ({ chatId, offer }, callback) => {
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

      const callId = uuidv4();
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
          displayName: callerDisplayName,
          avatarUrl: callerAvatarUrl,
        },
        createdAt: Date.now(),
        expiresAt,
        callerIceCandidates: [],
        calleeIceCandidates: [],
      });

      if (calleeOnline) {
        io.to(`user:${context.calleeId}`).emit("call:incoming", {
          callId,
          chatId,
          offer,
          fromUser: {
            displayName: callerDisplayName,
            avatarUrl: callerAvatarUrl,
          },
          expiresAt,
        });
        logCall("incoming emitted to socket", { callId, chatId, calleeId: context.calleeId });
      } else {
        sendPushToUser(context.calleeId, {
          title: "Входящий звонок",
          body: callerDisplayName,
          url: `/chats/${chatId}?incomingCallId=${callId}`,
          type: "call",
          chatId,
          callId,
          tag: `call-${callId}`,
        }).then((result) => {
          logCall("push sent for offline callee", {
            callId,
            calleeId: context.calleeId,
            sent: result.sent,
            total: result.total,
          });
        }).catch((error) => {
          logCall("push sent for offline callee", {
            callId,
            calleeId: context.calleeId,
            ok: false,
            error: String(error?.message ?? error),
          });
        });
      }

      callback?.({
        ok: true,
        callId,
        expiresAt,
        delivery: calleeOnline ? "socket" : "push",
        callee: {
          id: context.callee.id,
          displayName: context.callee.profile?.displayName ?? context.callee.username,
          avatarUrl: context.callee.profile?.avatarUrl ?? null,
        },
      });
      logCall("offer sent", { callId, chatId, callerId: context.callerId, calleeId: context.calleeId, delivery: calleeOnline ? "socket" : "push" });
    });

    socket.on("call:answer", async ({ callId, chatId, answer }, callback) => {
      sweepExpiredCalls(io);
      const call = activeCalls.get(callId);
      logCall("call:answer received", { callId, chatId, userId, hasCall: Boolean(call) });

      if (!call || isCallExpired(call) || call.chatId !== chatId || call.calleeId !== userId) {
        if (call && isCallExpired(call)) {
          activeCalls.delete(callId);
        }
        callback?.({ ok: false, error: "Звонок не найден" });
        return;
      }

      if (!(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      call.status = "connecting";
      io.to(`user:${call.callerId}`).emit("call:answered", { callId, chatId, answer });
      emitStoredIce(io, call, call.callerId);
      emitStoredIce(io, call, call.calleeId);
      logCall("call:answer forwarded", {
        callId,
        fromUserId: userId,
        toUserId: call.callerId,
        callerRoomSize: getUserRoomSize(io, call.callerId),
      });
      callback?.({ ok: true });
    });

    socket.on("call:ice-candidate", async ({ callId, chatId, candidate }, callback) => {
      sweepExpiredCalls(io);
      const call = activeCalls.get(callId);
      if (!call || isCallExpired(call) || call.chatId !== chatId) {
        if (call && isCallExpired(call)) {
          activeCalls.delete(callId);
        }
        callback?.({ ok: false, error: "Звонок не найден" });
        return;
      }

      if (userId !== call.callerId && userId !== call.calleeId) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      const targetOnline = getUserRoomSize(io, targetId) > 0;
      const queue = userId === call.callerId ? call.callerIceCandidates : call.calleeIceCandidates;
      queue.push(candidate);

      io.to(`user:${targetId}`).emit("call:ice-candidate", { callId, chatId, candidate });
      logCall("ice forwarded", {
        callId,
        fromUserId: userId,
        toUserId: targetId,
        targetRoomSize: targetOnline ? getUserRoomSize(io, targetId) : 0,
        storedCount: queue.length,
      });
      callback?.({ ok: true });
    });

    socket.on("call:declined", async ({ callId, reason }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) {
        callback?.({ ok: false, error: "Звонок не найден" });
        return;
      }

      if (userId !== call.callerId && userId !== call.calleeId) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit("call:declined", { callId, reason: reason ?? "declined" });
      activeCalls.delete(callId);
      callback?.({ ok: true });
    });

    socket.on("call:ended", async ({ callId, reason }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) {
        callback?.({ ok: false, error: "Звонок не найден" });
        return;
      }

      if (userId !== call.callerId && userId !== call.calleeId) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit("call:ended", { callId, reason: reason ?? "ended" });
      activeCalls.delete(callId);
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

          io.emit("presence:update", { userId, status: "offline", lastSeenAt });
        } else {
          userStillOnline = true;
        }
      }

      if (userStillOnline) {
        return;
      }

      for (const [callId, call] of activeCalls.entries()) {
        if (call.callerId === userId || call.calleeId === userId) {
          const targetId = userId === call.callerId ? call.calleeId : call.callerId;
          io.to(`user:${targetId}`).emit("call:ended", { callId, reason: "disconnect" });
          activeCalls.delete(callId);
        }
      }
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
  });
});
