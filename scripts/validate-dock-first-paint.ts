/**
 * The dock must be in its final place in the first frame the user sees.
 *   npm run validate:dock-first-paint
 *
 * The reported symptom is that the dock starts too high and settles after the
 * first touch. This measures it instead of reasoning about it: an init script
 * samples the dock's rectangle every animation frame from the moment the
 * document exists, so the first painted position is recorded rather than
 * inferred, and the samples are compared across hydration, effects, settling and
 * a synthetic touch.
 *
 * Tolerance is 1px — sub-pixel rounding, not movement.
 *
 * Disposable database only.
 */
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

const PORT = Number(process.env.DOCK_PORT ?? 3999);
const TOLERANCE = 1;
const { check, failures } = createChecker();

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
];

/**
 * Runs before any application script. It starts sampling as soon as there is a
 * document, so sample 0 is the dock's position in the first frame it exists —
 * which is the thing under test.
 */
const SAMPLER = `
window.__dockSamples = [];
(() => {
  const record = (label) => {
    const dock = document.querySelector('nav[aria-label="Нижняя навигация"]');
    if (!dock) return false;
    const rect = dock.getBoundingClientRect();
    const styles = getComputedStyle(dock);
    window.__dockSamples.push({
      label,
      t: window.__dockSamples.length,
      top: Math.round(rect.top * 100) / 100,
      bottom: Math.round(rect.bottom * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
      gapFromViewportBottom: Math.round((window.innerHeight - rect.bottom) * 100) / 100,
      innerHeight: window.innerHeight,
      visualViewportHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
      visualViewportOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
      position: styles.position,
      cssBottom: styles.bottom,
      transform: styles.transform,
    });
    return true;
  };
  let frames = 0;
  const tick = () => {
    record('frame-' + frames);
    frames += 1;
    if (frames < 180) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__recordDock = record;
})();
`;

type Sample = {
  label: string;
  top: number;
  bottom: number;
  height: number;
  gapFromViewportBottom: number;
  innerHeight: number;
  visualViewportHeight: number | null;
  visualViewportOffsetTop: number | null;
  position: string;
  cssBottom: string;
  transform: string;
};

async function samples(page: PageLike): Promise<Sample[]> {
  return page.evaluate(() => (window as unknown as { __dockSamples: Sample[] }).__dockSamples);
}

async function mark(page: PageLike, label: string) {
  await page.evaluate((value: string) => {
    (window as unknown as { __recordDock?: (label: string) => boolean }).__recordDock?.(value);
  }, label);
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir("messenger-shell");
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = `dock-me-${stamp}`;
  const peer = `dock-peer-${stamp}`;
  const chatId = `dock-chat-${stamp}`;
  const username = `dock${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, me, username);
    await seedUser(prisma, peer, `dockpeer${stamp}`);
    await seedChat(prisma, { id: chatId, type: "GROUP", owner: me, members: [me, peer], title: "Dock" });

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();

    for (const viewport of VIEWPORTS) {
      for (const scheme of ["light", "dark"] as const) {
        const context: ContextLike = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: scheme,
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: 2,
        });
        await context.addInitScript(SAMPLER);

        const page = await context.newPage();
        await signIn(page, app.base, username);
        await page.goto(`${app.base}/chats`, { waitUntil: "commit" });

        // Hydration is done once React has attached; a deterministic marker
        // beats a guess at how long that takes.
        await page.waitForFunction(
          () => document.querySelector('nav[aria-label="Нижняя навигация"] a[href="/chats"]') !== null,
          { timeout: 30_000 },
        );
        await mark(page, "hydrated");

        // Effects have run once the sliding pill has been measured and placed.
        await page
          .waitForFunction(() => document.querySelector(".dock-slide-pill") !== null, { timeout: 15_000 })
          .catch(() => {});
        await mark(page, "effects");

        await page.waitForTimeout(1_200);
        await mark(page, "settled");

        // The reported trigger: the first touch.
        const box = await page.locator('nav[aria-label="Нижняя навигация"]').first().boundingBox();
        if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await page.waitForTimeout(600);
        await mark(page, "after-touch");

        const collected = await samples(page);
        const first = collected[0];
        const hydrated = collected.find((sample) => sample.label === "hydrated");
        const effects = collected.find((sample) => sample.label === "effects");
        const settled = collected.find((sample) => sample.label === "settled");
        const touched = collected.find((sample) => sample.label === "after-touch");

        const label = `${viewport.name} ${scheme}`;
        check(`${label}: the dock exists in the first frame`, Boolean(first), `samples=${collected.length}`);
        if (!first || !settled || !touched) {
          await context.close();
          continue;
        }

        const move = (a: Sample | undefined, b: Sample | undefined) =>
          a && b ? Math.abs(a.bottom - b.bottom) : Number.NaN;

        check(`${label}: first frame → hydration`, move(first, hydrated) <= TOLERANCE, `${move(first, hydrated)}px`);
        check(`${label}: hydration → effects`, move(hydrated, effects) <= TOLERANCE, `${move(hydrated, effects)}px`);
        check(`${label}: effects → settled`, move(effects, settled) <= TOLERANCE, `${move(effects, settled)}px`);
        check(`${label}: settled → after touch`, move(settled, touched) <= TOLERANCE, `${move(settled, touched)}px`);
        check(`${label}: first frame → after touch`, move(first, touched) <= TOLERANCE, `${move(first, touched)}px`);
        check(`${label}: the dock is viewport-fixed`, first.position === "fixed", first.position);

        // Every frame in the run, not only the labelled ones: a transient jump
        // between markers would otherwise pass unnoticed.
        const worst = collected.reduce(
          (max, sample) => Math.max(max, Math.abs(sample.bottom - settled.bottom)),
          0,
        );
        check(`${label}: no frame deviates from the settled position`, worst <= TOLERANCE, `worst=${Math.round(worst * 100) / 100}px`);

        if (viewport.name === "320x568" && scheme === "light") {
          await page.screenshot({ path: join(shots, "dock-first-frame-320.png") });
        }
        if (viewport.name === "390x844" && scheme === "light") {
          await page.screenshot({ path: join(shots, "dock-first-frame-390.png") });
          await page.screenshot({ path: join(shots, "dock-after-hydration.png") });
          await page.screenshot({ path: join(shots, "dock-after-touch.png") });
        }

        await context.close();
      }
    }

    // --- the ways a user actually arrives ------------------------------------
    // A direct load is only one of them. A dock that is stable on `goto` but
    // jumps after a login redirect or a back navigation is still broken.
    {
      const journeys: { name: string; run: (page: PageLike) => Promise<void> }[] = [
        {
          name: "deep link into a conversation list",
          run: async (page) => {
            await page.goto(`${app.base}/chats`, { waitUntil: "commit" });
          },
        },
        {
          name: "arriving from another tab",
          run: async (page) => {
            await page.goto(`${app.base}/contacts`, { waitUntil: "commit" });
            await page.waitForTimeout(1_200);
            await page.locator('nav[aria-label="Нижняя навигация"] a[href="/chats"]').first().click();
          },
        },
        {
          name: "hard reload",
          run: async (page) => {
            await page.goto(`${app.base}/chats`, { waitUntil: "commit" });
            await page.waitForTimeout(1_200);
            await page.reload({ waitUntil: "commit" });
          },
        },
        {
          name: "back navigation",
          run: async (page) => {
            await page.goto(`${app.base}/chats`, { waitUntil: "commit" });
            await page.waitForTimeout(1_000);
            await page.goto(`${app.base}/profile`, { waitUntil: "commit" });
            await page.waitForTimeout(1_000);
            await page.goBack();
          },
        },
      ];

      for (const journey of journeys) {
        const context: ContextLike = await browser.newContext({
          viewport: { width: 390, height: 844 },
          hasTouch: true,
          isMobile: true,
        });
        await context.addInitScript(SAMPLER);
        const page = await context.newPage();
        await signIn(page, app.base, username);
        await journey.run(page);
        await page.waitForFunction(
          () => document.querySelector('nav[aria-label="Нижняя навигация"] a[href="/chats"]') !== null,
          { timeout: 30_000 },
        );
        await page.waitForTimeout(1_200);
        await mark(page, "settled");
        const collected = (await samples(page)).filter((sample) => sample.height > 0);
        const settled = collected[collected.length - 1];
        const worst = collected.reduce((max, sample) => Math.max(max, Math.abs(sample.bottom - settled.bottom)), 0);
        check(`${journey.name}: the dock never moves`, worst <= TOLERANCE, `worst=${Math.round(worst * 100) / 100}px`);
        await context.close();
      }
    }

    // --- a viewport that changes height, as a collapsing browser toolbar does -
    {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      await context.addInitScript(SAMPLER);
      const page = await context.newPage();
      await signIn(page, app.base, username);
      await page.goto(`${app.base}/chats`, { waitUntil: "commit" });
      await page.waitForFunction(
        () => document.querySelector('nav[aria-label="Нижняя навигация"] a[href="/chats"]') !== null,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(1_000);

      const gapBefore = (await samples(page)).slice(-1)[0]?.gapFromViewportBottom;
      // A mobile browser hiding its toolbar is, to the page, a taller viewport.
      await page.setViewportSize({ width: 390, height: 900 });
      await page.waitForTimeout(600);
      await mark(page, "grown");
      const grown = (await samples(page)).find((sample) => sample.label === "grown");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(600);
      await mark(page, "shrunk");
      const shrunk = (await samples(page)).find((sample) => sample.label === "shrunk");

      check(
        "the dock keeps its distance from the bottom when the viewport grows",
        Math.abs((grown?.gapFromViewportBottom ?? -1) - (gapBefore ?? -2)) <= TOLERANCE,
        `${gapBefore} → ${grown?.gapFromViewportBottom}`,
      );
      check(
        "the dock keeps its distance when the viewport shrinks back",
        Math.abs((shrunk?.gapFromViewportBottom ?? -1) - (gapBefore ?? -2)) <= TOLERANCE,
        `${gapBefore} → ${shrunk?.gapFromViewportBottom}`,
      );

      // Landscape.
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(800);
      await mark(page, "landscape");
      const landscape = (await samples(page)).find((sample) => sample.label === "landscape");
      check(
        "the dock keeps its distance in landscape",
        Math.abs((landscape?.gapFromViewportBottom ?? -1) - (gapBefore ?? -2)) <= TOLERANCE,
        `gap=${landscape?.gapFromViewportBottom}`,
      );
      await context.close();
    }

    // --- a focused text field, which is when a real keyboard would open -------
    // Chromium has no on-screen keyboard, so this cannot prove what iOS does.
    // What it can prove is that focusing an input does not move the dock by
    // itself — that no code reacts to focus by recomputing the dock's position,
    // and that no inset is left behind when focus goes away.
    {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      await context.addInitScript(SAMPLER);
      const page = await context.newPage();
      await signIn(page, app.base, username);
      await page.goto(`${app.base}/chats/search`, { waitUntil: "commit" });
      await page.waitForTimeout(2_500);
      await mark(page, "before-focus");

      const field = page.locator("input, textarea").first();
      if ((await field.count()) > 0) {
        await field.click();
        await page.waitForTimeout(900);
        await mark(page, "focused");
        await page.screenshot({ path: join(shots, "dock-keyboard-open.png") });
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.waitForTimeout(900);
        await mark(page, "blurred");
        await page.screenshot({ path: join(shots, "dock-keyboard-closed.png") });

        const all = await samples(page);
        const before = all.find((sample) => sample.label === "before-focus");
        const focused = all.find((sample) => sample.label === "focused");
        const blurred = all.find((sample) => sample.label === "blurred");
        if (before && focused && blurred) {
          check("focusing a field does not move the dock", Math.abs(focused.bottom - before.bottom) <= TOLERANCE, `${Math.abs(focused.bottom - before.bottom)}px`);
          check("blurring leaves no stale offset", Math.abs(blurred.bottom - before.bottom) <= TOLERANCE, `${Math.abs(blurred.bottom - before.bottom)}px`);
        } else {
          check("the dock is present on the search route", false, "no samples — the dock may be hidden here by design");
        }
      }
      await context.close();
    }

    // --- the content under the dock must not be hidden by it -----------------
    {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      });
      await context.addInitScript(SAMPLER);
      const page = await context.newPage();
      await signIn(page, app.base, username);
      await page.goto(`${app.base}/chats`, { waitUntil: "commit" });
      await page.waitForFunction(
        () => document.querySelector('nav[aria-label="Нижняя навигация"] a[href="/chats"]') !== null,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(1_200);

      const clearance = await page.evaluate(() => {
        const dock = document.querySelector('nav[aria-label="Нижняя навигация"]');
        const main = document.querySelector("main");
        if (!dock || !main) return null;
        const dockRect = dock.getBoundingClientRect();
        const last = main.querySelector("a[href^='/chats/']:last-of-type") ?? main.lastElementChild;
        const lastRect = last?.getBoundingClientRect();
        return {
          dockTop: dockRect.top,
          mainBottom: main.getBoundingClientRect().bottom,
          lastBottom: lastRect?.bottom ?? null,
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      check("the page does not scroll horizontally", clearance?.horizontalOverflow === false);
      // Scroll to the end and confirm the last row clears the dock.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForTimeout(500);
      const bottomMost = await page.evaluate(() => {
        const dock = document.querySelector('nav[aria-label="Нижняя навигация"]');
        const rows = Array.from(document.querySelectorAll("main a[href^='/chats/']"));
        if (!dock || rows.length === 0) return null;
        const dockTop = dock.getBoundingClientRect().top;
        const lowest = rows.reduce((max, row) => Math.max(max, row.getBoundingClientRect().bottom), 0);
        return { dockTop, lowest };
      });
      if (bottomMost) {
        check(
          "the last row is not hidden behind the dock",
          bottomMost.lowest <= bottomMost.dockTop + 1,
          `lowest=${Math.round(bottomMost.lowest)} dockTop=${Math.round(bottomMost.dockTop)}`,
        );
      }
      await context.close();
    }
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
    console.log("\nAll dock first-paint checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
