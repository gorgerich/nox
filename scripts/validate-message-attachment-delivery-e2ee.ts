/**
 * Encrypted attachments end to end, in two real browsers.
 *   npm run validate:message-attachment-delivery-e2ee
 *
 * The plaintext attachment suite runs in a group conversation, because the
 * upload route refuses unencrypted media in a one-to-one chat. That leaves the
 * path most users actually take — an encrypted photo, voice note or file in a
 * direct conversation — unproven, and it is a *different* cryptographic path:
 * a per-file key, sealed once per recipient device, with the bytes encrypted
 * before they ever reach the server.
 *
 * So: two browser contexts, two devices registered through the app's own flow,
 * production crypto, the production upload route, and a recipient that really
 * decrypts — the check compares the decrypted bytes against what the sender
 * staged, not merely that some metadata came back.
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
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.E2EE_ATTACHMENT_PORT ?? 3997);
const { check, failures } = createChecker();

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type StagedFile = { name: string; mimeType: string; buffer: Buffer };

/** Contents are distinctive so a decrypt can be proven byte for byte. */
function files(stamp: number): Record<string, StagedFile> {
  return {
    photo: { name: "e2ee-photo.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64") },
    document: { name: "e2ee-doc.txt", mimeType: "text/plain", buffer: Buffer.from(`секретный-документ-${stamp}`, "utf8") },
    voice: { name: "voice-e2ee.webm", mimeType: "audio/webm", buffer: Buffer.from(`voice-payload-${stamp}`, "utf8") },
    circle: { name: `video-message-${stamp}.mp4`, mimeType: "video/mp4", buffer: Buffer.from(`circle-payload-${stamp}`, "utf8") },
  };
}

async function waitForDevice(prisma: ReturnType<typeof createPrisma>, userId: string, timeoutMs = 60_000) {
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

/** Paperclip → real file input → the preview's send button. */
async function attach(page: PageLike, file: StagedFile, caption?: string) {
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({ name: file.name, mimeType: file.mimeType, buffer: file.buffer });
  await page.waitForTimeout(700);

  const send = page.getByRole("button", { name: "Отправить вложения" });
  if ((await send.count()) === 0) return;
  if (caption) {
    const captionField = page.getByRole("textbox", { name: "Подпись к вложениям" });
    if ((await captionField.count()) > 0) await captionField.first().fill(caption);
  }
  await send.first().click();
}

/** Reads the IndexedDB stores this work owns. Inlined: no named inner helpers. */
async function localStores(page: PageLike): Promise<{ pending: number; blobs: number }> {
  return page.evaluate(async () => {
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
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const file = files(stamp);
  const aId = randomUUID();
  const bId = randomUUID();
  const aName = `eatta${stamp}`;
  const bName = `eattb${stamp}`;
  const chatId = `eatt-chat-${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, aId, aName);
    await seedUser(prisma, bId, bName);
    await seedChat(prisma, { id: chatId, type: "DIRECT", owner: aId, members: [aId, bId] });

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    const contextA: ContextLike = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const contextB: ContextLike = await browser.newContext({ viewport: { width: 430, height: 900 } });

    const errorsA: string[] = [];
    const errorsB: string[] = [];

    const pageA = await contextA.newPage();
    pageA.on("pageerror", (error: Error) => errorsA.push(error.message.split("\n")[0]));
    await signIn(pageA, app.base, aName);
    await pageA.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });

    const pageB = await contextB.newPage();
    pageB.on("pageerror", (error: Error) => errorsB.push(error.message.split("\n")[0]));
    await signIn(pageB, app.base, bName);
    await pageB.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });

    const deviceA = await waitForDevice(prisma, aId);
    const deviceB = await waitForDevice(prisma, bId);
    check("sender device registers itself", Boolean(deviceA));
    check("recipient device registers itself", Boolean(deviceB));
    if (!deviceA || !deviceB) throw new Error("device registration did not complete — cannot exercise encrypted media");

    const uploads: { status: number }[] = [];
    pageA.on("response", (response) => {
      const request = response.request();
      if (request.method() === "POST" && request.url().includes(`/api/chats/${chatId}/attachments`)) {
        uploads.push({ status: response.status() });
      }
    });

    await pageA.goto(`${app.base}/chats/${chatId}`, { waitUntil: "domcontentloaded" });
    await composerOf(pageA);

    // --- 1 — a photo in a one-to-one conversation ---------------------------
    await attach(pageA, file.photo);
    await pageA.waitForTimeout(8_000);

    let rows = await prisma.message.findMany({
      where: { chatId },
      include: { attachments: { include: { mediaKeyEnvelopes: true } } },
    });
    check("an encrypted photo reaches the server exactly once", rows.length === 1, `rows=${rows.length}`);
    const photoMessage = rows[0];
    check("the photo is stored as an image", photoMessage?.type === "IMAGE", String(photoMessage?.type));
    check("the photo message is marked encrypted", photoMessage?.isEncrypted === true);
    check("the photo carries a client id", Boolean(photoMessage?.clientMessageId));
    check("exactly one attachment row exists", photoMessage?.attachments.length === 1);

    const photoAttachment = photoMessage.attachments[0];
    check("the attachment is marked encrypted", photoAttachment?.isEncrypted === true);
    check("the stored file name does not leak the original", photoAttachment?.fileName === "encrypted-file", String(photoAttachment?.fileName));
    const envelopeDevices = new Set(photoAttachment.mediaKeyEnvelopes.map((envelope) => envelope.recipientDeviceId));
    check("a media key envelope exists for the recipient device", envelopeDevices.has(deviceB));
    check("a media key envelope exists for the sender's own device", envelopeDevices.has(deviceA));
    check("one media key envelope per device", envelopeDevices.size === photoAttachment.mediaKeyEnvelopes.length);
    await pageA.screenshot({ path: join(shots, "e2ee-attachment-sent.png") });

    // --- the server must not hold anything readable -------------------------
    {
      // Scoped to this conversation: the disposable database also holds rows
      // from the plaintext suites, which legitimately have readable bodies.
      const leaked = await prisma.message.count({ where: { chatId, NOT: { body: null } } });
      check("no readable body is stored anywhere in this conversation", leaked === 0, `rows=${leaked}`);
      const keyLooksSealed = photoAttachment.mediaKeyEnvelopes.every(
        (envelope) => Boolean(envelope.encryptedMediaKey) && Boolean(envelope.iv) && Boolean(envelope.salt),
      );
      check("every media key is sealed, with its own iv and salt", keyLooksSealed);
      const distinctKeys = new Set(photoAttachment.mediaKeyEnvelopes.map((envelope) => envelope.encryptedMediaKey));
      check("each device gets its own sealed copy of the key", distinctKeys.size === photoAttachment.mediaKeyEnvelopes.length);
    }

    // --- 2/3/4 — a file, a voice note and a video circle --------------------
    await attach(pageA, file.document);
    await pageA.waitForTimeout(7_000);
    await attach(pageA, file.voice);
    await pageA.waitForTimeout(7_000);
    await attach(pageA, file.circle);
    await pageA.waitForTimeout(7_000);

    rows = await prisma.message.findMany({ where: { chatId }, include: { attachments: { include: { mediaKeyEnvelopes: true } } } });
    check("four encrypted attachments are stored", rows.length === 4, `rows=${rows.length}`);
    check("the document is stored as a file", rows.some((row) => row.type === "FILE"));
    check("the voice note is stored as VOICE", rows.some((row) => row.type === "VOICE"));
    check("the video circle is stored as VIDEO_NOTE", rows.some((row) => row.type === "VIDEO_NOTE"));
    check("every attachment is encrypted", rows.every((row) => row.attachments.every((attachment) => attachment.isEncrypted)));
    check(
      "every attachment has one envelope per device",
      rows.every((row) => row.attachments.every((attachment) => attachment.mediaKeyEnvelopes.length === 2)),
    );

    // --- 5 — caption semantics: an adjacent text message ---------------------
    {
      const caption = `подпись-${stamp}`;
      await attach(pageA, { ...file.photo, name: "captioned.png" }, caption);
      await pageA.waitForTimeout(9_000);

      const afterCaption = await prisma.message.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
        include: { attachments: true },
      });
      check("a captioned upload produces two messages", afterCaption.length === 6, `rows=${afterCaption.length}`);
      const media = afterCaption[afterCaption.length - 2];
      const text = afterCaption[afterCaption.length - 1];
      check("the media message comes first", media.attachments.length === 1);
      check("the caption follows as its own message", text.attachments.length === 0);
      check("the caption message is encrypted like any other text", text.isEncrypted === true);
      check("the caption is not stored in the media message", media.body === null);
      check("media and caption have different client ids", media.clientMessageId !== text.clientMessageId);
      check("the caption is visible to the sender exactly once", (await pageA.getByText(caption, { exact: true }).count()) === 1);
    }

    // --- 12 — the recipient really decrypts ---------------------------------
    await pageB.goto(`${app.base}/chats/${chatId}`, { waitUntil: "domcontentloaded" });
    await pageB.waitForTimeout(12_000);
    await pageB.screenshot({ path: join(shots, "e2ee-attachment-received.png") });

    const documentAttachment = await prisma.attachment.findFirst({
      where: { message: { chatId, type: "FILE" } },
      include: { message: true, mediaKeyEnvelopes: true },
    });
    check("the document attachment is on the server", Boolean(documentAttachment));

    // The app decrypts media with the recipient's own non-extractable device key
    // and hands the result to the page as a blob: URL. Reading those bytes back
    // and comparing them to what the sender staged is the decrypt proof —
    // metadata alone would not show the recipient can read anything.
    const decryptedBytes = await pageB.evaluate(async () => {
      const results: { src: string; text: string }[] = [];
      const nodes = Array.from(document.querySelectorAll("img, audio, video, a[href^='blob:']"));
      for (const node of nodes) {
        const src = (node as HTMLImageElement).src || (node as HTMLAnchorElement).href || "";
        if (!src.startsWith("blob:")) continue;
        const response = await fetch(src);
        const buffer = new Uint8Array(await response.arrayBuffer());
        let text = "";
        for (const byte of buffer) text += String.fromCharCode(byte);
        results.push({ src, text });
      }
      return results;
    });
    check("the recipient holds decrypted media in the page", decryptedBytes.length > 0, `blobs=${decryptedBytes.length}`);

    const expectedPng = PNG_BASE64;
    const decodedMatchesPng = decryptedBytes.some((entry) => {
      try {
        return Buffer.from(entry.text, "binary").toString("base64") === expectedPng;
      } catch {
        return false;
      }
    });
    check("the decrypted image is byte-for-byte what the sender staged", decodedMatchesPng);

    // --- 15 — acknowledgements ----------------------------------------------
    await pageB.waitForTimeout(5_000);
    const ackedEnvelope = await prisma.mediaKeyEnvelope.findFirst({
      where: { attachmentId: photoAttachment.id, recipientDeviceId: deviceB },
    });
    check("the recipient's media key envelope exists after download", Boolean(ackedEnvelope));
    const receipts = await prisma.messageReceipt.findMany({ where: { messageId: photoMessage.id, userId: bId } });
    check("a read receipt is recorded for the recipient", receipts.some((receipt) => receipt.readAt !== null));

    // --- 6/7/9 — a failed upload, a reload, then a retry --------------------
    {
      await contextA.route("**/api/chats/*/attachments", (route) => route.abort());
      await attach(pageA, { ...file.photo, name: "e2ee-retry.png" });
      await pageA.waitForTimeout(8_000);

      const before = await prisma.message.count({ where: { chatId } });
      check("a failed encrypted upload creates no message", before === 6, `rows=${before}`);
      const staged = await localStores(pageA);
      check("a failed encrypted upload keeps its bytes on the device", staged.blobs >= 1, `blobs=${staged.blobs}`);
      check("a failed encrypted upload keeps its pending record", staged.pending >= 1, `pending=${staged.pending}`);
      await pageA.screenshot({ path: join(shots, "e2ee-attachment-failed-retry.png") });

      // 8 — leaving the screen
      await pageA.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
      await pageA.waitForTimeout(1_500);
      await pageA.goto(`${app.base}/chats/${chatId}`, { waitUntil: "domcontentloaded" });
      await pageA.waitForTimeout(3_000);
      const afterLeave = await localStores(pageA);
      check("the pending encrypted attachment survives leaving the screen", afterLeave.blobs >= 1 && afterLeave.pending >= 1);

      // 9 — a reload while it is still owed
      await pageA.reload({ waitUntil: "domcontentloaded" });
      await pageA.waitForTimeout(4_000);
      const afterReload = await localStores(pageA);
      check("the pending encrypted attachment survives a reload", afterReload.blobs >= 1);
      await pageA.screenshot({ path: join(shots, "e2ee-attachment-after-reload.png") });

      // 7 — the retry, which must reuse the client id
      await contextA.unroute("**/api/chats/*/attachments");
      await pageA.reload({ waitUntil: "domcontentloaded" });
      await pageA.waitForTimeout(12_000);
      const after = await prisma.message.count({ where: { chatId } });
      check("the retried encrypted upload is delivered exactly once", after === 7, `rows=${after}`);
      const retried = await prisma.attachment.count({ where: { message: { chatId }, sizeBytes: file.photo.buffer.length } });
      check("the retry produced no duplicate attachment rows", retried <= 3, `matching=${retried}`);

      const settled = await localStores(pageA);
      check("a delivered encrypted attachment releases its staged bytes", settled.blobs === 0, `blobs=${settled.blobs}`);
      check("a delivered encrypted attachment clears its pending record", settled.pending === 0, `pending=${settled.pending}`);
    }

    // --- 10/11 — the server committed but the response was lost -------------
    {
      const target = await prisma.message.findFirst({
        where: { chatId, type: "IMAGE" },
        orderBy: { createdAt: "asc" },
        include: { attachments: true },
      });
      const clientId = target?.clientMessageId as string;
      const before = await prisma.message.count({ where: { chatId } });

      const replayStatus = await pageA.evaluate(
        async ({ chat, cid }) => {
          const form = new FormData();
          form.append("clientId", cid);
          form.append("file", new File([new Uint8Array([9, 9, 9])], "replay.bin", { type: "application/octet-stream" }));
          const response = await fetch(`/api/chats/${chat}/attachments`, { method: "POST", body: form });
          return response.status;
        },
        { chat: chatId, cid: clientId },
      );
      check("a replayed encrypted upload is recognised", replayStatus === 200, `status ${replayStatus}`);
      check("a replayed encrypted upload creates no second message", (await prisma.message.count({ where: { chatId } })) === before);
      const attachments = await prisma.attachment.count({ where: { messageId: target!.id } });
      check("a replayed encrypted upload creates no second attachment", attachments === 1, `attachments=${attachments}`);
      const envelopes = await prisma.mediaKeyEnvelope.count({ where: { attachmentId: target!.attachments[0].id } });
      check("a replayed encrypted upload creates no second envelope set", envelopes === 2, `envelopes=${envelopes}`);

      // 11 — a duplicated socket event for the same message
      await pageA.reload({ waitUntil: "domcontentloaded" });
      await pageA.waitForTimeout(4_000);
      check("a replay leaves the conversation length unchanged", (await prisma.message.count({ where: { chatId } })) === before);
    }

    // --- 13/14 — both sides reload ------------------------------------------
    await pageA.reload({ waitUntil: "domcontentloaded" });
    await pageA.waitForTimeout(5_000);
    const senderStores = await localStores(pageA);
    check("nothing is owed on the sender after a reload", senderStores.pending === 0 && senderStores.blobs === 0);

    await pageB.reload({ waitUntil: "domcontentloaded" });
    await pageB.waitForTimeout(12_000);
    const stillDecrypted = await pageB.evaluate(async () => {
      const nodes = Array.from(document.querySelectorAll("img, audio, video, a[href^='blob:']"));
      return nodes.filter((node) => {
        const src = (node as HTMLImageElement).src || (node as HTMLAnchorElement).href || "";
        return src.startsWith("blob:");
      }).length;
    });
    check("the recipient still decrypts media after a reload", stillDecrypted > 0, `blobs=${stillDecrypted}`);

    // --- final invariants ----------------------------------------------------
    const all = await prisma.message.findMany({ where: { chatId }, include: { attachments: { include: { mediaKeyEnvelopes: true } } } });
    check("every message carries a client id", all.every((row) => Boolean(row.clientMessageId)));
    check("client ids are unique", new Set(all.map((row) => row.clientMessageId)).size === all.length);
    check("no message has two attachment rows", all.every((row) => row.attachments.length <= 1));
    check(
      "no attachment has a duplicate envelope for a device",
      all.every((row) =>
        row.attachments.every(
          (attachment) =>
            new Set(attachment.mediaKeyEnvelopes.map((envelope) => envelope.recipientDeviceId)).size ===
            attachment.mediaKeyEnvelopes.length,
        ),
      ),
    );
    check("every upload request was accepted", uploads.every((upload) => upload.status < 400), JSON.stringify(uploads.map((u) => u.status)));

    // Neither store may ever hold key material.
    const shapes = await pageA.evaluate(async () => {
      const open = indexedDB.open("nox-e2ee");
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      if (!db.objectStoreNames.contains("pending")) return [] as string[];
      const request = db.transaction("pending", "readonly").objectStore("pending").getAll();
      const records: Record<string, unknown>[] = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
      const keys = new Set<string>();
      for (const record of records) for (const key of Object.keys(record)) keys.add(key);
      return [...keys];
    });
    const forbidden = ["privateKey", "key", "mediaKey", "jwk", "iv", "salt", "ciphertext", "token", "deviceId"];
    check("the pending store holds no key material", !shapes.some((key) => forbidden.includes(key)), shapes.join(","));

    check("no page errors on the sender", errorsA.length === 0, errorsA.join(" | "));
    check("no page errors on the recipient", errorsB.length === 0, errorsB.join(" | "));

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
    console.log("\nAll encrypted-attachment delivery checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
