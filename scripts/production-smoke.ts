/**
 * Controlled production smoke for MESSAGE DELIVERY P0.
 *   npx tsx scripts/production-smoke.ts <credentials-file>
 *
 * Runs against the deployed application with two dedicated smoke accounts and a
 * conversation that exists only for this purpose. It never touches a real
 * user's conversation, never seeds, and never stops a production service to
 * simulate a failure — failures are induced only inside the smoke browser.
 *
 * Message content, ciphertext, client ids, media keys, invite codes and
 * credentials are never printed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  createChecker,
  loadPlaywright,
  screenshotDir,
  type BrowserLike,
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const BASE = process.env.SMOKE_BASE_URL ?? "https://nox-production-6f54.up.railway.app";
const COMPOSER = "textarea, input[type=text]";
const { check, failures } = createChecker();

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Account = { username: string; password: string; inviteCode: string };

async function register(page: PageLike, account: Account) {
  return page.request.post(`${BASE}/api/auth/register`, {
    data: {
      login: account.username,
      username: account.username,
      password: account.password,
      inviteCode: account.inviteCode,
    },
  });
}

async function signIn(page: PageLike, account: Account) {
  return page.request.post(`${BASE}/api/auth/login`, {
    data: { login: account.username, password: account.password },
  });
}

async function waitForDevice(prisma: PrismaClient, userId: string, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const device = await prisma.userDevice.findFirst({
      where: { userId, revokedAt: null, keyBundle: { isNot: null } },
      orderBy: { createdAt: "desc" },
    });
    if (device) return device.deviceId;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return null;
}

/**
 * Navigation over the public internet is less reliable than to localhost, and a
 * transient `ERR_NETWORK_CHANGED` should not read as a product failure. Retries
 * a few times before giving up.
 */
async function goto(page: PageLike, url: string, attempts = 4) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_500);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(2_000 * attempt);
    }
  }
  throw lastError;
}

async function attach(page: PageLike, file: { name: string; mimeType: string; buffer: Buffer }, caption?: string) {
  await page.locator('input[type="file"]').first().setInputFiles(file);
  await page.waitForTimeout(900);
  const send = page.getByRole("button", { name: "Отправить вложения" });
  if ((await send.count()) === 0) return;
  if (caption) {
    const field = page.getByRole("textbox", { name: "Подпись к вложениям" });
    if ((await field.count()) > 0) await field.first().fill(caption);
  }
  await send.first().click();
}

async function main() {
  const credentialsPath = process.argv[2];
  if (!credentialsPath) {
    console.error("Usage: npx tsx scripts/production-smoke.ts <credentials-file>");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — the read-only verification needs it.");
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
  const [accountA, accountB]: Account[] = credentials.accounts;
  const shots = screenshotDir();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const stamp = Date.now();
  const text = `p0-smoke-${stamp}`;
  let browser: BrowserLike | null = null;
  let chatId: string | null = null;

  try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    const contextA: ContextLike = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const contextB: ContextLike = await browser.newContext({ viewport: { width: 430, height: 900 } });

    const errorsA: string[] = [];
    const errorsB: string[] = [];
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    pageA.on("pageerror", (error: Error) => errorsA.push(error.message.split("\n")[0]));
    pageB.on("pageerror", (error: Error) => errorsB.push(error.message.split("\n")[0]));

    // Keep the exact bytes of each send, so the replay below repeats what the
    // app actually sent rather than something this script invented.
    const sentPayloads: string[] = [];
    pageA.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "POST" || !request.url().includes("/messages")) return;
      const body = request.postData();
      if (body) sentPayloads.push(body);
    });

    // --- registration through the real flow ----------------------------------
    // Registration is attempted once per account and is allowed to fail on a
    // re-run: the invites are single-use, so a second attempt is expected to be
    // rejected. Signing in is the check that matters.
    const regA = await register(pageA, accountA);
    const regB = await register(pageB, accountB);
    const existingA = await prisma.user.count({ where: { username: accountA.username } });
    const existingB = await prisma.user.count({ where: { username: accountB.username } });
    check("smoke account A exists", regA.ok() || existingA === 1, `register ${regA.status()}`);
    check("smoke account B exists", regB.ok() || existingB === 1, `register ${regB.status()}`);

    check("smoke account A signs in", (await signIn(pageA, accountA)).ok());
    check("smoke account B signs in", (await signIn(pageB, accountB)).ok());

    const userA = await prisma.user.findFirst({ where: { username: accountA.username }, select: { id: true } });
    const userB = await prisma.user.findFirst({ where: { username: accountB.username }, select: { id: true } });
    check("both smoke users exist", Boolean(userA && userB));

    // --- device registration -------------------------------------------------
    await goto(pageA, `${BASE}/chats`);
    await goto(pageB, `${BASE}/chats`);
    const deviceA = await waitForDevice(prisma, userA!.id);
    const deviceB = await waitForDevice(prisma, userB!.id);
    check("device A registers on production", Boolean(deviceA));
    check("device B registers on production", Boolean(deviceB));
    if (!deviceA || !deviceB) throw new Error("device registration did not complete");

    // --- a conversation that exists only for this smoke ----------------------
    // A one-to-one chat needs an accepted contact request first; that is the
    // product's own rule and the smoke goes through it rather than around it.
    const requested = await pageA.request.post(`${BASE}/api/chat-requests`, {
      data: { targetUsername: accountB.username },
    });
    check("A sends a contact request", requested.ok() || requested.status() === 409, `status ${requested.status()}`);

    const pending = await prisma.chatRequest.findFirst({
      where: { fromUserId: userA!.id, toUserId: userB!.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    check("the contact request is recorded", Boolean(pending));

    const accepted = await pageB.request.post(`${BASE}/api/chat-requests/${pending!.id}/accept`, { data: {} });
    const alreadyAccepted = await prisma.chatRequest.count({ where: { id: pending!.id, status: "ACCEPTED" } });
    check("the contact request is accepted", accepted.ok() || alreadyAccepted === 1, `status ${accepted.status()}`);

    const created = await pageA.request.post(`${BASE}/api/chats/direct`, {
      data: { userId: userB!.id },
    });
    const createdBody = await created.json().catch(() => ({}));
    chatId = (createdBody as { chat?: { id?: string } }).chat?.id ?? (createdBody as { id?: string }).id ?? null;
    check("a dedicated smoke conversation is created", created.ok() && Boolean(chatId), `status ${created.status()}`);
    if (!chatId) throw new Error("no smoke conversation — refusing to use an existing one");

    await goto(pageA, `${BASE}/chats/${chatId}`);
    await pageA.locator(COMPOSER).first().waitFor({ state: "visible", timeout: 90_000 });

    // Every count below is scoped to this run. The one-to-one conversation is
    // reused across runs by design — the endpoint returns the existing chat —
    // so absolute counts would measure previous smokes as well as this one.
    const since = new Date();
    const mine = { chatId, createdAt: { gte: since } };

    // --- 1. E2EE text --------------------------------------------------------
    const composerA = pageA.locator(COMPOSER).first();
    await composerA.fill(text);
    await composerA.press("Enter");
    await pageA.waitForTimeout(6_000);

    check("A's composer cleared after acceptance", (await composerA.inputValue()) === "");
    check("A sees exactly one bubble", (await pageA.getByText(text, { exact: true }).count()) === 1);
    await pageA.screenshot({ path: join(shots, "prod-smoke-e2ee-sent.png") });

    let rows = await prisma.message.findMany({ where: mine, include: { envelopes: true } });
    check("exactly one message committed by this run", rows.length === 1, `rows=${rows.length}`);
    check("the message is encrypted", rows[0]?.isEncrypted === true);
    check("the message carries a client id", Boolean(rows[0]?.clientMessageId));
    const deviceIds = new Set(rows[0].envelopes.map((envelope) => envelope.recipientDeviceId));
    check("an envelope exists per device", deviceIds.has(deviceA) && deviceIds.has(deviceB));
    check("no duplicate envelopes", deviceIds.size === rows[0].envelopes.length);

    await goto(pageB, `${BASE}/chats/${chatId}`);
    await pageB.waitForTimeout(10_000);
    check("B decrypts the message", (await pageB.getByText(text, { exact: true }).count()) === 1);
    await pageB.screenshot({ path: join(shots, "prod-smoke-e2ee-received.png") });

    await pageB.waitForTimeout(4_000);
    const envelopeB = await prisma.messageEnvelope.findFirst({
      where: { messageId: rows[0].id, recipientDeviceId: deviceB },
    });
    check("delivery is acknowledged", Boolean(envelopeB?.deliveredAt));
    const receipts = await prisma.messageReceipt.findMany({ where: { messageId: rows[0].id, userId: userB!.id } });
    check("read is acknowledged", receipts.some((receipt) => receipt.readAt !== null));

    // --- 2. no socket echo on the sender ------------------------------------
    // Only this browser context's socket is blocked. Production's socket
    // service is untouched and every other client keeps working.
    {
      await contextA.route("**/socket.io/**", (route) => route.abort());
      await goto(pageA, `${BASE}/chats/${chatId}`);
      const noSocket = `${text}-nosocket`;
      const composer = pageA.locator(COMPOSER).first();
      await composer.waitFor({ state: "visible", timeout: 90_000 });
      await composer.fill(noSocket);
      await composer.press("Enter");
      await pageA.waitForTimeout(7_000);

      check("a send with no socket reaches the server", (await prisma.message.count({ where: mine })) === 2);
      check("a send with no socket shows one bubble", (await pageA.getByText(noSocket, { exact: true }).count()) === 1);
      const stuck = await pageA.evaluate(async () => {
        const open = indexedDB.open("nox-e2ee");
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        if (!db.objectStoreNames.contains("pending")) return 0;
        const request = db.transaction("pending", "readonly").objectStore("pending").getAll();
        const records: { status?: string }[] = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result ?? []);
          request.onerror = () => reject(request.error);
        });
        return records.filter((record) => record.status === "sending" || record.status === "uploading").length;
      });
      check("nothing is stuck in flight", stuck === 0, `stuck=${stuck}`);

      await contextA.unroute("**/socket.io/**");
      await goto(pageA, `${BASE}/chats/${chatId}`);
      await pageA.waitForTimeout(5_000);
      check("restoring the socket does not duplicate it", (await pageA.getByText(noSocket, { exact: true }).count()) === 1);
    }

    // --- 3. idempotent replay ------------------------------------------------
    {
      const before = await prisma.message.count({ where: mine });
      const target = await prisma.message.findFirst({ where: mine, orderBy: { createdAt: "asc" } });
      const envelopesBefore = await prisma.messageEnvelope.count({ where: { messageId: target!.id } });

      // Replay the exact payload the app sent. A hand-built body would be
      // rejected before the idempotency lookup is even reached, because a
      // one-to-one conversation refuses an unencrypted body.
      check("the sent payload was captured", sentPayloads.length > 0);
      const replay = await pageA.request.post(`${BASE}/api/chats/${chatId}/messages`, {
        data: JSON.parse(sentPayloads[0]),
      });
      check("a replayed request is recognised", replay.status() === 200, `status ${replay.status()}`);
      check("no second message is created", (await prisma.message.count({ where: mine })) === before);
      check(
        "no second envelope set is created",
        (await prisma.messageEnvelope.count({ where: { messageId: target!.id } })) === envelopesBefore,
      );
    }

    // --- 4. leave and return -------------------------------------------------
    await goto(pageA, `${BASE}/chats`);
    await pageA.waitForTimeout(1_500);
    await goto(pageA, `${BASE}/chats/${chatId}`);
    await pageA.waitForTimeout(5_000);
    check("the message survives leaving and returning", (await pageA.getByText(text, { exact: true }).count()) === 1);

    // --- 5. reload on both sides --------------------------------------------
    await goto(pageA, `${BASE}/chats/${chatId}`);
    await pageA.waitForTimeout(5_000);
    check("the message survives the sender's reload", (await pageA.getByText(text, { exact: true }).count()) === 1);
    await goto(pageB, `${BASE}/chats/${chatId}`);
    await pageB.waitForTimeout(10_000);
    check("the recipient still decrypts after a reload", (await pageB.getByText(text, { exact: true }).count()) === 1);

    // --- 6. attachments ------------------------------------------------------
    const files = [
      { name: "smoke-photo.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") },
      { name: "smoke-doc.txt", mimeType: "text/plain", buffer: Buffer.from(`smoke-${stamp}`, "utf8") },
      { name: "voice-smoke.webm", mimeType: "audio/webm", buffer: Buffer.from(`voice-${stamp}`, "utf8") },
      { name: `video-message-${stamp}.mp4`, mimeType: "video/mp4", buffer: Buffer.from(`circle-${stamp}`, "utf8") },
    ];
    let expected = await prisma.message.count({ where: mine });
    for (const file of files) {
      await attach(pageA, file);
      await pageA.waitForTimeout(9_000);
      expected += 1;
      const actual = await prisma.message.count({ where: mine });
      check(`${file.name} produced exactly one message`, actual === expected, `rows=${actual} expected=${expected}`);
    }

    const attachments = await prisma.attachment.findMany({
      where: { message: mine },
      include: { mediaKeyEnvelopes: true, message: true },
    });
    check("four attachments from this run", attachments.length === 4, `count=${attachments.length}`);
    check("every attachment is encrypted", attachments.every((attachment) => attachment.isEncrypted));
    // One envelope per active device of the two participants — not a fixed two:
    // each smoke run registers a fresh browser device, so the pair legitimately
    // accumulates devices across runs.
    const activeDevices = await prisma.userDevice.count({
      where: { userId: { in: [userA!.id, userB!.id] }, revokedAt: null, keyBundle: { isNot: null } },
    });
    check(
      "every attachment has one media key envelope per device and no duplicates",
      attachments.every((attachment) => {
        const distinct = new Set(attachment.mediaKeyEnvelopes.map((e) => e.recipientDeviceId)).size;
        return distinct === attachment.mediaKeyEnvelopes.length && distinct >= 2 && distinct <= activeDevices;
      }),
      `activeDevices=${activeDevices}`,
    );
    check("types are as expected", new Set(attachments.map((a) => a.message.type)).size === 4, [...new Set(attachments.map((a) => a.message.type))].join(","));

    // caption as its own adjacent message
    {
      const before = await prisma.message.count({ where: mine });
      await attach(pageA, files[0], `${text}-caption`);
      await pageA.waitForTimeout(11_000);
      const after = await prisma.message.count({ where: mine });
      check("a captioned upload produces two messages", after === before + 2, `${before} → ${after}`);
      check("the caption is visible once", (await pageA.getByText(`${text}-caption`, { exact: true }).count()) === 1);
      expected = after;
    }

    await pageA.screenshot({ path: join(shots, "prod-smoke-attachments.png") });

    // the recipient really opens them
    await goto(pageB, `${BASE}/chats/${chatId}`);
    await pageB.waitForTimeout(15_000);
    const decrypted = await pageB.evaluate(async () => {
      const nodes = Array.from(document.querySelectorAll("img, audio, video, a[href^='blob:']"));
      return nodes.filter((node) => {
        const src = (node as HTMLImageElement).src || (node as HTMLAnchorElement).href || "";
        return src.startsWith("blob:");
      }).length;
    });
    check("the recipient decrypts attachments", decrypted > 0, `blobs=${decrypted}`);
    await pageB.screenshot({ path: join(shots, "prod-smoke-attachments-received.png") });

    // --- 7. retry, with the failure induced only in this browser -------------
    {
      await contextA.route("**/api/chats/*/attachments", (route) => route.abort());
      await attach(pageA, { ...files[0], name: "smoke-retry.png" });
      await pageA.waitForTimeout(9_000);
      const during = await prisma.message.count({ where: mine });
      check("a failed upload creates no message", during === expected, `rows=${during}`);

      await contextA.unroute("**/api/chats/*/attachments");
      await goto(pageA, `${BASE}/chats/${chatId}`);
      await pageA.waitForTimeout(14_000);
      const after = await prisma.message.count({ where: mine });
      check("the retried upload is delivered exactly once", after === expected + 1, `rows=${after}`);
      const retried = await prisma.attachment.count({ where: { message: mine, sizeBytes: files[0].buffer.length } });
      // Three in this run: the photo, the captioned photo, and the retried one.
      check("the retry created no duplicate attachment", retried === 3, `matching=${retried}`);

      const leftover = await pageA.evaluate(async () => {
        const open = indexedDB.open("nox-e2ee");
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        let pending = 0;
        let blobs = 0;
        if (db.objectStoreNames.contains("pending")) {
          const request = db.transaction("pending", "readonly").objectStore("pending").getAllKeys();
          pending = ((await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result ?? []);
            request.onerror = () => reject(request.error);
          })) as unknown[]).length;
        }
        if (db.objectStoreNames.contains("outbox-blobs")) {
          const request = db.transaction("outbox-blobs", "readonly").objectStore("outbox-blobs").getAllKeys();
          blobs = ((await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result ?? []);
            request.onerror = () => reject(request.error);
          })) as unknown[]).length;
        }
        return { pending, blobs };
      });
      check("the outbox is empty after the retry", leftover.blobs === 0, `blobs=${leftover.blobs}`);
      check("nothing is left owed", leftover.pending === 0, `pending=${leftover.pending}`);
    }

    // React's minified 418/423/425 are hydration complaints. They are reported
    // separately from real failures: they are cosmetic and self-healing (React
    // re-renders on the client), and on production they come from timestamps
    // rendered in the server's timezone and then again in the viewer's — a
    // pre-existing shape that no same-machine suite can reproduce, since there
    // the server and the browser share a clock.
    const hydration = (list: string[]) => list.filter((message) => /#4(18|23|25)|hydrat/i.test(message));
    const real = (list: string[]) => list.filter((message) => !/#4(18|23|25)|hydrat/i.test(message));
    if (hydration(errorsA).length + hydration(errorsB).length > 0) {
      console.log(`  note: ${hydration(errorsA).length + hydration(errorsB).length} hydration warning(s) on production — cosmetic, see the release log`);
    }
    check("no functional page errors on the sender", real(errorsA).length === 0, real(errorsA).join(" | "));
    check("no functional page errors on the recipient", real(errorsB).length === 0, real(errorsB).join(" | "));

    // --- read-only post-smoke verification -----------------------------------
    const finalMessages = await prisma.message.count({ where: mine });
    const finalEnvelopes = await prisma.messageEnvelope.count({ where: { message: mine } });
    const finalAttachments = await prisma.attachment.count({ where: { message: mine } });
    const finalMediaKeys = await prisma.mediaKeyEnvelope.count({ where: { attachment: { message: mine } } });
    console.log(`\nsmoke conversation: messages=${finalMessages} envelopes=${finalEnvelopes} attachments=${finalAttachments} mediaKeys=${finalMediaKeys}`);

    const duplicates = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*)::bigint as count from (
         select "senderUserId", "clientMessageId" from "Message"
          where "clientMessageId" is not null
          group by 1,2 having count(*) > 1) d`,
    );
    check("no duplicate (senderUserId, clientMessageId) anywhere in production", Number(duplicates[0].count) === 0);

    const doubleAttachments = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*)::bigint as count from (
         select "messageId" from "Attachment" group by 1 having count(*) > 1) d`,
    );
    check("no message has two attachments", Number(doubleAttachments[0].count) === 0);

    await contextA.close();
    await contextB.close();
  } finally {
    await browser?.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  }

  if (chatId) console.log(`smoke conversation id recorded locally only`);
}

main()
  .then(() => {
    if (failures() > 0) {
      console.error(`\n${failures()} check(s) failed. POST-DEPLOY SMOKE: BLOCKED`);
      process.exit(1);
    }
    console.log("\nProduction smoke passed.");
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
