/**
 * The accessibility floor, asserted in a real browser.
 *   npm run validate:a11y-basics
 *
 * Three things that source review keeps getting wrong, and only a rendered
 * page can settle:
 *
 *   1. Whether a control has an accessible name. Reading JSX tells you a
 *      `<label>` is present; it does not tell you the label is attached to
 *      anything. Five labels on the profile screen had no `htmlFor` and no
 *      input inside them, so the fields were nameless while looking labelled.
 *
 *   2. Whether focus is visible. The global ring is written with `:where()`,
 *      which has zero specificity, so any `outline-none` utility silently
 *      beats it. `.input-nox` then rebuilt a ring with `@apply ring-2` and
 *      destroyed it two lines later with an explicit `box-shadow`. Nothing in
 *      the source looks wrong; the computed style is where it shows.
 *
 *   3. Whether a widget honours the keyboard contract its role advertises.
 *      `role="menu"` promises arrow keys and Escape.
 */
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
  type BrowserLike,
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.A11Y_PORT ?? 4013);

/**
 * An approximation of the accessible-name computation: the sources that
 * actually appear in this codebase, in precedence order. It is deliberately
 * generous — anything it reports as nameless is nameless under any algorithm.
 */
const NAMELESS_CONTROLS = `(() => {
  const focusable = Array.from(document.querySelectorAll(
    'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
  ));
  const nameOf = (el) => {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join(' ').trim();
      if (text) return text;
    }
    const ariaLabel = (el.getAttribute('aria-label') ?? '').trim();
    if (ariaLabel) return ariaLabel;
    if (el.id) {
      const label = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      const text = (label?.textContent ?? '').trim();
      if (text) return text;
    }
    const wrapping = el.closest('label');
    if (wrapping) {
      const text = (wrapping.textContent ?? '').trim();
      if (text) return text;
    }
    const own = (el.textContent ?? '').trim();
    if (own) return own;
    const title = (el.getAttribute('title') ?? '').trim();
    if (title) return title;
    if (el.tagName === 'IMG') return (el.getAttribute('alt') ?? '').trim();
    return '';
  };
  return focusable
    .filter((el) => el.offsetParent !== null)
    .filter((el) => !el.closest('[inert]') && !el.closest('[aria-hidden="true"]'))
    .filter((el) => nameOf(el) === '')
    .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0]);
})()`;

/** True when the element paints something a keyboard user can see as focus. */
const HAS_FOCUS_INDICATOR = `(() => {
  const el = document.activeElement;
  if (!el) return { ok: false, why: 'nothing focused' };
  const style = getComputedStyle(el);
  const outlineWidth = parseFloat(style.outlineWidth) || 0;
  const hasOutline = outlineWidth >= 2 && style.outlineStyle !== 'none';
  // A ring drawn as a spread box-shadow: "0 0 0 2px <color>".
  const shadow = style.boxShadow || '';
  const hasRing = /(^|,)\\s*(rgba?\\([^)]*\\)\\s+)?0px 0px 0px (2|3|4)px/.test(shadow)
    || /(2|3|4)px\\s+(rgba?\\([^)]*\\))?\\s*$/.test(shadow);
  return {
    ok: hasOutline || hasRing,
    why: 'outline=' + style.outlineWidth + ' ' + style.outlineStyle + ' shadow=' + shadow.slice(0, 120),
  };
})()`;

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = await seedUser(prisma, randomUUID(), `a11y${stamp}`);
  const peer = await seedUser(prisma, randomUUID(), `a11yb${stamp}`);
  const chatId = await seedChat(prisma, {
    id: randomUUID(),
    type: "GROUP",
    owner: me.id,
    members: [me.id, peer.id],
    title: "Доступность",
  });

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();
  const context: ContextLike = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page: PageLike = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error: Error) => pageErrors.push(String(error)));

  try {
    // --- accessible names, on the public screens and the signed-in ones ----
    for (const [name, path] of [["login", "/login"], ["join", "/join"]] as const) {
      await page.goto(`${app.base}${path}`, { waitUntil: "networkidle" });
      const nameless = (await page.evaluate(NAMELESS_CONTROLS)) as string[];
      check(`every control on ${name} has a name`, nameless.length === 0, nameless.join(", "));
    }

    await signIn(page, app.base, me.username);
    for (const [name, path] of [
      ["chats", "/chats"],
      ["profile", "/profile"],
      ["contacts", "/contacts"],
      ["conversation", `/chats/${chatId}`],
      ["new chat", "/chats/new"],
    ] as const) {
      await page.goto(`${app.base}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(600);
      const nameless = (await page.evaluate(NAMELESS_CONTROLS)) as string[];
      check(`every control on ${name} has a name`, nameless.length === 0, nameless.join(", "));
    }

    // --- the focus indicator, measured rather than assumed -----------------
    await page.goto(`${app.base}/profile`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const opened = await openProfileScreen(page);
    check("the profile sub-screen opens", opened);

    if (opened) {
      await page.evaluate(`document.getElementById('profile-display-name')?.focus()`);
      const named = await page.evaluate(
        `(() => {
          const input = document.getElementById('profile-display-name');
          const label = document.querySelector('label[for="profile-display-name"]');
          return Boolean(input) && (label?.textContent ?? '').trim();
        })()`,
      );
      check("the name field is labelled by its visible label", named === "Имя", String(named));

      // focus() alone does not set :focus-visible in Chromium; a keyboard
      // interaction does, which is the state the ring belongs to.
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      const ring = (await page.evaluate(HAS_FOCUS_INDICATOR)) as { ok: boolean; why: string };
      check("a focused field paints a visible indicator", ring.ok, ring.why);

      // --- the overlay is modal in behaviour, not only in looks ------------
      const backgroundInert = await page.evaluate(
        `(() => {
          const dialog = document.querySelector('[role="dialog"][aria-labelledby="profile-screen-profile"]');
          if (!dialog) return -1;
          const all = Array.from(document.querySelectorAll('a[href], button, input, textarea'));
          return all.filter((el) => !dialog.contains(el) && !el.closest('[inert]')).length;
        })()`,
      );
      check("the page behind the sub-screen is inert", backgroundInert === 0, `reachable=${backgroundInert}`);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      const closed = await page.evaluate(
        `document.querySelector('[role="dialog"][aria-labelledby="profile-screen-profile"]') === null`,
      );
      check("Escape leaves the sub-screen", closed === true);
    }

    // --- the chat menu keeps the promise its role makes ---------------------
    await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
    const more = page.getByRole("button", { name: "Ещё" }).first();
    await more.waitFor({ state: "visible", timeout: 30_000 });

    let menuOpen = false;
    for (let attempt = 0; attempt < 20 && !menuOpen; attempt += 1) {
      await more.click();
      await page.waitForTimeout(400);
      menuOpen = (await page.evaluate(`document.querySelector('[role="menu"]') !== null`)) === true;
    }
    check("the chat menu opens", menuOpen);

    if (menuOpen) {
      const trigger = await page.evaluate(
        `document.querySelector('[aria-haspopup="menu"]') !== null`,
      );
      check("the trigger advertises the popup", trigger === true);

      await page.waitForTimeout(200);
      const onFirstItem = await page.evaluate(
        `(() => {
          const menu = document.querySelector('[role="menu"]');
          const active = document.activeElement;
          return Boolean(menu && active && menu.contains(active) && active.getAttribute('role')?.startsWith('menuitem'));
        })()`,
      );
      check("focus starts on a menu item", onFirstItem === true);

      await page.keyboard.press("ArrowDown");
      const moved = await page.evaluate(
        `(() => {
          const menu = document.querySelector('[role="menu"]');
          const items = Array.from(menu?.querySelectorAll('[role^="menuitem"]') ?? []);
          return items.indexOf(document.activeElement);
        })()`,
      );
      check("ArrowDown moves within the menu", typeof moved === "number" && moved > 0, `index=${moved}`);

      await page.keyboard.press("End");
      const atEnd = await page.evaluate(
        `(() => {
          const menu = document.querySelector('[role="menu"]');
          const items = Array.from(menu?.querySelectorAll('[role^="menuitem"]') ?? []);
          return items.length > 0 && items.indexOf(document.activeElement) === items.length - 1;
        })()`,
      );
      check("End jumps to the last item", atEnd === true);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      const gone = await page.evaluate(`document.querySelector('[role="menu"]') === null`);
      check("Escape closes the menu", gone === true);
      const backOnTrigger = await page.evaluate(
        `document.activeElement?.getAttribute('aria-label') === 'Ещё'`,
      );
      check("focus returns to the trigger", backOnTrigger === true);
    }

    check("no errors in the page", pageErrors.length === 0, pageErrors[0] ?? "");
  } finally {
    await context.close();
    await browser.close();
    await app.stop();
  }

  return failures();
}

/** Opens the "Мой профиль" sub-screen, retrying past hydration. */
async function openProfileScreen(page: PageLike): Promise<boolean> {
  const entry = page.getByText("Мой профиль", { exact: false }).first();
  if ((await entry.count()) === 0) return false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await entry.click({ force: true });
    await page.waitForTimeout(400);
    const open = await page.evaluate(
      `document.querySelector('[role="dialog"][aria-labelledby="profile-screen-profile"]') !== null`,
    );
    if (open === true) return true;
  }
  return false;
}

main()
  .then((failed) => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll accessibility checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
