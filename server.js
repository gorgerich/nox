/* eslint-disable @typescript-eslint/no-require-imports */

const { createServer } = require("node:http");
const next = require("next");
const { Server } = require("socket.io");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const port = Number.parseInt(process.env.PORT || "3000", 10);
const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
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

    if (DEBUG_REALTIME) {
      console.log(`[socket] joined user room user:${user.id}`);
    }

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

      if (DEBUG_REALTIME) {
        console.log(`[socket] joined chat room chat:${membership.chatId} for userId=${user.id}`);
      }
    });

    socket.on("chat:join", async (chatId) => {
      if (typeof chatId !== "string") {
        return;
      }

      const membership = await prisma.chatMember.findFirst({
        where: {
          chatId,
          userId: user.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
        },
      });

      if (membership) {
        socket.join(`chat:${chatId}`);

        if (DEBUG_REALTIME) {
          console.log(`[socket] joined chat room chat:${chatId} via chat:join for userId=${user.id}`);
        }
      }
    });

    socket.on("chat:leave", (chatId) => {
      if (typeof chatId === "string") {
        socket.leave(`chat:${chatId}`);

        if (DEBUG_REALTIME) {
          console.log(`[socket] left chat room chat:${chatId} for userId=${user.id}`);
        }
      }
    });

    socket.on("typing:start", async (data) => {
      if (!data || typeof data !== "object") {
        return;
      }

      const { chatId } = data;

      if (typeof chatId !== "string") {
        return;
      }

      const membership = await prisma.chatMember.findFirst({
        where: {
          chatId,
          userId: user.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
        },
      });

      if (!membership) {
        return;
      }

      socket.to(`chat:${chatId}`).emit("typing:update", {
        chatId,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        isTyping: true,
      });
    });

    socket.on("typing:stop", async (data) => {
      if (!data || typeof data !== "object") {
        return;
      }

      const { chatId } = data;

      if (typeof chatId !== "string") {
        return;
      }

      const membership = await prisma.chatMember.findFirst({
        where: {
          chatId,
          userId: user.id,
          status: "ACTIVE",
        },
        select: {
          id: true,
        },
      });

      if (!membership) {
        return;
      }

      socket.to(`chat:${chatId}`).emit("typing:update", {
        chatId,
        userId: user.id,
        username: user.username,
        displayName: user.displayName,
        isTyping: false,
      });
    });

    socket.on("disconnect", (reason) => {
      if (DEBUG_REALTIME) {
        console.log(`[socket] disconnected userId=${user.id} reason=${reason}`);
      }
    });

    socket.on("error", (error) => {
      console.error(`[socket] error userId=${user.id}:`, error);
    });
  });

  if (DEBUG_REALTIME) {
    setInterval(() => {
      io.emit("server:heartbeat", { time: new Date().toISOString() });
      console.log(`[socket] heartbeat sent at ${new Date().toISOString()}`);
    }, 30000);
  }

  const hostname = "0.0.0.0";

  httpServer.listen(port, hostname, () => {
    const localUrl = `http://127.0.0.1:${port}`;
    console.log(`> Server listening at ${localUrl} as ${dev ? "development" : process.env.NODE_ENV}`);
  });
});