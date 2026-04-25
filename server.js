/* eslint-disable @typescript-eslint/no-require-imports */

const fs = require("node:fs");
const { createServer } = require("node:http");
const os = require("node:os");
const path = require("node:path");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

function readCliArg(name) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

const cliPort = readCliArg("port");
const cliHostname = readCliArg("hostname");
const port = Number.parseInt(cliPort || process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const hostname = cliHostname || "0.0.0.0";
const devDistDir =
  dev && process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || os.tmpdir(), "private-messenger-mvp", "next-dev")
    : undefined;

if (devDistDir) {
  fs.mkdirSync(devDistDir, { recursive: true });
}

const app = next({
  dev,
  hostname,
  port,
  conf: devDistDir
    ? {
        distDir: devDistDir,
      }
    : undefined,
});
const handle = app.getRequestHandler();

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";

function getCookie(cookieHeader, name) {
  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  if (!match) {
    return null;
  }

  return decodeURIComponent(match.slice(name.length + 1));
}

function canUseApp(user, emergencyLocked) {
  if (!user || user.status !== "ACTIVE") {
    return false;
  }

  if (emergencyLocked && user.role !== "OWNER" && user.role !== "ADMIN") {
    return false;
  }

  return true;
}

async function getEmergencyLocked() {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "emergency_lock" },
    select: { value: true },
  });

  return setting?.value === "true";
}

async function getSocketUser(socket) {
  const cookieHeader = socket.handshake.headers.cookie;
  const token = getCookie(cookieHeader, "pm_session");

  if (!token) {
    console.warn(`[socket auth] No token in cookie for socket ${socket.id}`);
    return null;
  }

  try {
    const { jwtVerify } = await import("jose");
    const secret = process.env.AUTH_SECRET;

    if (!secret) {
      throw new Error("AUTH_SECRET is required.");
    }

    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));

    if (typeof payload.userId !== "string") {
      console.warn(`[socket auth] Invalid payload for socket ${socket.id}`);
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        role: true,
        status: true,
        username: true,
        profile: {
          select: {
            displayName: true,
          },
        },
      },
    });

    if (!user) {
      console.warn(`[socket auth] User not found for userId=${payload.userId}`);
      return null;
    }

    const emergencyLocked = await getEmergencyLocked();

    if (!canUseApp(user, emergencyLocked)) {
      console.warn(`[socket auth] Access denied by canUseApp for userId=${user.id}`);
      return null;
    }

    return {
      id: user.id,
      role: user.role,
      status: user.status,
      username: user.username,
      displayName: user.profile?.displayName || user.username,
    };
  } catch (err) {
    console.error(`[socket auth] JWT verify error for socket ${socket.id}:`, err.message);
    return null;
  }
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    path: "/socket.io",
  });

  globalThis.pmSocketIo = io;
  global.pmSocketIo = io;
  process.pmSocketIo = io;

  io.use(async (socket, nextSocket) => {
    try {
      const user = await getSocketUser(socket);

      if (!user) {
        if (DEBUG_REALTIME) {
          console.warn(`[socket auth] Denied: No user found for socket ${socket.id}`);
        }

        nextSocket(new Error("Нет доступа."));
        return;
      }

      if (DEBUG_REALTIME) {
        console.log(`[socket auth] Success: userId=${user.id} for socket ${socket.id}`);
      }

      socket.data.user = user;
      nextSocket();
    } catch (error) {
      console.error("[socket auth] Error:", error.message);
      nextSocket(new Error("Нет доступа."));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;

    if (DEBUG_REALTIME) {
      console.log(`[socket] connected userId=${user.id} socketId=${socket.id}`);
    }

    socket.join(`user:${user.id}`);

    const memberships = await prisma.chatMember.findMany({
      where: {
        userId: user.id,
        status: "ACTIVE",
      },
      select: {
        chatId: true,
      },
    });

    memberships.forEach((membership) => {
      socket.join(`chat:${membership.chatId}`);
    });

    socket.on("chat:join", async (chatId) => {
      if (typeof chatId !== "string") return;
      const membership = await prisma.chatMember.findFirst({
        where: { chatId, userId: user.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (membership) {
        socket.join(`chat:${chatId}`);
      }
    });

    socket.on("chat:leave", (chatId) => {
      if (typeof chatId === "string") {
        socket.leave(`chat:${chatId}`);
      }
    });

    // --- Audio Calls signaling (OFFER-FIRST FLOW) ---

    socket.on("call:start", async (data, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      if (!data || typeof data.chatId !== "string" || !data.offer) {
        return ack({ ok: false, error: "Некорректные данные вызова" });
      }
      const { chatId, offer } = data;

      try {
        const chat = await prisma.chat.findUnique({
          where: { id: chatId },
          include: {
            members: {
              where: { status: "ACTIVE" },
              include: { user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } } }
            }
          }
        });

        if (!chat || chat.type !== "DIRECT") {
          return ack({ ok: false, error: "Звонки доступны только в личных чатах" });
        }

        const caller = chat.members.find(m => m.userId === user.id);
        if (!caller) return ack({ ok: false, error: "Вы не участник чата" });

        const callee = chat.members.find(m => m.userId !== user.id);
        if (!callee) return ack({ ok: false, error: "Собеседник недоступен" });

        const callId = require("node:crypto").randomUUID();
        
        // Notify callee with the OFFER
        socket.to(`user:${callee.userId}`).emit("call:incoming", {
          callId,
          chatId,
          fromUser: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            avatarUrl: caller.user.profile?.avatarUrl
          },
          offer
        });

        // Send Push Notification (non-blocking)
        (async () => {
          try {
            const { sendPushToUser } = await import("./src/lib/push.ts");
            await sendPushToUser(callee.userId, {
              title: "Входящий звонок",
              body: `${user.displayName} звонит вам`,
              url: `/chats/${chatId}`,
              type: "call",
              chatId,
              tag: `call:${chatId}`,
            });
          } catch (err) {
            console.error("Call push failed:", err.message);
          }
        })();

        ack({ ok: true, callId });
      } catch (e) {
        console.error("[Call] call:start error", e);
        ack({ ok: false, error: "Внутренняя ошибка сервера" });
      }
    });

    socket.on("call:answer", async (data, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      if (!data || !data.callId || !data.chatId || !data.answer) return ack({ ok: false });
      const { chatId, callId, answer } = data;

      const membership = await prisma.chatMember.findFirst({
        where: { chatId, userId: user.id, status: "ACTIVE" }
      });
      if (!membership) return ack({ ok: false });

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { members: { where: { status: "ACTIVE" } } }
      });
      const caller = chat.members.find(m => m.userId !== user.id);
      if (!caller) return ack({ ok: false });

      socket.to(`user:${caller.userId}`).emit("call:answer", { callId, chatId, answer });
      ack({ ok: true });
    });

    socket.on("call:ice-candidate", async (data, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      if (!data || !data.callId || !data.chatId || !data.candidate) return ack({ ok: false });
      const { chatId, callId, candidate } = data;

      const membership = await prisma.chatMember.findFirst({
        where: { chatId, userId: user.id, status: "ACTIVE" }
      });
      if (!membership) return ack({ ok: false });

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { members: { where: { status: "ACTIVE" } } }
      });
      const target = chat.members.find(m => m.userId !== user.id);
      if (!target) return ack({ ok: false });

      socket.to(`user:${target.userId}`).emit("call:ice-candidate", { callId, chatId, candidate });
      ack({ ok: true });
    });

    socket.on("call:accepted", async (data, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      if (!data || !data.callId || !data.chatId) return ack({ ok: false });
      const { chatId, callId } = data;

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { members: { where: { status: "ACTIVE" } } }
      });
      const caller = chat.members.find(m => m.userId !== user.id);
      if (!caller) return ack({ ok: false });

      socket.to(`user:${caller.userId}`).emit("call:accepted", { callId, chatId });
      ack({ ok: true });
    });

    socket.on("call:declined", async (data, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      if (!data || !data.callId || !data.chatId) return ack({ ok: false });
      const { chatId, callId } = data;

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { members: { where: { status: "ACTIVE" } } }
      });
      const other = chat.members.find(m => m.userId !== user.id);
      if (!other) return ack({ ok: false });

      socket.to(`user:${other.userId}`).emit("call:declined", { callId, chatId });
      ack({ ok: true });
    });

    socket.on("call:ended", async (data, callback) => {
      const ack = typeof callback === "function" ? callback : () => {};
      if (!data || !data.callId || !data.chatId) return ack({ ok: false });
      const { chatId, callId } = data;

      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        include: { members: { where: { status: "ACTIVE" } } }
      });
      const other = chat.members.find(m => m.userId !== user.id);
      if (!other) return ack({ ok: false });

      socket.to(`user:${other.userId}`).emit("call:ended", { callId, chatId });
      ack({ ok: true });
    });

    // --- End of Calls ---

    socket.on("typing:start", async (data) => {
      if (!data || typeof data !== "object") return;
      const { chatId } = data;
      if (typeof chatId !== "string") return;
      const membership = await prisma.chatMember.findFirst({
        where: { chatId, userId: user.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (!membership) return;
      socket.to(`chat:${chatId}`).emit("typing:update", { chatId, userId: user.id, username: user.username, displayName: user.displayName, isTyping: true });
    });

    socket.on("typing:stop", async (data) => {
      if (!data || typeof data !== "object") return;
      const { chatId } = data;
      if (typeof chatId !== "string") return;
      const membership = await prisma.chatMember.findFirst({
        where: { chatId, userId: user.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (!membership) return;
      socket.to(`chat:${chatId}`).emit("typing:update", { chatId, userId: user.id, username: user.username, displayName: user.displayName, isTyping: false });
    });

    socket.on("message:delivered", async (data) => {
      if (!data || typeof data.messageId !== "string") return;
      const { messageId } = data;
      const message = await prisma.message.findUnique({ where: { id: messageId }, select: { chatId: true, senderUserId: true } });
      if (!message || message.senderUserId === user.id) return;
      const membership = await prisma.chatMember.findFirst({ where: { chatId: message.chatId, userId: user.id, status: "ACTIVE" } });
      if (!membership) return;
      const receipt = await prisma.messageReceipt.update({ where: { messageId_userId: { messageId, userId: user.id } }, data: { deliveredAt: new Date() } });
      io.to(`chat:${message.chatId}`).emit("message:receipt-updated", { chatId: message.chatId, messageId, userId: user.id, deliveredAt: receipt.deliveredAt, readAt: receipt.readAt });
    });

    socket.on("disconnect", (reason) => {
      if (DEBUG_REALTIME) console.log(`[socket] disconnected userId=${user.id} reason=${reason}`);
    });

    socket.on("error", (error) => {
      console.error(`[socket] error userId=${user.id}:`, error);
    });
  });

  if (DEBUG_REALTIME) {
    setInterval(() => {
      io.emit("server:heartbeat", { time: new Date().toISOString() });
    }, 30000);
  }

  httpServer.listen(port, hostname, () => {
    console.log(`> Server listening on ${hostname}:${port} as ${dev ? "development" : process.env.NODE_ENV}`);
    if (dev) {
      console.log(`> Local URL: http://127.0.0.1:${port}`);
    }
  });
});
