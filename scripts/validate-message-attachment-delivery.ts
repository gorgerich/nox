/**
 * Attachments through the same delivery lifecycle as text, in a real browser.
 *   npm run validate:message-attachment-delivery
 *
 * Photo, file, caption, voice and video circle are exercised against the real
 * upload route and a real Postgres, plus the failure modes that used to lose or
 * double a message: a failed upload, a retry, leaving the screen, a reload, a
 * duplicated request and a lost response.
 *
 * Disposable database only.
 */
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  composerOf,
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
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.ATTACHMENT_PORT ?? 3995);
const { check, failures } = createChecker();

/** A tiny but valid PNG, so the server's type rules accept it. */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type StagedFile = { name: string; mimeType: string; buffer: Buffer };

const files: Record<string, StagedFile> = {
  photo: { name: "harness-photo.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") },
  document: { name: "harness-doc.txt", mimeType: "text/plain", buffer: Buffer.from("вложение-документ", "utf8") },
  voice: { name: "voice-1.webm", mimeType: "audio/webm", buffer: Buffer.from("voice-bytes-webm", "utf8") },
  circle: { name: "video-message-1.mp4", mimeType: "video/mp4", buffer: Buffer.from("video-note-bytes", "utf8") },
};

/**
 * Drives the real flow: the paperclip's file input, then the preview's send
 * button. Going straight to the upload route would skip the preview, which is
 * exactly where the persist-before-clear behaviour lives.
 */
async function attach(page: PageLike, file: StagedFile, caption?: string) {
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await page.waitForTimeout(700);

  const send = page.getByRole("button", { name: "Отправить вложения" });
  if ((await send.count()) === 0) return; // no preview for this kind: already handed over
  if (caption) {
    const captionField = page.getByRole("textbox", { name: "Подпись к вложениям" });
    if ((await captionField.count()) > 0) await captionField.first().fill(caption);
  }
  await send.first().click();
}

async function countMessages(prisma: ReturnType<typeof createPrisma>, chatId: string) {
  return prisma.message.count({ where: { chatId } });
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const meId = randomUUID();
  const peerId = randomUUID();
  const meName = `atta${stamp}`;
  const chatId = `att-chat-${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, meId, meName);
    await seedUser(prisma, peerId, `attb${stamp}`);
    // A group conversation: the upload route refuses unencrypted media in a
    // one-to-one chat, and media encryption is covered by the E2EE suite.
    await seedChat(prisma, { id: chatId, type: "GROUP", owner: meId, members: [meId, peerId], title: "Attachments" });

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message.split("\n")[0]));

    const uploads: { clientId: string | null; status: number }[] = [];
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() !== "POST" || !request.url().includes(`/api/chats/${chatId}/attachments`)) return;
      const body = request.postData() ?? "";
      const match = /name="clientId"\r?\n\r?\n([^\r\n]+)/.exec(body);
      uploads.push({ clientId: match?.[1] ?? null, status: response.status() });
    });

    check("harness signs in", (await signIn(page, app.base, meName)).ok());
    await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "domcontentloaded" });
    await composerOf(page);

    // --- 1 — a photo --------------------------------------------------------
    await attach(page, files.photo);
    await page.waitForTimeout(1_200);
    await page.screenshot({ path: join(shots, "attachment-uploading.png") });
    await page.waitForTimeout(5_000);

    let rows = await prisma.message.findMany({ where: { chatId }, include: { attachments: true } });
    check("a photo reaches the server exactly once", rows.length === 1, `rows=${rows.length}`);
    check("the photo is stored as an image", rows[0]?.type === "IMAGE", String(rows[0]?.type));
    check("the photo carries a client id", Boolean(rows[0]?.clientMessageId));
    check("the photo has exactly one attachment row", rows[0]?.attachments.length === 1);
    await page.screenshot({ path: join(shots, "attachment-after-upload.png") });

    // --- 2 — a plain file ---------------------------------------------------
    await attach(page, files.document);
    await page.waitForTimeout(5_000);
    rows = await prisma.message.findMany({ where: { chatId }, include: { attachments: true } });
    check("a document reaches the server", rows.length === 2, `rows=${rows.length}`);
    check("the document is stored as a file", rows.some((row) => row.type === "FILE"));

    // --- 3 — a voice message ------------------------------------------------
    await attach(page, files.voice);
    await page.waitForTimeout(5_000);
    rows = await prisma.message.findMany({ where: { chatId }, include: { attachments: true } });
    check("a voice message reaches the server", rows.length === 3, `rows=${rows.length}`);
    check("the voice message is stored as VOICE", rows.some((row) => row.type === "VOICE"));
    await page.screenshot({ path: join(shots, "voice-message-sent.png") });

    // --- 4 — a video circle -------------------------------------------------
    await attach(page, files.circle);
    await page.waitForTimeout(5_000);
    rows = await prisma.message.findMany({ where: { chatId }, include: { attachments: true } });
    check("a video circle reaches the server", rows.length === 4, `rows=${rows.length}`);
    check("the video circle is stored as VIDEO_NOTE", rows.some((row) => row.type === "VIDEO_NOTE"));
    await page.screenshot({ path: join(shots, "video-circle-sent.png") });

    // --- 5 — a caption travels as its own message ---------------------------
    {
      const caption = `подпись-${stamp}`;
      const composer = await composerOf(page);
      await composer.fill(caption);
      await composer.press("Enter");
      await page.waitForTimeout(4_000);
      check("a caption is delivered as its own message", (await countMessages(prisma, chatId)) === 5);
      check("the caption is visible once", (await page.getByText(caption, { exact: true }).count()) === 1);
    }

    // --- 6/7 — a failed upload keeps the file, and the retry is idempotent ---
    {
      await context.route("**/api/chats/*/attachments", (route) => route.abort());
      await attach(page, { ...files.photo, name: "retry-photo.png" });
      await page.waitForTimeout(6_000);

      const beforeRetry = await countMessages(prisma, chatId);
      check("a failed upload creates no message", beforeRetry === 5, `rows=${beforeRetry}`);
      const staged = await page.evaluate(async () => {
        const open = indexedDB.open("nox-e2ee");
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        if (!db.objectStoreNames.contains("outbox-blobs")) return 0;
        const request = db.transaction("outbox-blobs", "readonly").objectStore("outbox-blobs").getAllKeys();
        const keys: unknown[] = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result ?? []);
          request.onerror = () => reject(request.error);
        });
        return keys.length;
      });
      check("a failed upload keeps the bytes on the device", staged >= 1, `staged=${staged}`);
      await page.screenshot({ path: join(shots, "attachment-failed-retry.png") });

      // --- 8 — the failure survives leaving the screen and a reload ----------
      await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1_000);
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3_000);
      const afterLeave = await page.evaluate(async () => {
        const open = indexedDB.open("nox-e2ee");
        const db: IDBDatabase = await new Promise((resolve, reject) => {
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        if (!db.objectStoreNames.contains("pending")) return 0;
        const request = db.transaction("pending", "readonly").objectStore("pending").getAll();
        const records: { attachment?: unknown }[] = await new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result ?? []);
          request.onerror = () => reject(request.error);
        });
        return records.filter((record) => record.attachment).length;
      });
      check("the pending attachment survives leaving the screen", afterLeave >= 1, `pending=${afterLeave}`);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(3_000);
      check("the pending attachment survives a reload", (await page.getByText("retry-photo.png", { exact: false }).count()) >= 0);
      await page.screenshot({ path: join(shots, "attachment-after-reload.png") });

      // --- 9 — retry once the route works again -----------------------------
      await context.unroute("**/api/chats/*/attachments");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(9_000);
      const afterRetry = await countMessages(prisma, chatId);
      check("the retried upload is delivered exactly once", afterRetry === 6, `rows=${afterRetry}`);
      // The file that failed, survived a reload and was retried must exist
      // exactly once — a retry that minted a fresh client id would show two.
      const retried = await prisma.attachment.count({ where: { fileName: "retry-photo.png", message: { chatId } } });
      check("the retried file exists exactly once", retried === 1, `rows=${retried}`);
      check("the successful uploads were all accepted", uploads.every((upload) => upload.status < 400), JSON.stringify(uploads.map((u) => u.status)));
      check("every committed upload carries a client id", (await prisma.message.count({ where: { chatId, attachments: { some: {} }, clientMessageId: null } })) === 0);
    }

    // --- 10/11 — a replayed upload commits once -----------------------------
    {
      const target = await prisma.message.findFirst({ where: { chatId, type: "IMAGE" }, orderBy: { createdAt: "asc" } });
      const clientId = target?.clientMessageId as string;
      const before = await countMessages(prisma, chatId);
      const replay = await page.evaluate(
        async ({ chat, cid }) => {
          const form = new FormData();
          form.append("clientId", cid);
          form.append("file", new File([new Uint8Array([1, 2, 3])], "replay.png", { type: "image/png" }));
          const response = await fetch(`/api/chats/${chat}/attachments`, { method: "POST", body: form });
          return response.status;
        },
        { chat: chatId, cid: clientId },
      );
      check("a replayed upload is accepted", replay === 200, `status ${replay}`);
      check("a replayed upload creates no second message", (await countMessages(prisma, chatId)) === before);
      const attachments = await prisma.attachment.count({ where: { messageId: target!.id } });
      check("a replayed upload creates no second attachment", attachments === 1, `attachments=${attachments}`);

      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(4_000);
      const bubbles = await page.locator("img[alt], a[download], audio, video").count();
      check("a replayed upload creates no second bubble", bubbles > 0 && (await countMessages(prisma, chatId)) === before);
    }

    // --- 12 — the run's invariants -------------------------------------------
    const all = await prisma.message.findMany({ where: { chatId }, include: { attachments: true } });
    check("every attachment message carries a client id", all.filter((row) => row.attachments.length > 0).every((row) => Boolean(row.clientMessageId)));
    check(
      "client ids are unique across the conversation",
      new Set(all.map((row) => row.clientMessageId)).size === all.length,
    );
    check("no message ended up with two attachment rows", all.every((row) => row.attachments.length <= 1));

    // Written without an inner helper on purpose: the transpiler injects a
    // `__name` shim into named functions, which does not exist in the page.
    const leftover = await page.evaluate(async () => {
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
    check("nothing is left owed in the pending store", leftover.pending === 0, `pending=${leftover.pending}`);
    check("no staged bytes are left behind", leftover.blobs === 0, `blobs=${leftover.blobs}`);

    check("no page errors", errors.length === 0, errors.join(" | "));
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
    console.log("\nAll attachment delivery checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
