/**
 * The global interface scale, measured in a real browser.
 *   npm run validate:ui-scale
 *
 * The feature is one CSS declaration — the root font size — so what needs
 * guarding is not whether it applies but what it drags along with it. Three
 * classes of regression, all of them invisible in source:
 *
 *  1. **Overflow.** Scaling type and spacing together is what keeps the
 *     interface in proportion, and it is also what pushes a header, a dock or
 *     a composer past the right edge of a 320px phone. Every screen is checked
 *     at every stop at four widths, because the one that breaks is never the
 *     one you would have guessed.
 *
 *  2. **Reaching things it must not reach.** The keyboard inset, the visual
 *     viewport height and the safe areas are real device pixels. If any of
 *     them ever starts tracking the scale, the composer ends up behind the
 *     keyboard — so their values are read at the smallest and largest stops
 *     and required to be identical.
 *
 *  3. **The cold-start flash.** The preference is written by an inline script
 *     before first paint. If that ever regresses to a `useEffect`, the app
 *     renders once at the standard size and jumps, which is the single most
 *     visible thing a returning user would see. Asserted by reading the root
 *     font size from the very first frame after a reload.
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
import { UI_SCALE_LEVELS, UI_SCALE_STEPS, type UiScaleLevel } from "../src/lib/ui-scale";

const PORT = Number(process.env.UI_SCALE_PORT ?? 4023);

/** The narrow end is an iPhone SE; the wide end is a Pro Max. */
const WIDTHS = [320, 375, 393, 430];

type Screen = { name: string; path: string; ready: string };

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);

  const me = await seedUser(prisma, randomUUID(), `scale${Date.now()}`);
  const peer = await seedUser(prisma, randomUUID(), `peer${Date.now()}`);
  const chatId = await seedChat(prisma, {
    id: randomUUID(),
    type: "DIRECT",
    owner: me.id,
    members: [me.id, peer.id],
  });

  // Enough traffic that the conversation has bubbles of both widths — a long
  // message is what puts a timestamp under pressure, a short one is what shows
  // whether the timestamp still fits beside the text.
  await prisma.message.createMany({
    data: [
      { id: randomUUID(), chatId, senderUserId: peer.id, type: "TEXT", body: "Привет" },
      {
        id: randomUUID(),
        chatId,
        senderUserId: me.id,
        type: "TEXT",
        body: "Длинное сообщение, которое обязано переноситься по строкам и не выталкивать метку времени за пределы пузыря даже на самом крупном масштабе интерфейса.",
      },
      { id: randomUUID(), chatId, senderUserId: me.id, type: "TEXT", body: "Ок" },
    ],
  });

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();
  const shots = screenshotDir("ui-scale");

  const screens: Screen[] = [
    { name: "chats", path: "/chats", ready: "main, [data-chat-list]" },
    { name: "chat", path: `/chats/${chatId}`, ready: ".chat-screen" },
    { name: "profile", path: "/profile", ready: "main" },
  ];

  try {
    // -- 1. the token itself, at every stop --------------------------------
    {
      const context: ContextLike = await browser.newContext({ viewport: { width: 393, height: 852 } });
      const page: PageLike = await context.newPage();
      await signIn(page, app.base, me.username);

      for (const level of UI_SCALE_LEVELS) {
        await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
        await page.evaluate(`localStorage.setItem('nox:ui-scale', '${level}')`);
        await page.reload({ waitUntil: "domcontentloaded" });

        const measured = (await page.evaluate(
          `(() => {
            const root = document.documentElement;
            const cs = getComputedStyle(root);
            return {
              fontSize: parseFloat(cs.fontSize),
              token: cs.getPropertyValue('--ui-scale').trim(),
              attr: root.dataset.uiScale,
            };
          })()`,
        )) as { fontSize: number; token: string; attr: string };

        const expected = 16 * UI_SCALE_STEPS[level as UiScaleLevel];
        check(
          `level ${level} sets the root font size to ${expected.toFixed(2)}px`,
          Math.abs(measured.fontSize - expected) < 0.2,
          `measured=${measured.fontSize} token=${measured.token} attr=${measured.attr}`,
        );
        check(
          `level ${level} survives a reload`,
          measured.attr === String(level),
          `attr=${measured.attr}`,
        );
      }

      // -- 2. no flash of the standard size on a cold start ---------------
      //
      // Two halves, because either alone can be satisfied by the wrong
      // implementation. The size has to be right as soon as the document has
      // parsed, *and* it has to come from a script in the head — a `useEffect`
      // would also pass the first assertion, one frame late, which is exactly
      // the flash this guards against.
      await page.evaluate(`localStorage.setItem('nox:ui-scale', '7')`);
      await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });

      const boot = (await page.evaluate(
        `(() => {
          const scripts = Array.from(document.head.querySelectorAll('script:not([src])'));
          return {
            inHead: scripts.some((s) => s.textContent && s.textContent.includes('nox:ui-scale')),
            fontSize: parseFloat(getComputedStyle(document.documentElement).fontSize),
            // Set as an inline style by that script, before React exists.
            inline: document.documentElement.style.getPropertyValue('--ui-scale').trim(),
          };
        })()`,
      )) as { inHead: boolean; fontSize: number; inline: string };

      check(
        "the scale is applied by a script in the head, not after hydration",
        boot.inHead,
        `inHead=${boot.inHead}`,
      );
      check(
        "the stored scale is in force as soon as the document has parsed",
        Math.abs(boot.fontSize - 16 * UI_SCALE_STEPS[7]) < 0.2 && boot.inline === String(UI_SCALE_STEPS[7]),
        `fontSize=${boot.fontSize}px inline=${boot.inline}`,
      );

      // -- 3. the geometry this feature must never touch ------------------
      const readEnv = `(() => {
        const cs = getComputedStyle(document.documentElement);
        return {
          keyboard: cs.getPropertyValue('--keyboard-inset').trim(),
          visualVh: cs.getPropertyValue('--visual-vh').trim(),
          innerWidth: String(window.innerWidth),
          dpr: String(window.devicePixelRatio),
        };
      })()`;

      await page.evaluate(`localStorage.setItem('nox:ui-scale', '1')`);
      await page.reload({ waitUntil: "networkidle" });
      const atSmallest = (await page.evaluate(readEnv)) as Record<string, string>;

      await page.evaluate(`localStorage.setItem('nox:ui-scale', '7')`);
      await page.reload({ waitUntil: "networkidle" });
      const atLargest = (await page.evaluate(readEnv)) as Record<string, string>;

      for (const key of ["keyboard", "visualVh", "innerWidth", "dpr"]) {
        check(
          `${key} is identical at the smallest and largest scale`,
          atSmallest[key] === atLargest[key],
          `small=${atSmallest[key]} large=${atLargest[key]}`,
        );
      }

      await page.close();
      await context.close();
    }

    // -- 4. overflow, every screen × every stop × every width --------------
    for (const width of WIDTHS) {
      const context: ContextLike = await browser.newContext({
        viewport: { width, height: 852 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const page: PageLike = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await signIn(page, app.base, me.username);

      for (const level of UI_SCALE_LEVELS) {
        await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
        await page.evaluate(`localStorage.setItem('nox:ui-scale', '${level}')`);
        await page.reload({ waitUntil: "domcontentloaded" });

        for (const screen of screens) {
          await page.goto(`${app.base}${screen.path}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(500);

          const overflow = (await page.evaluate(
            `(() => {
              const doc = document.documentElement;
              // The document's own overflow first, then the specific elements
              // that would be the culprits, named so a failure says which.
              const offenders = [];
              const limit = doc.clientWidth + 1;
              for (const el of Array.from(document.querySelectorAll('body *'))) {
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                // A deliberately off-screen element (a closed sheet, a slide-in
                // panel parked to the right) is not overflow.
                if (getComputedStyle(el).visibility === 'hidden') continue;
                if (rect.right > limit + 0.5 && rect.left < limit) {
                  offenders.push((el.tagName + '.' + String(el.className || '')).slice(0, 70) + '@' + Math.round(rect.right));
                }
              }
              return {
                scrollWidth: doc.scrollWidth,
                clientWidth: doc.clientWidth,
                offenders: offenders.slice(0, 4),
              };
            })()`,
          )) as { scrollWidth: number; clientWidth: number; offenders: string[] };

          check(
            `${screen.name} @${width}px level ${level}: no horizontal overflow`,
            overflow.scrollWidth <= overflow.clientWidth + 1,
            `scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth} offenders=${overflow.offenders.join(" | ")}`,
          );
        }

        // The dock has to stay inside the viewport, at every stop — it is the
        // element whose contents (icon, label, avatar) all grow at once.
        await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        const dock = (await page.evaluate(
          `(() => {
            const el = document.querySelector('nav, [data-dock]');
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width };
          })()`,
        )) as { left: number; right: number; bottom: number; width: number } | null;
        check(
          `the dock stays inside a ${width}px viewport at level ${level}`,
          dock !== null && dock.left >= -0.5 && dock.right <= width + 0.5,
          dock ? `left=${dock.left.toFixed(1)} right=${dock.right.toFixed(1)}` : "dock not found",
        );

        // A label that is drawn but cut off mid-word is worse than no label,
        // and it is the failure the dock reaches first as everything in it
        // grows. Either the whole word fits, or it is not shown.
        const clipped = (await page.evaluate(
          `(() => {
            const labels = Array.from(document.querySelectorAll('.dock-tab-label'));
            return labels
              .filter((el) => {
                const rect = el.getBoundingClientRect();
                if (rect.width < 1) return false;            // collapsed on purpose
                return el.scrollWidth > Math.ceil(rect.width) + 1;
              })
              .map((el) => (el.textContent || '').trim() + '@' + Math.round(el.getBoundingClientRect().width) + '/' + el.scrollWidth);
          })()`,
        )) as string[];
        check(
          `no dock label is clipped at ${width}px level ${level}`,
          clipped.length === 0,
          clipped.join(", "),
        );
      }

      check(`no page errors at ${width}px`, pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

      await page.close();
      await context.close();
    }

    // -- 5. the slider, and the screenshots --------------------------------
    {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      const page: PageLike = await context.newPage();
      await signIn(page, app.base, me.username);

      for (const [level, label] of [
        [2, "small"],
        [4, "default"],
        [6, "large"],
      ] as const) {
        await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
        await page.evaluate(`localStorage.setItem('nox:ui-scale', '${level}')`);
        await page.reload({ waitUntil: "domcontentloaded" });

        await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(shots, `ui-scale-${label}-chat.png`) });

        await page.goto(`${app.base}/profile`, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);
        await page.screenshot({ path: join(shots, `ui-scale-${label}-profile.png`) });
      }

      // The control itself: open Оформление and drive it from the keyboard,
      // which is both the accessibility check and the live-preview check.
      await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
      await page.evaluate(`localStorage.setItem('nox:ui-scale', '4')`);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.goto(`${app.base}/profile`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      await page.getByText("Оформление", { exact: true }).first().click();
      await page.waitForTimeout(600);

      const slider = page.getByRole("slider", { name: "Размер интерфейса" });
      await slider.waitFor({ state: "visible", timeout: 15_000 });
      check("the Оформление screen has an interface-size slider", true);

      await page.screenshot({ path: join(shots, "ui-scale-appearance-slider.png") });

      const before = (await page.evaluate(
        `parseFloat(getComputedStyle(document.documentElement).fontSize)`,
      )) as number;
      await slider.press("ArrowRight");
      await page.waitForTimeout(300);
      const after = (await page.evaluate(
        `parseFloat(getComputedStyle(document.documentElement).fontSize)`,
      )) as number;
      check(
        "an arrow key changes the interface size live, with no save step",
        after > before,
        `before=${before} after=${after}`,
      );

      const stored = (await page.evaluate(`localStorage.getItem('nox:ui-scale')`)) as string | null;
      check("the new level is persisted immediately", stored === "5", `stored=${stored}`);

      await page.reload({ waitUntil: "networkidle" });
      const afterReload = (await page.evaluate(
        `parseFloat(getComputedStyle(document.documentElement).fontSize)`,
      )) as number;
      check(
        "the level survives a reload",
        Math.abs(afterReload - after) < 0.2,
        `after=${after} afterReload=${afterReload}`,
      );

      // Reopening Оформление, because a reload lands on the profile root —
      // the sub-screen is component state, not a route.
      await page.getByText("Оформление", { exact: true }).first().click();
      await page.waitForTimeout(600);
      const sliderAgain = page.getByRole("slider", { name: "Размер интерфейса" });
      await sliderAgain.waitFor({ state: "visible", timeout: 15_000 });

      // Home/End are part of the native range contract and are what a
      // keyboard user reaches for to get to the extremes.
      await sliderAgain.press("Home");
      await page.waitForTimeout(250);
      const atHome = (await page.evaluate(`document.documentElement.dataset.uiScale`)) as string;
      check("Home selects the smallest stop", atHome === "1", `level=${atHome}`);

      await sliderAgain.press("End");
      await page.waitForTimeout(250);
      const atEnd = (await page.evaluate(`document.documentElement.dataset.uiScale`)) as string;
      check("End selects the largest stop", atEnd === "7", `level=${atEnd}`);

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
  console.log("\nUI scale: all checks passed.");
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
