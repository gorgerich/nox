/* eslint-disable @typescript-eslint/no-require-imports */
const { loadEnvConfig } = require("@next/env");

loadEnvConfig(process.cwd());

const { createServer } = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const webpush = require("web-push");
const { createHmac, timingSafeEqual } = require("crypto");
/* eslint-enable @typescript-eslint/no-require-imports */

const DEBUG_CALLS = process.env.NEXT_PUBLIC_DEBUG_CALLS === "true";
const DEBUG_REALTIME = process.env.DEBUG_REALTIME === "true";
const DEBUG_PRESENCE = process.env.DEBUG_PRESENCE === "true";
const CALL_TIMEOUT_MS = 45_000;
const MAX_CALL_LIFETIME_MS = 8 * 60 * 60_000;
const MAX_SIGNAL_PAYLOAD_BYTES = 64 * 1024;
const MAX_ICE_PAYLOAD_BYTES = 16 * 1024;
const MAX_QUEUED_ICE_PER_USER = 128;
const MAX_JSON_API_BODY_BYTES = 256 * 1024;
const MAX_AVATAR_BODY_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENT_BODY_BYTES = 160 * 1024 * 1024;
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

function isUserSocketReachable(io, userId) {
  const socketSet = onlineUsers.get(userId);
  return (socketSet?.size ?? 0) > 0 || getUserRoomSize(io, userId) > 0;
}

function isCallExpired(call) {
  return !call || Date.now() - call.createdAt > MAX_CALL_LIFETIME_MS || (call.status === "ringing" && Date.now() > call.expiresAt);
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

function createCallRecord({ callId, chatId, callerId, calleeId, offer, fromUser, callerSocketId, video }) {
  return {
    callId,
    chatId,
    callerId,
    calleeId,
    status: "ringing",
    offer,
    video: video === true,
    fromUser,
    createdAt: Date.now(),
    expiresAt: Date.now() + CALL_TIMEOUT_MS,
    callerSocketId,
    queuedIceByUser: {
      [callerId]: [],
      [calleeId]: [],
    },
  };
}

async function saveCallLog(call, status) {
  if (!call) return;
  try {
    const startedAt = new Date(call.createdAt);
    const answeredAt = call.answeredAt ? new Date(call.answeredAt) : null;
    const endedAt = new Date();
    let durationSec = null;
    if (answeredAt) {
      durationSec = Math.floor((endedAt.getTime() - answeredAt.getTime()) / 1000);
    }

    await prisma.callLog.create({
      data: {
        chatId: call.chatId,
        callerId: call.callerId,
        calleeId: call.calleeId,
        status,
        startedAt,
        answeredAt,
        endedAt,
        durationSec,
      },
    });
    logCall("call log saved", { callId: call.callId, status });
  } catch (error) {
    console.error("Failed to save call log", error);
  }
}

function scheduleCallMissedTimeout(io, callId) {
  clearCallExpiryTimer(callId);

  const call = activeCalls.get(callId);
  if (!call) {
    return;
  }

  const timeoutMs = Math.max(0, call.expiresAt - Date.now());
  logCall("missed timeout scheduled", { callId, ms: timeoutMs });

  const timeoutId = setTimeout(async () => {
    callExpiryTimers.delete(callId);
    const currentCall = activeCalls.get(callId);
    logCall("missed timeout fired", { callId, status: currentCall?.status ?? "missing" });

    if (!currentCall || currentCall.status !== "ringing") {
      return;
    }

    io.to(`user:${currentCall.callerId}`).emit("call:ended", { callId, reason: "expired" });
    io.to(`user:${currentCall.calleeId}`).emit("call:ended", { callId, reason: "expired" });
    await saveCallLog(currentCall, "missed");
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
    void saveCallLog(call, "missed");
    deleteCall(callId);
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

function createCredentialStamp(passwordHash) {
  return createHmac("sha256", getJwtSecret())
    .update(passwordHash || "no-password")
    .digest("base64url");
}

function credentialStampsMatch(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function payloadFits(value, maxBytes) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes;
  } catch {
    return false;
  }
}

function getApiBodyLimit(pathname) {
  if (/^\/api\/chats\/[^/]+\/attachments\/?$/.test(pathname)) return MAX_ATTACHMENT_BODY_BYTES;
  if (pathname === "/api/me/avatar" || /^\/api\/chats\/[^/]+\/group-avatar\/?$/.test(pathname)) {
    return MAX_AVATAR_BODY_BYTES;
  }
  return MAX_JSON_API_BODY_BYTES;
}

function configuredSocketOrigins() {
  const origins = new Set(["https://noxchat.ru", "capacitor://localhost"]);
  for (const value of [process.env.APP_URL, process.env.NEXT_PUBLIC_APP_URL, process.env.CAPACITOR_SERVER_URL]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Invalid deployment config must not broaden socket access.
    }
  }
  return origins;
}

const allowedSocketOrigins = configuredSocketOrigins();

function isAllowedSocketOrigin(origin) {
  if (!origin) return true;
  if (allowedSocketOrigins.has(origin)) return true;
  return dev && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
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

  if (typeof payload.userId !== "string" || typeof payload.credentialStamp !== "string") {
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
        passwordHash: true,
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

  if (
    !user ||
    user.status !== "ACTIVE" ||
    !credentialStampsMatch(payload.credentialStamp, createCredentialStamp(user.passwordHash))
  ) {
    return null;
  }

  if (emergencyLock?.value === "true" && user.role === "MEMBER") {
    return null;
  }

  const safeUser = { ...user };
  delete safeUser.passwordHash;
  return safeUser;
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
    if (req.url?.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method || "GET")) {
      const contentLength = Number(req.headers["content-length"] || 0);
      const pathname = new URL(req.url, "http://localhost").pathname;
      if (Number.isFinite(contentLength) && contentLength > getApiBodyLimit(pathname)) {
        res.writeHead(413, { "Content-Type": "application/json; charset=utf-8", Connection: "close" });
        res.end(JSON.stringify({ error: "Тело запроса слишком большое." }));
        return;
      }
    }
    handle(req, res);
  });

  const io = new Server(server, {
    maxHttpBufferSize: 256 * 1024,
    cors: {
      origin(origin, callback) {
        callback(null, isAllowedSocketOrigin(origin));
      },
      methods: ["GET", "POST"],
    },
    allowRequest(req, callback) {
      callback(null, isAllowedSocketOrigin(req.headers.origin));
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
    const eventBuckets = new Map();

    function consumeEventBudget(scope, limit, windowMs) {
      const now = Date.now();
      const current = eventBuckets.get(scope);
      const entry = !current || current.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : current;
      entry.count += 1;
      eventBuckets.set(scope, entry);
      return entry.count <= limit;
    }

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

    socket.on("typing:start", async (payload, callback) => {
      const chatId = payload && typeof payload === "object" ? payload.chatId : null;
      if (!consumeEventBudget("typing", 120, 60_000)) {
        callback?.({ ok: false, error: "Слишком много событий" });
        return;
      }
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

    socket.on("typing:stop", async (payload, callback) => {
      const chatId = payload && typeof payload === "object" ? payload.chatId : null;
      if (!consumeEventBudget("typing", 120, 60_000)) {
        callback?.({ ok: false, error: "Слишком много событий" });
        return;
      }
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

    socket.on("call:start", async (payload, callback) => {
      const { callId: requestedCallId, chatId, offer, video } = payload && typeof payload === "object" ? payload : {};
      sweepExpiredCalls(io);
      logCall("call:start received", { chatId, userId, video: video === true });

      if (
        !consumeEventBudget("call:start", 10, 60_000) ||
        typeof chatId !== "string" ||
        !offer ||
        !payloadFits(offer, MAX_SIGNAL_PAYLOAD_BYTES)
      ) {
        callback?.({ ok: false, error: "Некорректный звонок" });
        return;
      }

      const alreadyInCall = Array.from(activeCalls.values()).some((call) =>
        call.callerId === userId || call.calleeId === userId,
      );
      if (alreadyInCall) {
        callback?.({ ok: false, error: "CALLER_BUSY" });
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
      const calleeOnline = isUserSocketReachable(io, context.calleeId);

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

      const callId = typeof requestedCallId === "string" && requestedCallId.length >= 8 && requestedCallId.length <= 128 && !activeCalls.has(requestedCallId)
        ? requestedCallId
        : uuidv4();
      const callerDisplayName = user.profile?.displayName ?? user.username;
      const callerAvatarUrl = user.profile?.avatarUrl ?? null;
      const callRecord = createCallRecord({
        callId,
        chatId,
        callerId: context.callerId,
        calleeId: context.calleeId,
        offer,
        fromUser: {
          id: user.id,
          username: user.username,
          displayName: callerDisplayName,
          avatarUrl: callerAvatarUrl,
        },
        callerSocketId: socket.id,
        video,
      });
      activeCalls.set(callId, callRecord);
      scheduleCallMissedTimeout(io, callId);
      logCall("active call created", {
        callId,
        chatId,
        callerId: context.callerId,
        calleeId: context.calleeId,
        expiresIn: CALL_TIMEOUT_MS,
      });

      if (calleeOnline) {
        io.to(`user:${context.calleeId}`).emit("call:incoming", {
          callId,
          chatId,
          offer,
          fromUser: callRecord.fromUser,
          source: "foreground",
          video: callRecord.video,
        });
        logCall("incoming emitted", { callId, chatId, calleeId: context.calleeId, source: "foreground" });
      } else {
        const pushResult = await sendPushToUser(context.calleeId, {
          title: "Входящий звонок",
          body: callerDisplayName,
          url: `/calls/incoming?callId=${encodeURIComponent(callId)}`,
          type: "incoming-call",
          callId,
          chatId,
          fromUserId: user.id,
          tag: `call:${callId}`,
          requireInteraction: true,
        });

        logCall("incoming call push attempted", { callId, calleeId: context.calleeId, sent: pushResult.sent, total: pushResult.total });
        if (!pushResult.total || !pushResult.sent) {
          await saveCallLog(callRecord, "missed");
          deleteCall(callId);
          callback?.({ ok: false, error: "USER_UNREACHABLE" });
          return;
        }
      }

      callback?.({
        ok: true,
        callId,
        delivery: calleeOnline ? "foreground" : "push",
      });
    });

    socket.on("call:resume-pending", async (payload, callback) => {
      const callId = payload && typeof payload === "object" ? payload.callId : null;
      sweepExpiredCalls(io);
      const call = activeCalls.get(callId);
      logCall("call:resume-pending received", { callId, userId, exists: Boolean(call), status: call?.status ?? null });

      if (!call) {
        callback?.({ ok: false, error: "CALL_NOT_FOUND" });
        return;
      }

      if (call.calleeId !== userId) {
        callback?.({ ok: false, error: "NOT_CALL_PARTICIPANT" });
        return;
      }

      if (isCallExpired(call)) {
        await saveCallLog(call, "missed");
        deleteCall(callId);
        callback?.({ ok: false, error: "CALL_EXPIRED" });
        return;
      }

      if (call.status !== "ringing") {
        callback?.({ ok: false, error: "INVALID_STATE" });
        return;
      }

      if (!(await isActiveMember(call.chatId, userId))) {
        callback?.({ ok: false, error: "Нет доступа" });
        return;
      }

      const incomingPayload = {
        callId,
        chatId: call.chatId,
        offer: call.offer,
        fromUser: call.fromUser,
        source: "push",
        video: call.video === true,
      };

      socket.emit("call:incoming", incomingPayload);
      const queuedForCallee = call.queuedIceByUser?.[userId] ?? [];
      for (const candidate of queuedForCallee) {
        socket.emit("call:ice-candidate", { callId, chatId: call.chatId, candidate });
      }
      call.queuedIceByUser[userId] = [];
      logCall("pending call resumed", { callId, calleeId: userId, queuedIce: queuedForCallee.length });
      callback?.({ ok: true, call: incomingPayload, queuedIce: queuedForCallee });
    });

    socket.on("call:answer", async (payload, callback) => {
      const { callId, chatId, answer } = payload && typeof payload === "object" ? payload : {};
      sweepExpiredCalls(io);
      const call = activeCalls.get(callId);
      logCall("call:answer received", {
        callId,
        chatId,
        userId,
        status: call?.status ?? null,
        exists: Boolean(call),
      });

      if (!call || call.chatId !== chatId || !answer || !payloadFits(answer, MAX_SIGNAL_PAYLOAD_BYTES)) {
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
      call.answeredAt = Date.now();
      clearCallExpiryTimer(callId);
      io.to(`user:${call.callerId}`).emit("call:answer", { callId, chatId, answer });
      const queuedForCaller = call.queuedIceByUser?.[call.callerId] ?? [];
      for (const candidate of queuedForCaller) {
        io.to(`user:${call.callerId}`).emit("call:ice-candidate", { callId, chatId, candidate });
      }
      if (call.queuedIceByUser) {
        call.queuedIceByUser[call.callerId] = [];
      }
      logCall("call:answer forwarded", { callId, fromUserId: userId, toUserId: call.callerId });
      callback?.({ ok: true });
    });

    socket.on("call:ice-candidate", async (payload, callback) => {
      const { callId, chatId, candidate } = payload && typeof payload === "object" ? payload : {};
      sweepExpiredCalls(io);
      if (!consumeEventBudget("call:ice", 300, 60_000) || !candidate || !payloadFits(candidate, MAX_ICE_PAYLOAD_BYTES)) {
        callback?.({ ok: false, error: "INVALID_ICE_CANDIDATE" });
        return;
      }
      const call = activeCalls.get(callId);
      if (!call) {
        logCall("ice rejected: call not found", { callId, fromUserId: userId });
        callback?.({ ok: false, error: "CALL_NOT_FOUND" });
        return;
      }
      if (call.chatId !== chatId) {
        logCall("ice rejected: chat mismatch", { callId, chatId, expectedChatId: call.chatId });
        callback?.({ ok: false, error: "CALL_CHAT_MISMATCH" });
        return;
      }

      if (isCallExpired(call)) {
        if (call && isCallExpired(call)) {
          deleteCall(callId);
        }
        logCall("ice rejected: call expired", { callId });
        callback?.({ ok: false, error: "CALL_EXPIRED" });
        return;
      }

      if (userId !== call.callerId && userId !== call.calleeId) {
        logCall("ice rejected: not participant", { callId, userId });
        callback?.({ ok: false, error: "NOT_CALL_PARTICIPANT" });
        return;
      }

      const targetId = userId === call.callerId ? call.calleeId : call.callerId;
      logCall("ice received", { callId, fromUserId: userId, fromRole: userId === call.callerId ? "caller" : "callee" });
      if (isUserSocketReachable(io, targetId)) {
        io.to(`user:${targetId}`).emit("call:ice-candidate", { callId, chatId, candidate });
      } else {
        if (!call.queuedIceByUser) call.queuedIceByUser = {};
        if (!call.queuedIceByUser[targetId]) call.queuedIceByUser[targetId] = [];
        if (call.queuedIceByUser[targetId].length >= MAX_QUEUED_ICE_PER_USER) {
          callback?.({ ok: false, error: "ICE_QUEUE_FULL" });
          return;
        }
        call.queuedIceByUser[targetId].push(candidate);
        logCall("ice queued for offline target", { callId, targetId, count: call.queuedIceByUser[targetId].length });
      }
      logCall("ice forwarded", {
        callId,
        fromRole: userId === call.callerId ? "caller" : "callee",
        toRole: targetId === call.callerId ? "caller" : "callee",
        toUserId: targetId,
      });
      callback?.({ ok: true });
    });

    socket.on("call:declined", async (payload, callback) => {
      const { callId, reason } = payload && typeof payload === "object" ? payload : {};
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
      await saveCallLog(call, "declined");
      deleteCall(callId);
      logCall("call ended", { callId, reason: reason ?? "declined" });
      callback?.({ ok: true });
    });

    socket.on("call:ended", async (payload, callback) => {
      const { callId, reason } = payload && typeof payload === "object" ? payload : {};
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
      
      const status = call.answeredAt ? "completed" : (userId === call.callerId ? "canceled" : "declined");
      await saveCallLog(call, status);
      
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

  // Keep the (serverless/auto-suspending) database compute warm so the first
  // request after a quiet period doesn't pay a multi-second cold start.
  // Lightweight no-op query on an interval; failures are ignored.
  const DB_KEEPALIVE_MS = 240_000; // 4 min — below typical 5-min autosuspend
  const keepAlive = setInterval(() => {
    prisma.$queryRaw`SELECT 1`.catch((error) => {
      console.error("[db-keepalive] ping failed", error?.message ?? error);
    });
  }, DB_KEEPALIVE_MS);
  if (typeof keepAlive.unref === "function") keepAlive.unref();
});
