import { randomUUID } from "node:crypto";
import {
  createChecker,
  createPrisma,
  loadPlaywright,
  requireIsolatedDatabase,
  seedChat,
  seedUser,
  signIn,
  startApp,
  type ContextLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.CALL_UI_PORT ?? 3994);

type PermissionContext = ContextLike & {
  grantPermissions(permissions: string[], options: { origin: string }): Promise<void>;
};

type OverlayGeometry = {
  top: number;
  bottom: number;
  height: number;
  viewportHeight: number;
  localVideoCount: number;
  localVideoZ: string | null;
  controlsZ: string | null;
  controlsBottom: number | null;
};

async function readOverlayGeometry(page: Awaited<ReturnType<ContextLike["newPage"]>>): Promise<OverlayGeometry> {
  return page.evaluate(`(() => {
    const overlay = document.querySelector('[data-call-overlay="true"]');
    if (!overlay) throw new Error('CALL_OVERLAY_MISSING');
    const rect = overlay.getBoundingClientRect();
    const localVideo = overlay.querySelector('[data-call-local-video="true"]');
    const controls = overlay.querySelector('[data-call-controls="true"]');
    const controlsRect = controls ? controls.getBoundingClientRect() : null;
    return {
      top: rect.top,
      bottom: rect.bottom,
      height: rect.height,
      viewportHeight: window.visualViewport?.height ?? window.innerHeight,
      localVideoCount: localVideo ? 1 : 0,
      localVideoZ: localVideo ? getComputedStyle(localVideo).zIndex : null,
      controlsZ: controls ? getComputedStyle(controls).zIndex : null,
      controlsBottom: controlsRect?.bottom ?? null,
    };
  })()`);
}

async function main() {
  const databaseUrl = await requireIsolatedDatabase();
  const prisma = createPrisma(databaseUrl);
  const { check, failures } = createChecker();
  const stamp = Date.now();
  const caller = await seedUser(prisma, randomUUID(), `callui${stamp}`);
  const callee = await seedUser(prisma, randomUUID(), `callpeer${stamp}`);
  const chatId = await seedChat(prisma, {
    id: randomUUID(),
    type: "DIRECT",
    owner: caller.id,
    members: [caller.id, callee.id],
  });

  const app = await startApp(databaseUrl, PORT);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const callerContext = await browser.newContext({ viewport: { width: 390, height: 844 } }) as PermissionContext;
  const calleeContext = await browser.newContext({ viewport: { width: 390, height: 844 } }) as PermissionContext;

  try {
    await callerContext.grantPermissions(["microphone", "camera"], { origin: app.base });
    await calleeContext.grantPermissions(["microphone", "camera"], { origin: app.base });
    const callerPage = await callerContext.newPage();
    const calleePage = await calleeContext.newPage();
    await signIn(callerPage, app.base, caller.username);
    await signIn(calleePage, app.base, callee.username);
    await calleePage.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
    await callerPage.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
    await callerPage.waitForTimeout(600);

    await callerPage.getByRole("button", { name: "Аудиозвонок" }).click();
    await callerPage.locator('[data-call-overlay="true"]').waitFor({ state: "visible", timeout: 10_000 });
    await calleePage.getByRole("button", { name: "Принять звонок" }).click();
    await callerPage.waitForTimeout(1500);
    check("duplicate audio invite does not end the call", await callerPage.locator('[data-call-overlay="true"]').isVisible());
    const audio = await readOverlayGeometry(callerPage);
    check("audio overlay starts at viewport top", Math.abs(audio.top) < 1, `top=${audio.top}`);
    check("audio overlay fills visual viewport", Math.abs(audio.height - audio.viewportHeight) < 2, `height=${audio.height}, viewport=${audio.viewportHeight}`);
    check("audio call has no camera layer", audio.localVideoCount === 0, `layers=${audio.localVideoCount}`);
    check("audio controls stay visible", await callerPage.getByRole("button", { name: "Микрофон" }).isVisible());
    check("audio end control stays visible", await callerPage.getByRole("button", { name: "Завершить звонок" }).isVisible());
    check("audio controls remain inside viewport", audio.controlsBottom !== null && audio.controlsBottom <= audio.viewportHeight + 1, `bottom=${audio.controlsBottom}`);
    await callerPage.screenshot({ path: "/tmp/nox-call-audio.png" });
    await callerPage.getByRole("button", { name: "Завершить звонок" }).click();
    await callerPage.locator('[data-call-overlay="true"]').waitFor({ state: "hidden", timeout: 10_000 });

    await callerPage.getByRole("button", { name: "Видеозвонок" }).click();
    await callerPage.locator('[data-call-overlay="true"]').waitFor({ state: "visible", timeout: 10_000 });
    await calleePage.getByRole("button", { name: "Принять звонок" }).click();
    await callerPage.waitForTimeout(1500);
    check("duplicate video invite does not end the call", await callerPage.locator('[data-call-overlay="true"]').isVisible());
    await callerPage.locator('[data-call-local-video="true"]').waitFor({ state: "visible", timeout: 10_000 });
    const video = await readOverlayGeometry(callerPage);
    check("video overlay fills visual viewport", Math.abs(video.height - video.viewportHeight) < 2, `height=${video.height}, viewport=${video.viewportHeight}`);
    check("video camera sits behind chrome before remote video", Number(video.localVideoZ) < Number(video.controlsZ), `camera=${video.localVideoZ}, controls=${video.controlsZ}`);
    check("video controls stay visible", await callerPage.getByRole("button", { name: "Микрофон" }).isVisible());
    check("video end control stays visible", await callerPage.getByRole("button", { name: "Завершить звонок" }).isVisible());
    check("video controls remain inside viewport", video.controlsBottom !== null && video.controlsBottom <= video.viewportHeight + 1, `bottom=${video.controlsBottom}`);
    await callerPage.screenshot({ path: "/tmp/nox-call-video.png" });
    await callerPage.getByRole("button", { name: "Завершить звонок" }).click();
  } finally {
    await callerContext.close();
    await calleeContext.close();
    await browser.close();
    await app.stop();
    await prisma.$disconnect();
  }

  if (failures() > 0) process.exit(1);
  console.log("CALL_OVERLAY_LAYOUT=PASS");
}

void main();
