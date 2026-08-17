/**
 * Sending has to feel finished before the network is.
 *   npm run validate:instant-send
 *
 * Two defects reported from a physical iPhone, both of which look fine in
 * source and only show up against a slow request:
 *
 *  1. **A message that reads as unsent.** The bubble was always immediate —
 *     that part of the controller was already local-first — but a spinner was
 *     drawn beside it from the first frame and stayed up for the whole request.
 *     A spinner means "still working", so a send that completed normally still
 *     read as one that had not happened. Proven here by holding the request
 *     open for two seconds and requiring the message to be on screen, without
 *     a spinner, long before it resolves.
 *
 *  2. **A video note with nothing in it.** The circle appeared with an empty
 *     source and filled in a second or two later. Two causes, both covered:
 *     the preview URL was fetched back out of IndexedDB after the bytes had
 *     been written to it, and the memo that builds the pending bubble did not
 *     list that URL among its dependencies, so it kept rendering the empty one.
 *
 *  3. **A circle that took over the screen.** Tapping it scaled it to
 *     `min(76vw, 24rem)`. Playback is a state, not a size; the geometry is
 *     asserted identical before the tap, after the tap, and after the video
 *     reports its own dimensions, at three widths.
 */
import { randomUUID } from "node:crypto";
import {
  COMPOSER_SELECTOR,
  composerOf,
  createChecker,
  createPrisma,
  loadPlaywright,
  requireIsolatedDatabase,
  seedChat,
  seedUser,
  signIn,
  startApp,
  type BrowserLike,
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.INSTANT_SEND_PORT ?? 4025);

/** How long the intercepted request is held open. */
const HELD_MS = 2_000;
/**
 * The bubble has to be up well before the request resolves.
 *
 * Half the hold, not a stopwatch figure. The number measured here includes the
 * driver's own click and locator-polling overhead, which on a loaded CI box is
 * most of it — an earlier 700ms budget failed at 746ms in a gate run and
 * measured 609ms for the identical build on a quiet machine. What the suite is
 * actually asserting is that the bubble does not wait on the network, and a
 * bubble that is up in under half the hold has demonstrated that.
 */
const INSTANT_BUDGET_MS = HELD_MS / 2;

const WIDTHS = [320, 393, 430];

const CIRCLE = {
  name: "video-message-instant.mp4",
  mimeType: "video/mp4",
  buffer: Buffer.from("video-note-bytes", "utf8"),
};

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);

  const me = await seedUser(prisma, randomUUID(), `inst${Date.now()}`);
  const peer = await seedUser(prisma, randomUUID(), `ipeer${Date.now()}`);
  const chatId = await seedChat(prisma, {
    id: randomUUID(),
    type: "DIRECT",
    owner: me.id,
    members: [me.id, peer.id],
  });

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();

  try {
    // -- 1. text, against a request held open for two seconds ---------------
    {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 393, height: 852 },
        isMobile: true,
        hasTouch: true,
      });
      const page: PageLike = await context.newPage();
      await signIn(page, app.base, me.username);
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      await composerOf(page);

      await context.route("**/api/chats/*/messages", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, HELD_MS));
        await route.continue();
      });

      const body = `мгновенно-${Date.now()}`;
      const composer = page.locator(COMPOSER_SELECTOR).first();
      await composer.fill(body);

      const startedAt = Date.now();
      await page.getByRole("button", { name: /Отправить|Send/ }).first().click();

      const bubble = page.getByText(body, { exact: false });
      await bubble.waitFor({ state: "visible", timeout: INSTANT_BUDGET_MS });
      const appearedAfter = Date.now() - startedAt;
      check(
        "the bubble is on screen long before the request resolves",
        appearedAfter < INSTANT_BUDGET_MS,
        `appeared after ${appearedAfter}ms, request held ${HELD_MS}ms`,
      );

      // The composer is free at the same moment — it waits on the local write,
      // not on the request.
      const draft = await composer.inputValue();
      check("the composer is already empty", draft === "", `draft=${JSON.stringify(draft)}`);

      // And nothing is spinning next to it.
      const spinners = (await page.evaluate(
        `document.querySelectorAll('.animate-spin').length`,
      )) as number;
      check("no spinner is drawn beside the new message", spinners === 0, `spinners=${spinners}`);

      // Let the held request through and confirm it lands on the same bubble.
      await page.waitForTimeout(HELD_MS + 2_500);
      const copies = (await page.evaluate(
        `Array.from(document.querySelectorAll('p, span, div'))
           .filter((el) => el.children.length === 0 && (el.textContent || '').trim() === ${JSON.stringify(body)})
           .length`,
      )) as number;
      check("the confirmed message is the same one bubble, not a second", copies === 1, `copies=${copies}`);

      await context.unroute("**/api/chats/*/messages");
      await page.close();
      await context.close();
    }

    // -- 2. the video circle: present immediately, and one size -------------
    for (const width of WIDTHS) {
      const context: ContextLike = await browser.newContext({
        viewport: { width, height: 852 },
        isMobile: true,
        hasTouch: true,
      });
      const page: PageLike = await context.newPage();
      await signIn(page, app.base, me.username);
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      await composerOf(page);

      // The upload is held open, so anything visible during it is local.
      await context.route("**/api/chats/*/attachments", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, HELD_MS));
        await route.continue();
      });

      const input = page.locator('input[type="file"]').first();
      await input.setInputFiles({ name: CIRCLE.name, mimeType: CIRCLE.mimeType, buffer: CIRCLE.buffer });
      await page.waitForTimeout(600);
      const send = page.getByRole("button", { name: "Отправить вложения" });
      if ((await send.count()) > 0) await send.first().click();

      const circle = page.locator('button[aria-label="Воспроизвести видеосообщение"]').first();
      await circle.waitFor({ state: "visible", timeout: INSTANT_BUDGET_MS + 900 });

      const localSource = (await page.evaluate(
        `(() => {
          const video = document.querySelector('button[aria-label="Воспроизвести видеосообщение"] video');
          return video ? String(video.getAttribute('src') || '') : '';
        })()`,
      )) as string;
      check(
        `@${width}px the circle is showing local bytes before the upload finishes`,
        localSource.startsWith("blob:"),
        `src=${localSource.slice(0, 24)}`,
      );

      const boxOf = async () =>
        (await page.evaluate(
          `(() => {
            const el = document.querySelector('button[aria-label="Воспроизвести видеосообщение"], button[aria-label="Пауза"]');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          })()`,
        )) as { w: number; h: number } | null;

      const atRest = await boxOf();
      check(
        `@${width}px the circle is round and sized within the brief`,
        atRest !== null && atRest.w === atRest.h && atRest.w <= 260 && atRest.w >= Math.min(204, width - 80),
        atRest ? `${atRest.w}x${atRest.h}` : "not measured",
      );

      // The video reporting its own dimensions must not resize anything.
      await page.evaluate(
        `(() => {
          const video = document.querySelector('button[aria-label="Воспроизвести видеосообщение"] video');
          if (video) video.dispatchEvent(new Event('loadedmetadata'));
        })()`,
      );
      await page.waitForTimeout(250);
      const afterMetadata = await boxOf();
      check(
        `@${width}px loadedmetadata does not change the circle`,
        atRest !== null && afterMetadata !== null && afterMetadata.w === atRest.w && afterMetadata.h === atRest.h,
        `${atRest?.w}x${atRest?.h} -> ${afterMetadata?.w}x${afterMetadata?.h}`,
      );

      // And neither does tapping it. The fixture is not a decodable video, so
      // playback itself will fail — which is the point: the size must not
      // depend on whether it plays.
      await circle.click({ force: true });
      await page.waitForTimeout(400);
      const afterTap = await boxOf();
      check(
        `@${width}px tapping the circle does not change its size`,
        atRest !== null && afterTap !== null && afterTap.w === atRest.w && afterTap.h === atRest.h,
        `${atRest?.w}x${atRest?.h} -> ${afterTap?.w}x${afterTap?.h}`,
      );

      // Nothing may spill sideways at any of these widths.
      const overflow = (await page.evaluate(
        `(() => {
          const doc = document.documentElement;
          return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
        })()`,
      )) as { scrollWidth: number; clientWidth: number };
      check(
        `@${width}px the circle does not push the conversation sideways`,
        overflow.scrollWidth <= overflow.clientWidth + 1,
        `scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`,
      );

      // Once the upload lands, the same single bubble is still there.
      await context.unroute("**/api/chats/*/attachments");
      await page.waitForTimeout(HELD_MS + 2_500);
      const circles = (await page.evaluate(
        `document.querySelectorAll('button[aria-label="Воспроизвести видеосообщение"], button[aria-label="Пауза"]').length`,
      )) as number;
      check(
        `@${width}px the committed upload did not add a second circle`,
        circles === 1,
        `circles=${circles}`,
      );

      await page.close();
      await context.close();
    }
  } finally {
    await browser.close();
    await app.stop();
    await prisma.$disconnect();
  }

  if (failures() > 0) {
    console.error(`\n${failures()} check(s) failed.`);
    return 1;
  }
  console.log("\nInstant send: all checks passed.");
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
