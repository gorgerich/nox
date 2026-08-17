/**
 * Press feedback, measured under a real mouse press.
 *   npm run validate:press-feedback
 *
 * The defect this exists to catch is invisible in source. Tailwind v4 compiles
 * `active:scale-[0.96]` to the independent `scale` property, while the hand
 * written utilities used `transform: scale()`. They are different properties,
 * so on any element carrying both they multiplied: the dock button carries
 * `fast-tap`, `fluid-hit` and `active:scale-[0.96]` at once and pressed to
 * 0.93 — past the point where feedback stops reading as a press and starts
 * reading as a flinch.
 *
 * The same split made the transition miss. `transition-smooth` and `.fast-tap`
 * both listed `transform`, so the `scale` change they were meant to ease was
 * not transitioned at all and snapped on and off.
 *
 * Both are one-line regressions to reintroduce and neither shows up in a
 * screenshot, so they are asserted here against the computed style.
 */
import { randomUUID } from "node:crypto";
import {
  createChecker,
  createPrisma,
  loadPlaywright,
  requireIsolatedDatabase,
  seedUser,
  signIn,
  startApp,
  type BrowserLike,
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.PRESS_PORT ?? 4015);

/** The value the whole interface presses to. */
const PRESS = 0.96;
const TOLERANCE = 0.005;

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const me = await seedUser(prisma, randomUUID(), `press${Date.now()}`);

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();
  const context: ContextLike = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page: PageLike = await context.newPage();

  try {
    await signIn(page, app.base, me.username);
    await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1200);

    // 1. The transition has to name the property that actually changes.
    const transitions = (await page.evaluate(
      `(() => {
        const targets = Array.from(document.querySelectorAll('.fast-tap, .transition-smooth')).slice(0, 40);
        const missing = targets
          .filter((el) => /(^|\\s)(active:)?scale/.test(el.className) || el.classList.contains('fast-tap'))
          .filter((el) => !getComputedStyle(el).transitionProperty.split(/,\\s*/).includes('scale'))
          .map((el) => String(el.className).split(' ')[0]);
        return { checked: targets.length, missing };
      })()`,
    )) as { checked: number; missing: string[] };
    check(
      "elements that scale on press transition the scale property",
      transitions.checked > 0 && transitions.missing.length === 0,
      `checked=${transitions.checked} missing=${transitions.missing.join(",")}`,
    );

    // 2. Nothing may set press feedback through `transform`, because that
    //    multiplies with Tailwind's `scale` instead of replacing it.
    const compounding = (await page.evaluate(
      `(() => {
        const walk = (rules) => Array.from(rules).flatMap((rule) => {
          if (rule.cssRules) return walk(rule.cssRules);           // @layer, @media, @supports
          return rule.selectorText ? [rule] : [];
        });
        const all = Array.from(document.styleSheets).flatMap((sheet) => {
          try { return walk(sheet.cssRules); } catch { return []; }
        });
        return all
          .filter((rule) => /:active/.test(rule.selectorText))
          .filter((rule) => /transform:\\s*scale\\(/.test(rule.cssText))
          .map((rule) => rule.selectorText);
      })()`,
    )) as string[];
    check(
      "no :active rule sets scale through transform",
      compounding.length === 0,
      compounding.join(", "),
    );

    // 3. The measurement that matters: hold the button down and read it.
    const dock = page.locator(".fast-tap.fluid-hit").first();
    await dock.waitFor({ state: "visible", timeout: 30_000 });
    const box = await dock.boundingBox();
    check("the dock button is on screen", box !== null);

    if (box) {
      await page.evaluate(`document.querySelector('.fast-tap.fluid-hit')?.setAttribute('data-press-probe', '1')`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      // Past the 140ms transition, so this is the resting pressed state.
      await page.waitForTimeout(300);
      const pressed = (await page.evaluate(
        `(() => {
          const el = document.querySelector('[data-press-probe="1"]');
          if (!el) return null;
          const cs = getComputedStyle(el);
          // The rendered scale is the scale property composed with whatever the
          // transform contributes — which is the compounding this guards.
          const m = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
          const fromTransform = Math.sqrt(m.a * m.a + m.b * m.b) || 1;
          const fromScale = cs.scale === 'none' ? 1 : parseFloat(cs.scale.split(' ')[0]);
          return { effective: fromScale * fromTransform, fromScale, fromTransform };
        })()`,
      )) as { effective: number; fromScale: number; fromTransform: number } | null;
      await page.mouse.up();

      check(
        "a pressed button scales to exactly the prescribed value",
        pressed !== null && Math.abs(pressed.effective - PRESS) < TOLERANCE,
        pressed ? `effective=${pressed.effective.toFixed(4)} (scale=${pressed.fromScale}, transform=${pressed.fromTransform.toFixed(4)})` : "not measured",
      );

      // Polled to a deadline rather than read once after a fixed sleep.
      //
      // The transition is 140ms and the old read waited 300, which is ample on
      // an idle machine and not ample at all on a loaded one: the release event
      // and the frames that follow it are wall-clock work, and the suite failed
      // the merge gate reporting a still-pressed 0.96 while passing seconds
      // later on the same build. Polling keeps the assertion exactly as strict
      // — a button that never returns still fails, three seconds later instead
      // of three hundred milliseconds — while removing the race with the
      // machine's own load.
      const readScale = `(() => {
        const el = document.querySelector('[data-press-probe="1"]');
        const cs = el ? getComputedStyle(el) : null;
        return cs ? (cs.scale === 'none' ? 1 : parseFloat(cs.scale.split(' ')[0])) : null;
      })()`;
      let released = (await page.evaluate(readScale)) as number | null;
      const settleDeadline = Date.now() + 3_000;
      while (Date.now() < settleDeadline && (released === null || Math.abs(released - 1) >= 0.005)) {
        await page.waitForTimeout(100);
        released = (await page.evaluate(readScale)) as number | null;
      }
      // A tolerance rather than an exact 1: the last frame of the ease reports
      // 0.999973, which is settled for every purpose except an equality check.
      // What this guards is that the press is released at all.
      check(
        "the button returns to rest when released",
        released !== null && Math.abs(released - 1) < 0.005,
        `scale=${released}`,
      );
    }
  } finally {
    await context.close();
    await browser.close();
    await app.stop();
  }

  return failures();
}

main()
  .then((failed) => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll press feedback checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
