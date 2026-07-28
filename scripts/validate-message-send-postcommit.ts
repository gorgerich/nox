/**
 * The post-commit contract of the message send routes.
 *
 *   npm run validate:message-send-postcommit
 *
 * One rule, checked from every angle it can break:
 *
 *   the commit succeeded → the message is sent → the sender is not told it failed
 *
 * Production broke that rule. `chat.updatedAt` was bumped in a second,
 * separate transaction after the message was already committed; under
 * connection-pool pressure that transaction expired (`P2028`) and the route
 * threw, so a message that is durably in Postgres came back to its sender as
 * an HTTP 500.
 *
 * The pressure here is deterministic, not a race dressed up as one: the app
 * runs against a pool of exactly one connection, and a *separate* connection
 * holds a row lock on the chat for as long as the scenario needs. No sleeps
 * stand in for synchronisation.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import {
  HARNESS_PASSWORD,
  createChecker,
  createPrisma,
  requireIsolatedDatabase,
  startApp,
  type RunningApp,
} from "./lib/browser-harness";

const PORT = Number(process.env.POSTCOMMIT_PORT ?? 3993);
const { check, failures } = createChecker();
const failed = () => failures();

type Prisma = ReturnType<typeof createPrisma>;

/** A signed-in caller: the cookie jar plus the fetch that carries it. */
type Caller = {
  userId: string;
  username: string;
  post: (path: string, body: unknown, init?: RequestInit) => Promise<Response>;
  postForm: (path: string, form: FormData, init?: RequestInit) => Promise<Response>;
};

async function seedUser(prisma: Prisma, username: string): Promise<string> {
  const user = await prisma.user.create({
    // `login` and an ACTIVE status are what the login route actually matches on.
    data: {
      username,
      login: username,
      status: "ACTIVE",
      passwordHash: await bcrypt.hash(HARNESS_PASSWORD, 10),
    },
    select: { id: true },
  });
  return user.id;
}

async function signIn(base: string, userId: string, username: string): Promise<Caller> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login: username, password: HARNESS_PASSWORD }),
  });
  if (!response.ok) throw new Error(`sign-in for ${username} failed: status ${response.status}`);
  const cookie = (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(";")[0])
    .join("; ");
  if (!cookie) throw new Error(`sign-in for ${username} returned no session cookie`);

  return {
    userId,
    username,
    post: (path, body, init) =>
      fetch(`${base}${path}`, {
        ...init,
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(body),
      }),
    postForm: (path, form, init) =>
      fetch(`${base}${path}`, { ...init, method: "POST", headers: { cookie }, body: form }),
  };
}

/**
 * Holds a `FOR UPDATE` lock on the chat row on its own connection, so any
 * `chat.update` inside the app blocks until `release()` is called. This is the
 * barrier the old code failed on: it made the post-commit transaction wait past
 * its five-second timeout, which is precisely how P2028 was produced.
 */
async function lockChatRow(url: string, chatId: string) {
  const holder = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
  let releaseLock: () => void = () => {};
  const locked = new Promise<void>((resolve) => {
    const held = new Promise<void>((resolveHeld) => {
      releaseLock = resolveHeld;
    });
    void holder
      .$transaction(async (tx) => {
        // FOR NO KEY UPDATE, not FOR UPDATE: it blocks the bookkeeping UPDATE
        // while still allowing the FK key-share lock that inserting a message
        // into this chat takes. FOR UPDATE would block the message insert too,
        // which is a pre-commit failure and a different scenario entirely.
        await tx.$queryRawUnsafe(`SELECT id FROM "Chat" WHERE id = $1 FOR NO KEY UPDATE`, chatId);
        resolve();
        await held;
      }, { timeout: 30_000, maxWait: 30_000 })
      .catch(() => resolve());
  });
  await locked;
  return async () => {
    releaseLock();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await holder.$disconnect();
  };
}

/** Idle-in-transaction connections are how a leaked transaction shows up. */
async function idleInTransaction(prisma: Prisma): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*)::bigint AS count FROM pg_stat_activity
       WHERE state = 'idle in transaction' AND application_name NOT LIKE '%validate%'`,
  );
  return Number(rows[0]?.count ?? 0);
}

function textMessage(clientId: string, body: string) {
  return { body, clientId, clientMessageId: clientId };
}

/** Server output, so a P2028 anywhere in the run is visible rather than inferred. */
const serverLog: string[] = [];

async function bootApp(url: string, extraEnv: Record<string, string>): Promise<RunningApp> {
  const app = await startApp(url, PORT, { DATABASE_POOL_MAX: "1", ...extraEnv });
  return app;
}

async function main() {
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const stamp = Date.now();

  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const line = String(chunk);
    if (line.includes("[server]")) serverLog.push(line);
    return originalWrite(chunk as string, ...(rest as []));
  }) as typeof process.stdout.write;

  let app: RunningApp | null = null;
  try {
    const aId = await seedUser(prisma, `pca${stamp}`);
    const bId = await seedUser(prisma, `pcb${stamp}`);
    const groupId = randomUUID();
    await prisma.chat.create({
      data: {
        id: groupId,
        type: "GROUP",
        title: "post-commit",
        createdBy: { connect: { id: aId } },
        members: { create: [{ userId: aId, role: "OWNER" }, { userId: bId, role: "MEMBER" }] },
      },
    });

    // A DIRECT chat as well: encrypted envelopes are a DIRECT-chat path — the
    // route requires an envelope for the peer, which a group does not have.
    const directId = randomUUID();
    await prisma.chat.create({
      data: {
        id: directId,
        type: "DIRECT",
        createdBy: { connect: { id: aId } },
        members: { create: [{ userId: aId, role: "OWNER" }, { userId: bId, role: "MEMBER" }] },
      },
    });

    // Every app connection gives up on a contended row after 1.5s instead of
    // waiting indefinitely. That turns "the bookkeeping write is blocked" into
    // a fast, deterministic failure — the exact condition whose handling is
    // under test — with no sleep standing in for it.
    await prisma.$executeRawUnsafe(`ALTER DATABASE "${new URL(url).pathname.slice(1)}" SET lock_timeout = '1500ms'`);

    // --- 1. an ordinary send, and 2. it is already running on a pool of one --
    app = await bootApp(url, {});
    let caller = await signIn(app.base, aId, `pca${stamp}`);

    const firstId = randomUUID();
    const first = await caller.post(`/api/chats/${groupId}/messages`, textMessage(firstId, "ordinary"));
    check("an ordinary send succeeds on a single-connection pool", first.status === 201, `status ${first.status}`);
    const firstRow = await prisma.message.count({ where: { chatId: groupId, clientMessageId: firstId } });
    check("the ordinary send is committed exactly once", firstRow === 1, `rows=${firstRow}`);

    // --- 3. several sends at once -------------------------------------------
    const concurrentIds = Array.from({ length: 8 }, () => randomUUID());
    const concurrent = await Promise.all(
      concurrentIds.map((id) => caller.post(`/api/chats/${groupId}/messages`, textMessage(id, `concurrent-${id.slice(0, 8)}`))),
    );
    check(
      "every concurrent send is accepted",
      concurrent.every((response) => response.status === 201),
      `statuses=${concurrent.map((response) => response.status).join(",")}`,
    );
    const concurrentRows = await prisma.message.count({ where: { chatId: groupId, clientMessageId: { in: concurrentIds } } });
    check("each concurrent send committed exactly once", concurrentRows === 8, `rows=${concurrentRows}`);

    // --- 4. a slow database operation, held open deterministically ----------
    // The lock makes the chat bookkeeping wait. Before the fix this was the
    // P2028: the bookkeeping ran in its own transaction after the commit, so
    // waiting past the timeout turned a committed message into a 500.
    const releaseLock = await lockChatRow(url, groupId);
    const blockedId = randomUUID();
    const blockedStarted = Date.now();
    const blocked = await caller.post(`/api/chats/${groupId}/messages`, textMessage(blockedId, "blocked-bookkeeping"));
    const blockedTook = Date.now() - blockedStarted;
    await releaseLock();
    check("a send whose chat row is locked still succeeds", blocked.status === 201, `status ${blocked.status} after ${blockedTook}ms`);
    const blockedRow = await prisma.message.findFirst({ where: { chatId: groupId, clientMessageId: blockedId } });
    check("the message held behind the lock is committed", Boolean(blockedRow));
    const blockedBody = await blocked.clone().json().catch(() => null);
    check("the locked-chat response still carries the canonical message", Boolean(blockedBody?.message?.id), `id=${blockedBody?.message?.id ?? "none"}`);
    check("the locked-chat response echoes the client id", blockedBody?.clientId === blockedId);
    check("the locked-chat response carries a server timestamp", Boolean(blockedBody?.message?.createdAt));

    // --- 7. the client goes away after the request is in flight -------------
    const abandonedId = randomUUID();
    const controller = new AbortController();
    const abandoned = caller
      .post(`/api/chats/${groupId}/messages`, textMessage(abandonedId, "abandoned"), { signal: controller.signal })
      .catch(() => null);
    // Abort the moment the row exists, not on a timer: the point of the
    // scenario is a client that vanishes *after* the commit, and a stopwatch
    // would sometimes abort before it and test nothing.
    const abandonedRow = await (async () => {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const row = await prisma.message.findFirst({ where: { chatId: groupId, clientMessageId: abandonedId } });
        if (row) {
          controller.abort();
          return row;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      controller.abort();
      return null;
    })();
    await abandoned;
    check("a disconnect after the request started does not lose the message", Boolean(abandonedRow));

    // --- 8. the retry after a response nobody received ----------------------
    const retry = await caller.post(`/api/chats/${groupId}/messages`, textMessage(abandonedId, "abandoned"));
    const retryBody = await retry.json().catch(() => null);
    check("the retry is answered, not rejected", retry.status === 200 || retry.status === 201, `status ${retry.status}`);
    check("the retry returns the message that is already committed", retryBody?.message?.id === abandonedRow?.id);
    const retryRows = await prisma.message.count({ where: { chatId: groupId, clientMessageId: abandonedId } });
    check("the retry created nothing", retryRows === 1, `rows=${retryRows}`);

    // --- 9. two identical requests racing each other ------------------------
    const duplicateId = randomUUID();
    const [left, right] = await Promise.all([
      caller.post(`/api/chats/${groupId}/messages`, textMessage(duplicateId, "duplicate")),
      caller.post(`/api/chats/${groupId}/messages`, textMessage(duplicateId, "duplicate")),
    ]);
    check("both racing duplicates are answered", left.status < 400 && right.status < 400, `statuses=${left.status},${right.status}`);
    const duplicateRows = await prisma.message.count({ where: { chatId: groupId, clientMessageId: duplicateId } });
    check("a racing duplicate writes one message", duplicateRows === 1, `rows=${duplicateRows}`);

    // --- 10. an attachment on the same route family -------------------------
    const attachmentId = randomUUID();
    const form = new FormData();
    form.set("file", new Blob([Buffer.from("post-commit attachment")], { type: "image/png" }), "shot.png");
    form.set("clientId", attachmentId);
    const attachment = await caller.postForm(`/api/chats/${groupId}/attachments`, form);
    check("an attachment send is accepted", attachment.status === 201, `status ${attachment.status}`);
    const attachmentRows = await prisma.message.count({ where: { chatId: groupId, clientMessageId: attachmentId } });
    check("the attachment message is committed exactly once", attachmentRows === 1, `rows=${attachmentRows}`);
    const attachmentReplay = await caller.postForm(`/api/chats/${groupId}/attachments`, (() => {
      const again = new FormData();
      again.set("file", new Blob([Buffer.from("post-commit attachment")], { type: "image/png" }), "shot.png");
      again.set("clientId", attachmentId);
      return again;
    })());
    check("an attachment replay is answered", attachmentReplay.status < 400, `status ${attachmentReplay.status}`);
    const attachmentAfterReplay = await prisma.message.count({ where: { chatId: groupId, clientMessageId: attachmentId } });
    check("an attachment replay writes no second message", attachmentAfterReplay === 1, `rows=${attachmentAfterReplay}`);
    const attachmentObjects = await prisma.attachment.count({
      where: { message: { chatId: groupId, clientMessageId: attachmentId } },
    });
    check("an attachment replay writes no second attachment", attachmentObjects === 1, `attachments=${attachmentObjects}`);

    // --- 11. E2EE text, and 12. E2EE attachment -----------------------------
    // Registered devices and envelopes go through the same route branch the
    // browser uses; the ciphertext is opaque to the server, so a fixed string
    // exercises the path exactly as a real envelope does.
    const deviceA = `dev-${randomUUID()}`;
    const deviceB = `dev-${randomUUID()}`;
    for (const [userId, deviceId] of [[aId, deviceA], [bId, deviceB]] as const) {
      await prisma.userDevice.create({
        data: {
          userId,
          deviceId,
          name: "post-commit harness",
          keyBundle: {
            create: {
              userId,
              deviceId,
              publicKey: Buffer.from(`pk-${deviceId}`).toString("base64"),
              algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM",
            },
          },
        },
      });
    }

    const e2eeId = randomUUID();
    const e2ee = await caller.post(`/api/chats/${directId}/messages`, {
      clientId: e2eeId,
      clientMessageId: e2eeId,
      encrypted: true,
      isEncrypted: true,
      encryptionVersion: 2,
      senderDeviceId: deviceA,
      envelopes: [aId, bId].map((recipientUserId) => ({
        recipientUserId,
        recipientDeviceId: recipientUserId === aId ? deviceA : deviceB,
        senderDeviceId: deviceA,
        ciphertext: Buffer.from("ciphertext").toString("base64"),
        iv: "0123456789abcdef0123",
        salt: "0123456789abcdef0123456789abcdef",
        algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM",
        encryptionVersion: 2,
      })),
    });
    check("an E2EE send is accepted", e2ee.status === 201, `status ${e2ee.status}`);
    const e2eeMessage = await prisma.message.findFirst({
      where: { chatId: directId, clientMessageId: e2eeId },
      include: { envelopes: true },
    });
    check("the E2EE message is committed once", Boolean(e2eeMessage));
    check("the E2EE message has one envelope per device", e2eeMessage?.envelopes.length === 2, `envelopes=${e2eeMessage?.envelopes.length ?? 0}`);
    const e2eeBody = await e2ee.clone().json().catch(() => null);
    check("no plaintext body is stored for an E2EE message", e2eeMessage?.body === null);
    check("the E2EE response carries the canonical message", Boolean(e2eeBody?.message?.id));

    const e2eeFileId = randomUUID();
    const e2eeForm = new FormData();
    // The declared type is the plaintext file's type; the bytes are sealed.
    e2eeForm.set("file", new Blob([Buffer.from("sealed bytes")], { type: "image/png" }), "sealed.png");
    e2eeForm.set("clientId", e2eeFileId);
    e2eeForm.set("encrypted", "true");
    e2eeForm.set("senderDeviceId", deviceA);
    e2eeForm.set("fileIv", "0123456789abcdef0123");
    e2eeForm.set("fileAlgorithm", "AES-GCM");
    e2eeForm.set("mediaEncryptionVersion", "1");
    e2eeForm.set("originalSizeBytes", "12");
    e2eeForm.set("mimeType", "image/png");
    e2eeForm.set(
      "mediaKeyEnvelopes",
      JSON.stringify(
        [aId, bId].map((recipientUserId) => ({
          recipientUserId,
          recipientDeviceId: recipientUserId === aId ? deviceA : deviceB,
          senderDeviceId: deviceA,
          encryptedMediaKey: Buffer.from("sealed-key").toString("base64"),
          iv: "0123456789abcdef0123",
          salt: "0123456789abcdef0123456789abcdef",
          // Media keys are sealed with their own algorithm label, not the
          // message-envelope one.
          algorithm: "ECDH-P256-HKDF-SHA256-AES-GCM-MEDIA-KEY",
          encryptionVersion: 1,
        })),
      ),
    );
    const e2eeFile = await caller.postForm(`/api/chats/${directId}/attachments`, e2eeForm);
    check("an E2EE attachment send is accepted", e2eeFile.status === 201,
      `status ${e2eeFile.status} ${e2eeFile.status === 201 ? "" : JSON.stringify(await e2eeFile.clone().json().catch(() => null))}`);
    const e2eeFileRows = await prisma.message.count({ where: { chatId: directId, clientMessageId: e2eeFileId } });
    check("the E2EE attachment is committed exactly once", e2eeFileRows === 1, `rows=${e2eeFileRows}`);

    const beforeFaults = await prisma.message.count({ where: { chatId: groupId } });
    check("no request left a transaction open", (await idleInTransaction(prisma)) === 0);

    await app.stop();

    // --- 5. the socket publish fails after the commit -----------------------
    app = await bootApp(url, { POSTCOMMIT_FAULT_STAGES: "socket-publish" });
    caller = await signIn(app.base, aId, `pca${stamp}`);
    const socketFailId = randomUUID();
    const socketFail = await caller.post(`/api/chats/${groupId}/messages`, textMessage(socketFailId, "socket-publish-fails"));
    const socketFailBody = await socketFail.clone().json().catch(() => null);
    check("a failed socket publish does not fail the send", socketFail.status === 201, `status ${socketFail.status}`);
    check("a failed socket publish still returns the canonical message", Boolean(socketFailBody?.message?.id));
    const socketFailRows = await prisma.message.count({ where: { chatId: groupId, clientMessageId: socketFailId } });
    check("a failed socket publish leaves exactly one message", socketFailRows === 1, `rows=${socketFailRows}`);
    const socketRetry = await caller.post(`/api/chats/${groupId}/messages`, textMessage(socketFailId, "socket-publish-fails"));
    const socketRetryBody = await socketRetry.json().catch(() => null);
    check("retrying after a failed publish returns the same message", socketRetryBody?.message?.id === socketFailBody?.message?.id);
    check("retrying after a failed publish creates no second message",
      (await prisma.message.count({ where: { chatId: groupId, clientMessageId: socketFailId } })) === 1);

    await app.stop();

    // --- 6. the optional notification fails after the commit ----------------
    app = await bootApp(url, { POSTCOMMIT_FAULT_STAGES: "push-notification,chat-bookkeeping" });
    caller = await signIn(app.base, aId, `pca${stamp}`);
    const notifyFailId = randomUUID();
    const notifyFail = await caller.post(`/api/chats/${groupId}/messages`, textMessage(notifyFailId, "notification-fails"));
    const notifyBody = await notifyFail.clone().json().catch(() => null);
    check("a failed notification does not fail the send", notifyFail.status === 201, `status ${notifyFail.status}`);
    check("a failed bookkeeping update does not fail the send", Boolean(notifyBody?.message?.id));
    const notifyRows = await prisma.message.count({ where: { chatId: groupId, clientMessageId: notifyFailId } });
    check("a failed notification leaves exactly one message", notifyRows === 1, `rows=${notifyRows}`);

    // --- what must be true of the whole run ---------------------------------
    const total = await prisma.message.count({ where: { chatId: groupId } });
    check("no scenario wrote a message twice", total === beforeFaults + 2, `rows=${total}`);
    check("no transaction was left open at the end", (await idleInTransaction(prisma)) === 0);

    const p2028 = serverLog.filter((line) => line.includes("P2028"));
    check("no P2028 anywhere in the run", p2028.length === 0, p2028[0]?.slice(0, 160) ?? "");

    const bodies = [blockedBody, retryBody, socketFailBody, notifyBody, e2eeBody];
    const leaked = bodies.filter((body) => JSON.stringify(body ?? {}).match(/P2\d{3}|prisma|Invalid `prisma/i));
    check("no response body carries a driver error", leaked.length === 0, `bodies=${leaked.length}`);
  } finally {
    await app?.stop();
    process.stdout.write = originalWrite;
  }

  console.log(
    failed() === 0
      ? "\nAll post-commit checks passed."
      : `\n${failed()} check(s) failed.`,
  );
  process.exit(failed() === 0 ? 0 : 1);
}

void main();
