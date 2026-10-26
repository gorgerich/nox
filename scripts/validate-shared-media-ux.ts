import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { saveObject } from "../src/lib/storage";
import {
  createChecker, createPrisma, loadPlaywright, requireIsolatedDatabase,
  COMPOSER_SELECTOR, seedChat, seedUser, signIn, startApp, type PageLike,
} from "./lib/browser-harness";

const PORT = 3995;

async function main() {
  const databaseUrl = await requireIsolatedDatabase();
  const uploadDir = mkdtempSync(join(tmpdir(), "nox-shared-media-"));
  process.env.UPLOAD_DIR = uploadDir;
  const prisma = createPrisma(databaseUrl);
  const { check, failures } = createChecker();
  const stamp = Date.now();
  const me = await seedUser(prisma, randomUUID(), `shared${stamp}`);
  const peer = await seedUser(prisma, randomUUID(), `peer${stamp}`);
  const direct = await seedChat(prisma, { id: randomUUID(), type: "DIRECT", owner: me.id, members: [me.id, peer.id] });
  const group = await seedChat(prisma, { id: randomUUID(), type: "GROUP", owner: me.id, members: [me.id, peer.id], title: "Shared media test" });

  async function attach(chatId: string, type: "IMAGE" | "FILE" | "VOICE", fileName: string, mimeType: string, bytes: Buffer) {
    const message = await prisma.message.create({ data: { chatId, senderUserId: peer.id, type } });
    const { storageKey } = await saveObject(bytes);
    return prisma.attachment.create({ data: {
      messageId: message.id, uploaderUserId: peer.id, storageKey, fileName, mimeType, sizeBytes: bytes.length,
    } });
  }

  const photo = await attach(group, "IMAGE", "photo.png", "image/png", readFileSync("public/apple-touch-icon.png"));
  await attach(group, "FILE", "report.txt", "text/plain", Buffer.from("group report"));
  await attach(group, "VOICE", "voice.ogg", "audio/ogg", Buffer.from("voice fixture"));
  await attach(direct, "FILE", "direct.txt", "text/plain", Buffer.from("direct report"));
  const bubbleFile = await attach(direct, "FILE", "bubble.txt", "text/plain", Buffer.from("chat file fixture"));

  const app = await startApp(databaseUrl, PORT, { UPLOAD_DIR: uploadDir });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });

  try {
    const page: PageLike = await context.newPage();
    await signIn(page, app.base, me.username);
    let failFirstImage = true;
    await context.route(`**/api/attachments/${photo.id}/download`, async (route) => {
      if (failFirstImage) { failFirstImage = false; await route.abort(); }
      else await route.continue();
    });
    let failFirstSharedList = true;
    await context.route(`**/api/chats/${group}/shared`, async (route) => {
      if (failFirstSharedList) { failFirstSharedList = false; await route.abort(); }
      else await route.continue();
    });
    await page.goto(`${app.base}/chats/${group}/group-profile`, { waitUntil: "networkidle" });
    const retryList = page.getByRole("button", { name: /^Повторить$/ });
    await retryList.waitFor({ state: "visible", timeout: 10_000 });
    await retryList.click();
    const retry = page.getByRole("button", { name: "Повторить загрузку медиа" });
    await retry.waitFor({ state: "visible", timeout: 10_000 });
    check("shared list error has a working retry", await retry.isVisible());
    await retry.click();
    await page.waitForFunction(() => {
      const image = document.querySelector('img[src*="/api/attachments/"]') as HTMLImageElement | null;
      return Boolean(image?.complete && image.naturalWidth > 0);
    }, { timeout: 10_000 });
    check("shared image retry reloads the source", true);

    await page.getByRole("button", { name: "Файлы" }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/nox-shared-group-files.png" });
    check("audio appears in files", await page.getByRole("button", { name: "Скачать voice.ogg" }).isVisible());
    check("file action is not a dead link", await page.getByRole("button", { name: "Скачать report.txt" }).isVisible());
    const groupDownload = await Promise.all([
      (page as unknown as { waitForEvent(name: string): Promise<{ suggestedFilename(): string }> }).waitForEvent("download"),
      page.getByRole("button", { name: "Скачать report.txt" }).click(),
    ]);
    check("group file downloads", groupDownload[0].suggestedFilename() === "report.txt");

    await page.goto(`${app.base}/chats/${direct}/profile`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Файлы" }).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: "/tmp/nox-shared-direct-files.png" });
    const directDownload = await Promise.all([
      (page as unknown as { waitForEvent(name: string): Promise<{ suggestedFilename(): string }> }).waitForEvent("download"),
      page.getByRole("button", { name: "Скачать direct.txt" }).click(),
    ]);
    check("direct file downloads", directDownload[0].suggestedFilename() === "direct.txt");

    let failFirstBubbleFile = true;
    await context.route(`**/api/attachments/${bubbleFile.id}/download`, async (route) => {
      if (failFirstBubbleFile) { failFirstBubbleFile = false; await route.abort(); }
      else await route.continue();
    });
    await page.goto(`${app.base}/chats/${direct}`, { waitUntil: "networkidle" });
    await page.locator(COMPOSER_SELECTOR).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "Скачать файл bubble.txt" }).click();
    await page.waitForTimeout(700);
    const retryBubbleFile = page.getByRole("button", { name: "Повторить скачивание bubble.txt" });
    await retryBubbleFile.waitFor({ state: "visible", timeout: 10_000 });
    check("failed chat file shows retry", await retryBubbleFile.isVisible());
    const bubbleDownload = await Promise.all([
      (page as unknown as { waitForEvent(name: string): Promise<{ suggestedFilename(): string }> }).waitForEvent("download"),
      retryBubbleFile.click(),
    ]);
    check("chat file retries a valid download", bubbleDownload[0].suggestedFilename() === "bubble.txt");

  } finally {
    await context.close();
    await browser.close();
    await app.stop();
    await prisma.$disconnect();
    rmSync(uploadDir, { recursive: true, force: true });
  }

  if (failures()) process.exit(1);
  console.log("SHARED_MEDIA_UX=PASS");
}

void main();
