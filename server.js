/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
/* eslint-enable @typescript-eslint/no-require-imports */

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

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

    socket.on("call:start", async ({ chatId, offer, fromUser }, callback) => {
      logCall("call:start:received", { chatId, userId });

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

      logCall("call:start:resolved", {
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
      if (mapSize === 0 && roomSize === 0) {
        callback?.({ ok: false, error: "Пользователь недоступен" });
        return;
      }

      const callId = uuidv4();
      activeCalls.set(callId, {
        callId,
        chatId,
        callerId: context.callerId,
        calleeId: context.calleeId,
        status: "ringing",
        createdAt: Date.now(),
      });

      io.to(`user:${context.calleeId}`).emit("call:incoming", {
        callId,
        chatId,
        offer,
        fromUser: fromUser ?? {
          displayName: user.profile?.displayName ?? user.username,
          avatarUrl: user.profile?.avatarUrl ?? null,
        },
      });

      callback?.({
        ok: true,
        callId,
        callee: {
          id: context.callee.id,
          displayName: context.callee.profile?.displayName ?? context.callee.username,
          avatarUrl: context.callee.profile?.avatarUrl ?? null,
        },
      });
      logCall("call:start:sent", { callId, chatId, callerId: context.callerId, calleeId: context.calleeId });
    });

    socket.on("call:answer", async ({ callId, chatId, answer }, callback) => {
      const call = activeCalls.get(callId);
      logCall("call:answer:received", { callId, chatId, userId, hasCall: Boolean(call) });

      if (!call || call.chatId !== chatId || call.calleeId !== userId) {
        callback?.({ ok: false, error: "Звонок не найден" });
        return;
      }

      if (!(await isActiveMember(chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      call.status = "connecting";
      io.to(`user:${call.callerId}`).emit("call:answered", { callId, chatId, answer });
      callback?.({ ok: true });
    });

    socket.on("call:ice-candidate", async ({ callId, chatId, candidate }, callback) => {
      const call = activeCalls.get(callId);
      if (!call || call.chatId !== chatId) {
        callback?.({ ok: false, error: "Звонок не найден" });
        return;
      }

      if (userId !== call.callerId && userId !== call.calleeId) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      io.to(`user:${targetId}`).emit("call:ice-candidate", { callId, chatId, candidate });
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
        }
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
