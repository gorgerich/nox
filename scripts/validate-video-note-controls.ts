import { randomUUID } from "node:crypto";
import {
  createChecker, createPrisma, loadPlaywright, requireIsolatedDatabase,
  seedChat, seedUser, signIn, startApp, type ContextLike,
} from "./lib/browser-harness";

type PermissionContext = ContextLike & {
  grantPermissions(permissions: string[], options: { origin: string }): Promise<void>;
};

async function main() {
  const databaseUrl = await requireIsolatedDatabase();
  const prisma = createPrisma(databaseUrl);
  const { check, failures } = createChecker();
  const stamp = Date.now();
  const me = await seedUser(prisma, randomUUID(), `note${stamp}`);
  const peer = await seedUser(prisma, randomUUID(), `noteto${stamp}`);
  const chatId = await seedChat(prisma, { id: randomUUID(), type: "DIRECT", owner: me.id, members: [me.id, peer.id] });
  const app = await startApp(databaseUrl, 3996);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } }) as PermissionContext;

  try {
    await context.grantPermissions(["microphone", "camera"], { origin: app.base });
    const page = await context.newPage();
    await signIn(page, app.base, me.username);
    await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Режим голосового сообщения. Нажмите, чтобы выбрать видеосообщение" }).click();
    const capture = page.getByRole("button", { name: "Режим видеосообщения. Нажмите, чтобы выбрать голосовое сообщение" });
    const box = await (capture as unknown as { boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null> }).boundingBox();
    if (!box) throw new Error("CAPTURE_BUTTON_MISSING");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(500);
    await page.mouse.up();

    await page.getByRole("dialog", { name: "Запись видеосообщения" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "Отправить видеосообщение" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "Переключить камеру" }).click();
    check("camera switch warns before discarding", await page.getByRole("button", { name: "Начать заново" }).isVisible());
    await page.screenshot({ path: "/tmp/nox-video-note-switch-confirm.png" });
    await page.getByRole("button", { name: "Продолжить запись" }).click();
    check("canceling switch keeps recording", await page.getByRole("button", { name: "Отправить видеосообщение" }).isVisible());
    await page.getByRole("button", { name: "Переключить камеру" }).click();
    await page.getByRole("button", { name: "Начать заново" }).click();
    await page.getByRole("button", { name: "Отправить видеосообщение" }).waitFor({ state: "visible", timeout: 10_000 });
    check("camera switch leaves a usable recorder", await page.getByRole("button", { name: "Отправить видеосообщение" }).isVisible());
    await page.getByRole("button", { name: "Отмена" }).click();
  } finally {
    await context.close();
    await browser.close();
    await app.stop();
    await prisma.$disconnect();
  }

  if (failures()) process.exit(1);
  console.log("VIDEO_NOTE_CONTROLS=PASS");
}

void main();
