/**
 * Proves the dialog focus trap actually traps.
 *   npx tsx scripts/validate-dialog-focus-trap.ts
 *
 * A type-check says the hook is wired; it says nothing about whether focus
 * stays put. Three of the first eleven call sites passed a literal `true` into
 * a component that returns null until it opens, so the effect ran once against
 * an empty ref and the dialog shipped with no trap at all — visually correct,
 * behaviourally absent. That class of defect is only visible at runtime, which
 * is what this suite is for.
 *
 * Uses the "Новое" sheet on /chats as the specimen: it is reachable in two
 * clicks from a signed-in session and uses the same shared hook as every other
 * dialog, so a pass here exercises the hook, not one screen's markup.
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

const PORT = Number(process.env.FOCUS_TRAP_PORT ?? 3994);
const DIALOG = '[role="dialog"][aria-label="Создать или найти"]';

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const me = await seedUser(prisma, randomUUID(), `trap${Date.now()}`);

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();
  const context: ContextLike = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page: PageLike = await context.newPage();

  const pageErrors: string[] = [];
  page.on("pageerror", (error: Error) => pageErrors.push(String(error)));

  try {
    await signIn(page, app.base, me.username);
    await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });

    const opener = page.getByRole("button", { name: "Новое" }).first();
    await opener.waitFor({ state: "visible", timeout: 30_000 });

    // The button is server-rendered before React attaches to it, so the first
    // click can land on markup with no handler and silently do nothing. Retry
    // until the sheet is actually in the DOM rather than trusting one click.
    let opened = false;
    for (let attempt = 0; attempt < 20 && !opened; attempt += 1) {
      await opener.click();
      await page.waitForTimeout(500);
      opened = (await page.evaluate(`document.querySelector('${DIALOG}') !== null`)) === true;
    }
    check("the sheet opens", opened);
    if (!opened) return failures();
    // The hook focuses one frame late, on purpose.
    await page.waitForTimeout(250);

    // 1. Focus moved into the dialog rather than staying on the opener.
    const focusInside = await page.evaluate(
      `(() => {
        const dialog = document.querySelector('${DIALOG}');
        return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
      })()`,
    );
    check("focus moves into the dialog on open", focusInside === true);

    // 2. Everything outside the dialog is inert, so it is out of the tab order
    //    and out of the accessibility tree at the same time.
    const outsideInert = await page.evaluate(
      `(() => {
        const dialog = document.querySelector('${DIALOG}');
        if (!dialog) return { total: 0, reachable: -1 };
        const all = Array.from(document.querySelectorAll('a[href], button, input, textarea, select'));
        const outside = all.filter((element) => !dialog.contains(element));
        const reachable = outside.filter((element) => !element.closest('[inert]'));
        return { total: outside.length, reachable: reachable.length };
      })()`,
    ) as { total: number; reachable: number };
    check(
      "background controls are inert",
      outsideInert.total > 0 && outsideInert.reachable === 0,
      `outside=${outsideInert.total} still-reachable=${outsideInert.reachable}`,
    );

    // 3. Tab from the last focusable element wraps to the first instead of
    //    walking out into the page behind the dialog.
    const wrapped = await page.evaluate(
      `(() => {
        const dialog = document.querySelector('${DIALOG}');
        if (!dialog) return null;
        const focusable = Array.from(dialog.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => element.offsetParent !== null);
        if (focusable.length === 0) return null;
        focusable[focusable.length - 1].focus();
        return focusable.length;
      })()`,
    ) as number | null;
    check("the dialog contains focusable controls", typeof wrapped === "number" && wrapped > 0, `count=${wrapped}`);

    await page.keyboard.press("Tab");
    const stillInside = await page.evaluate(
      `(() => {
        const dialog = document.querySelector('${DIALOG}');
        return Boolean(dialog && document.activeElement && dialog.contains(document.activeElement));
      })()`,
    );
    check("Tab past the last control stays inside the dialog", stillInside === true);

    // 4. Escape closes it, and focus returns to the control that opened it —
    //    not to the top of the document.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    const closed = await page.evaluate(`document.querySelector('${DIALOG}') === null`);
    check("Escape closes the dialog", closed === true);

    const restored = await page.evaluate(
      `document.activeElement instanceof HTMLElement
        && document.activeElement.getAttribute('aria-label') === 'Новое'`,
    );
    check("focus returns to the opener", restored === true);

    // 5. Nothing stays inert once the dialog is gone.
    const leftInert = await page.evaluate(`document.querySelectorAll('[inert]').length`);
    check("no element is left inert after close", leftInert === 0, `inert=${leftInert}`);

    check("no errors in the page", pageErrors.length === 0, pageErrors[0] ?? "");
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
    console.log("\nAll focus trap checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
