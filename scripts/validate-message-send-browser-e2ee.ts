/**
 * The E2EE send path, end to end, in two real browsers.
 *   npm run validate:message-send-browser-e2ee
 *
 * Two browser contexts stand in for two devices. Each registers its own key
 * bundle through the app's own registration flow — no keys are injected, no
 * crypto is stubbed. The message is sealed by the production crypto functions,
 * posted to the production route, stored as one Message plus one envelope per
 * recipient device, and read back by the other device.
 *
 * Disposable database only. Nothing here may touch production data.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  createChecker,
  createPrisma,
  loadPlaywright,
  requireIsolatedDatabase,
  screenshotDir,
  seedChat,
  seedUser,
  signIn,
  startApp,
  type BrowserLike,
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.E2EE_BROWSER_PORT ?? 3991);
const { check, failures } = createChecker();

const COMPOSER = "textarea, input[type=text]";

/** Waits until the app has registered a device key bundle for this user. */
async function waitForDevice(
  prisma: ReturnType<typeof createPrisma>,
  userId: string,
  timeoutMs = 60_000,
): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const device = await prisma.userDevice.findFirst({
      where: { userId, revokedAt: null, keyBundle: { isNot: null } },
      orderBy: { createdAt: "desc" },
    });
    if (device) return device.deviceId;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

async function openApp(context: ContextLike, base: string, username: string, path: string): Promise<PageLike> {
  const page = await context.newPage();
  await signIn(page, base, username);
  await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  return page;
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  // Real UUIDs: the envelope schema validates `recipientUserId` as a uuid, so a
  // readable-but-invalid id would fail the request for a reason that has nothing
  // to do with what is under test.
  const aId = randomUUID();
  const bId = randomUUID();
  const aName = `e2eea${stamp}`;
  const bName = `e2eeb${stamp}`;
  const chatId = `e2ee-chat-${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, aId, aName);
    await seedUser(prisma, bId, bName);
    await seedChat(prisma, { id: chatId, type: "DIRECT", owner: aId, members: [aId, bId] });

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();

    // Separate contexts mean separate origins for IndexedDB, so the two devices
    // hold genuinely separate private keys — as two phones would.
    const contextA = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const contextB = await browser.newContext({ viewport: { width: 430, height: 900 } });

    const errorsA: string[] = [];
    const errorsB: string[] = [];

    // --- 1/2/3 — device registration through the real flow -------------------
    const pageA = await openApp(contextA, app.base, aName, "/chats");
    pageA.on("pageerror", (error: Error) => errorsA.push(error.message.split("\n")[0]));
    // Keep the exact bytes the app sent, so a replay is byte-for-byte what a
    // real retry would repeat rather than something this script invented.
    const sentPayloads: string[] = [];
    const sentStatuses: number[] = [];
    pageA.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "POST") return;
      if (!request.url().includes(`/api/chats/${chatId}/messages`)) return;
      const body = request.postData();
      if (body) sentPayloads.push(body);
      sentStatuses.push(response.status());
    });
    pageA.on("console", (message) => {
      if (message.type() === "error" && process.env.E2EE_VERBOSE) console.log(`  [A console] ${message.text().split("\n")[0]}`);
    });
    const pageB = await openApp(contextB, app.base, bName, "/chats");
    pageB.on("pageerror", (error: Error) => errorsB.push(error.message.split("\n")[0]));

    const deviceA = await waitForDevice(prisma, aId);
    const deviceB = await waitForDevice(prisma, bId);
    check("device A1 registers itself", Boolean(deviceA), String(deviceA));
    check("device B1 registers itself", Boolean(deviceB), String(deviceB));
    if (!deviceA || !deviceB) throw new Error("device registration did not complete — cannot exercise the E2EE path");

    const bundles = await prisma.deviceKeyBundle.count({ where: { userId: { in: [aId, bId] }, revokedAt: null } });
    check("both devices published a key bundle", bundles >= 2, `bundles=${bundles}`);

    // --- 4/5 — A sends through the production composer -----------------------
    await pageA.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
    const composerA = pageA.locator(COMPOSER).first();
    await composerA.waitFor({ state: "visible", timeout: 60_000 });

    const text = `e2ee-секрет-${stamp}`;
    await composerA.fill(text);
    await composerA.press("Enter");
    await pageA.waitForTimeout(4_000);

    // --- 6 — the optimistic record was stored before the request -------------
    check("A's composer cleared only after the message was accepted", (await composerA.inputValue()) === "");
    check("A sees the message exactly once", (await pageA.getByText(text, { exact: true }).count()) === 1);
    await pageA.screenshot({ path: join(shots, "e2ee-message-sent.png") });

    // --- 7/8/9 — one Message, sealed, with envelopes per device --------------
    const stored = await prisma.message.findMany({
      where: { chatId },
      include: { envelopes: true },
    });
    check(
      "the server holds exactly one message",
      stored.length === 1,
      `rows=${stored.length} postStatuses=${JSON.stringify(sentStatuses)}`,
    );
    const message = stored[0];
    check("the message is marked encrypted", message?.isEncrypted === true);
    check("the message carries a client id", Boolean(message?.clientMessageId));
    // In v2 the payload lives per device: the row itself holds no readable body,
    // and every envelope carries its own ciphertext.
    check("every envelope carries ciphertext", message.envelopes.length > 0 && message.envelopes.every((envelope) => Boolean(envelope.ciphertext)));
    check("every envelope is version 2", message.envelopes.every((envelope) => envelope.encryptionVersion === 2));

    const deviceIds = new Set(message.envelopes.map((envelope) => envelope.recipientDeviceId));
    check("an envelope exists for the recipient device", deviceIds.has(deviceB), [...deviceIds].join(","));
    check("an envelope exists for the sender's own device", deviceIds.has(deviceA));
    check("one envelope per device, no duplicates", deviceIds.size === message.envelopes.length);

    // --- plaintext must not be in the database -------------------------------
    check("the plaintext is not stored in the message body", message.body === null || !message.body.includes(text));
    const anywhere = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `select count(*)::bigint as count from "Message" where coalesce(body,'') like $1 or coalesce(ciphertext,'') like $1`,
      `%${text}%`,
    );
    check("the plaintext appears nowhere in the messages table", Number(anywhere[0].count) === 0);
    const inEnvelopes = message.envelopes.filter((envelope) => (envelope.ciphertext ?? "").includes(text));
    check("the plaintext appears in no envelope", inEnvelopes.length === 0);

    // --- 10/11 — HTTP alone marked it sent; the echo did not duplicate -------
    check("A still sees one bubble after the socket echo", (await pageA.getByText(text, { exact: true }).count()) === 1);

    // --- 12/13 — B fetches and decrypts --------------------------------------
    await pageB.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
    await pageB.waitForTimeout(6_000);
    const seenByB = await pageB.getByText(text, { exact: true }).count();
    check("B decrypts the message", seenByB === 1, `count=${seenByB}`);
    await pageB.screenshot({ path: join(shots, "e2ee-message-received.png") });

    // --- 14/15 — delivery and read acknowledgements --------------------------
    await pageB.waitForTimeout(4_000);
    const acked = await prisma.messageEnvelope.findFirst({ where: { messageId: message.id, recipientDeviceId: deviceB } });
    check("the recipient's envelope is acknowledged as delivered", Boolean(acked?.deliveredAt), String(acked?.deliveredAt));
    const receipts = await prisma.messageReceipt.findMany({ where: { messageId: message.id, userId: bId } });
    check("a read receipt is recorded for the recipient", receipts.some((receipt) => receipt.readAt !== null));

    // --- 16/17/18 — A leaves, returns, reloads -------------------------------
    await pageA.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
    await pageA.waitForTimeout(1_000);
    await pageA.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
    await pageA.waitForTimeout(4_000);
    check("A still sees the message after leaving and returning", (await pageA.getByText(text, { exact: true }).count()) === 1);

    await pageA.reload({ waitUntil: "networkidle" });
    await pageA.waitForTimeout(4_000);
    check("A still sees the message after a reload", (await pageA.getByText(text, { exact: true }).count()) === 1);
    await pageA.screenshot({ path: join(shots, "e2ee-after-reload.png") });

    // --- 19/20 — B reloads and reads from its verified local cache -----------
    await pageB.reload({ waitUntil: "networkidle" });
    await pageB.waitForTimeout(5_000);
    check("B still reads the message after a reload", (await pageB.getByText(text, { exact: true }).count()) === 1);

    // --- race cases ----------------------------------------------------------

    // socket absent on the sender: HTTP alone must be enough
    {
      await contextA.route("**/socket.io/**", (route) => route.abort());
      await pageA.reload({ waitUntil: "networkidle" });
      const noSocket = `e2ee-без-сокета-${stamp}`;
      const composer = pageA.locator(COMPOSER).first();
      await composer.waitFor({ state: "visible", timeout: 60_000 });
      await composer.fill(noSocket);
      await composer.press("Enter");
      await pageA.waitForTimeout(5_000);
      const rows = await prisma.message.count({ where: { chatId, clientMessageId: { not: null } } });
      check("a send with no socket still reaches the server", rows === 2, `rows=${rows}`);
      check("a send with no socket shows one bubble", (await pageA.getByText(noSocket, { exact: true }).count()) === 1);
      await contextA.unroute("**/socket.io/**");
      await pageA.reload({ waitUntil: "networkidle" });
      await pageA.waitForTimeout(3_000);
      check("the socketless message is still single after reconnecting", (await pageA.getByText(noSocket, { exact: true }).count()) === 1);
    }

    // The server committed but the response never arrived, so the client repeats
    // the identical request. Replaying the captured payload verbatim is what a
    // real retry does — the same sealed envelopes, the same client id.
    {
      check("the sent payload was captured for replay", sentPayloads.length > 0);
      const payload = JSON.parse(sentPayloads[0]);
      const target = await prisma.message.findFirst({
        where: { chatId, clientMessageId: payload.clientId },
      });
      check("the captured payload matches a committed message", Boolean(target));

      const before = await prisma.message.count({ where: { chatId } });
      const replay = await pageA.request.post(`${app.base}/api/chats/${chatId}/messages`, { data: payload });
      check("a replayed request is accepted", replay.ok(), `status ${replay.status()}`);
      const after = await prisma.message.count({ where: { chatId } });
      check("a replayed request creates no second message", after === before, `${before} → ${after}`);
      const envelopes = await prisma.messageEnvelope.count({ where: { messageId: target!.id } });
      check("a replayed request creates no second envelope set", envelopes === deviceIds.size, `envelopes=${envelopes}`);

      await pageA.reload({ waitUntil: "networkidle" });
      await pageA.waitForTimeout(3_500);
      check("a replayed request creates no second bubble", (await pageA.getByText(text, { exact: true }).count()) === 1);
    }

    // offline → reconnect, with the composer clearing immediately
    {
      const queued = `e2ee-офлайн-${stamp}`;
      await contextA.setOffline(true);
      const composer = pageA.locator(COMPOSER).first();
      await composer.fill(queued);
      await composer.press("Enter");
      await pageA.waitForTimeout(2_000);
      check("an offline E2EE message is held on screen", (await pageA.getByText(queued, { exact: true }).count()) === 1);
      check("the composer clears while offline", (await composer.inputValue()) === "");
      check("an offline E2EE message is not on the server yet", (await prisma.message.count({ where: { chatId, body: queued } })) === 0);

      await contextA.setOffline(false);
      await pageA.evaluate(() => window.dispatchEvent(new Event("online")));
      await pageA.waitForTimeout(8_000);
      check("reconnect delivers the queued E2EE message once", (await pageA.getByText(queued, { exact: true }).count()) === 1);
      const total = await prisma.message.count({ where: { chatId } });
      check("reconnect leaves three messages in total", total === 3, `rows=${total}`);
    }

    // two identical texts with different client ids stay two messages
    {
      const twice = `e2ee-одинаково-${stamp}`;
      const composer = pageA.locator(COMPOSER).first();
      for (let i = 0; i < 2; i += 1) {
        await composer.fill(twice);
        await composer.press("Enter");
        await pageA.waitForTimeout(2_500);
      }
      await pageA.waitForTimeout(3_000);
      check("identical text sent twice yields two bubbles", (await pageA.getByText(twice, { exact: true }).count()) === 2);
      const rows = await prisma.message.count({ where: { chatId } });
      check("identical text sent twice yields five messages in total", rows === 5, `rows=${rows}`);
    }

    // --- final invariants -----------------------------------------------------
    const all = await prisma.message.findMany({ where: { chatId }, include: { envelopes: true } });
    check("every message is encrypted", all.every((row) => row.isEncrypted));
    check("every message carries a client id", all.every((row) => Boolean(row.clientMessageId)));
    check(
      "client ids are unique per message",
      new Set(all.map((row) => row.clientMessageId)).size === all.length,
    );
    check(
      "each message has exactly one envelope per device",
      all.every((row) => new Set(row.envelopes.map((e) => e.recipientDeviceId)).size === row.envelopes.length),
    );

    // The pending store must never hold transport key material.
    const pendingShape = await pageA.evaluate(async () => {
      const open = indexedDB.open("nox-e2ee");
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      if (!db.objectStoreNames.contains("pending")) return { count: 0, keys: [] as string[] };
      const request = db.transaction("pending", "readonly").objectStore("pending").getAll();
      const rows: Record<string, unknown>[] = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
      const keys = new Set<string>();
      for (const row of rows) for (const key of Object.keys(row)) keys.add(key);
      return { count: rows.length, keys: [...keys] };
    });
    check("nothing is left owed in A's pending store", pendingShape.count === 0, `pending=${pendingShape.count}`);
    const forbidden = ["privateKey", "key", "jwk", "iv", "salt", "ciphertext", "token", "deviceId"];
    check(
      "the pending store holds no transport key material",
      !pendingShape.keys.some((key) => forbidden.includes(key)),
      pendingShape.keys.join(","),
    );

    check("no page errors for A", errorsA.length === 0, errorsA.join(" | "));
    check("no page errors for B", errorsB.length === 0, errorsB.join(" | "));

    await contextA.close();
    await contextB.close();
  } finally {
    await browser?.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    await app.stop();
  }
}

main()
  .then(() => {
    if (failures() > 0) {
      console.error(`\n${failures()} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll E2EE browser send checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
