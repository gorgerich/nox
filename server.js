const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// In-memory registry for active calls
// Map<callId, { chatId, callerId, calleeId, status, createdAt }>
const activeCalls = new Map();

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

  io.on("connection", (socket) => {
    const userId = socket.handshake.query.userId;
    if (!userId) return;

    socket.join(`user:${userId}`);

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

    // --- CALL EVENTS (Offer-first flow) ---
    
    // 1. Caller starts the call
    socket.on("call:start", ({ chatId, offer, fromUser }, callback) => {
      const callId = uuidv4();
      
      // In a real app, we should validate chat membership here via DB
      // For MVP, we assume the client is correct but route safely
      
      // Determine callee (logic should ideally be server-side, for now simple routing)
      // Note: calleeId should be fetched from DB based on chatId and userId
      // We expect fromUser to contain current user info for the UI
      
      activeCalls.set(callId, {
        callId,
        chatId,
        callerId: userId,
        status: "ringing",
        createdAt: Date.now()
      });

      // Target all other users in the chat (in DIRECT it's only one)
      socket.to(`chat:${chatId}`).emit("call:incoming", {
        callId,
        chatId,
        offer,
        fromUser
      });

      if (callback) callback({ ok: true, callId });
    });

    // 2. Callee provides WebRTC Answer
    socket.on("call:answer", ({ callId, chatId, answer }, callback) => {
      const call = activeCalls.get(callId);
      if (!call) {
        if (callback) callback({ ok: false, error: "Call not found" });
        return;
      }

      call.status = "connecting";
      call.calleeId = userId;

      // Forward answer to the caller
      socket.to(`user:${call.callerId}`).emit("call:answered", {
        callId,
        chatId,
        answer
      });

      if (callback) callback({ ok: true });
    });

    // 3. Exchange ICE Candidates
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

    // 4. Handle End/Decline
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

    socket.on("disconnect", () => {
      // Cleanup any active calls where this user was a participant
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
