/* eslint-disable @typescript-eslint/no-require-imports */
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

const prisma = new PrismaClient();

// In-memory registry for active calls
const activeCalls = new Map();

// Presence Registry: Map<userId, Set<socketId>>
const onlineUsers = new Map();

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

  io.on("connection", async (socket) => {
    const userId = socket.handshake.query.userId;
    if (!userId) return;

    socket.join(`user:${userId}`);

    // Track online status
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
      // First device online
      io.emit("presence:update", { userId, status: "online" });
    }
    onlineUsers.get(userId).add(socket.id);

    // --- CHAT EVENTS ---
    socket.on("chat:join", (chatId) => {
      socket.join(`chat:${chatId}`);
    });

    socket.on("chat:leave", (chatId) => {
      socket.leave(`chat:${chatId}`);
    });

    socket.on("typing:start", ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit("typing:update", {
        chatId,
        userId,
        isTyping: true,
      });
    });

    socket.on("typing:stop", ({ chatId }) => {
      socket.to(`chat:${chatId}`).emit("typing:update", {
        chatId,
        userId,
        isTyping: false,
      });
    });

    // --- CALL EVENTS ---
    socket.on("call:start", ({ chatId, offer, fromUser }, callback) => {
      const callId = uuidv4();
      activeCalls.set(callId, {
        callId,
        chatId,
        callerId: userId,
        status: "ringing",
        createdAt: Date.now()
      });

      socket.to(`chat:${chatId}`).emit("call:incoming", {
        callId,
        chatId,
        offer,
        fromUser
      });

      if (callback) callback({ ok: true, callId });
    });

    socket.on("call:answer", ({ callId, chatId, answer }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) {
        if (callback) callback({ ok: false, error: "Call not found" });
        return;
      }
      call.status = "connecting";
      call.calleeId = userId;
      socket.to(`user:${call.callerId}`).emit("call:answered", {
        callId,
        chatId,
        answer
      });
      if (callback) callback({ ok: true });
    });

    socket.on("call:ice-candidate", ({ callId, candidate }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) return;
      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      if (targetId) {
        socket.to(`user:${targetId}`).emit("call:ice-candidate", {
          callId,
          candidate
        });
      }
      if (callback) callback({ ok: true });
    });

    socket.on("call:ended", ({ callId, reason }, callback) => {
      const call = activeCalls.get(callId);
      if (call) {
        const targetId = userId === call.callerId ? call.calleeId : call.callerId;
        if (targetId) {
          socket.to(`user:${targetId}`).emit("call:ended", { callId, reason });
        }
        activeCalls.delete(callId);
      }
      if (callback) callback({ ok: true });
    });

    socket.on("call:declined", ({ callId }, callback) => {
      const call = activeCalls.get(callId);
      if (call) {
        socket.to(`user:${call.callerId}`).emit("call:declined", { callId });
        activeCalls.delete(callId);
      }
      if (callback) callback({ ok: true });
    });

    // --- DISCONNECT ---
    socket.on("disconnect", async () => {
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          const lastSeenAt = new Date();
          
          // Update DB
          try {
            await prisma.user.update({
              where: { id: userId },
              data: { lastSeenAt }
            });
          } catch (e) {
            console.error("Failed to update lastSeenAt", e);
          }
          
          // Emit offline status
          io.emit("presence:update", { userId, status: "offline", lastSeenAt });
        }
      }

      activeCalls.forEach((call, callId) => {
        if (call.callerId === userId || call.calleeId === userId) {
          const targetId = userId === call.callerId ? call.calleeId : call.callerId;
          if (targetId) {
            io.to(`user:${targetId}`).emit("call:ended", { callId, reason: "disconnect" });
          }
          activeCalls.delete(callId);
        }
      });
    });
  });

  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => {
    console.log(`> Ready on http://localhost:${PORT}`);
  });
});
