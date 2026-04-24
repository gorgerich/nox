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
  const token = getCookie(socket.handshake.headers.cookie, "pm_session");

  if (!token) {
    return null;
  }

  const { jwtVerify } = await import("jose");
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    throw new Error("AUTH_SECRET is required.");
  }

  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));

  if (typeof payload.userId !== "string") {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      role: true,
      status: true,
    },
  });

  const emergencyLocked = await getEmergencyLocked();

  if (!canUseApp(user, emergencyLocked)) {
    return null;
  }

  return user;
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    handle(req, res);
  });

  const io = new Server(httpServer, {
    path: "/socket.io",
  });

  globalThis.pmSocketIo = io;

  io.use(async (socket, nextSocket) => {
    try {
      const user = await getSocketUser(socket);

      if (!user) {
        nextSocket(new Error("Нет доступа."));
        return;
      }

      socket.data.user = user;
      nextSocket();
    } catch (error) {
      console.error("Socket auth error:", error);
      nextSocket(new Error("Нет доступа."));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user;
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
      }
    });

    socket.on("chat:leave", (chatId) => {
      if (typeof chatId === "string") {
        socket.leave(`chat:${chatId}`);
      }
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Server listening at http://localhost:${port} as ${dev ? "development" : process.env.NODE_ENV}`);
  });
});
