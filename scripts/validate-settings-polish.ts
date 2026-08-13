/**
 * The settings area, asserted as one system rather than seven screens.
 *   npm run validate:settings-polish
 *
 * A design system that exists only in the components is a claim; this is the
 * measurement. Every check below failed at least once during the rewrite, which
 * is the only reason it is here:
 *
 *   1. The header used to be copy-pasted per screen, so its height and the
 *      title's baseline drifted by a few pixels between sections. Measured
 *      across every screen, not eyeballed on two.
 *
 *   2. Long Russian strings are the local stress test. "Завершить все другие
 *      сеансы" and a 40-character display name are what push a row into a
 *      second line or a title into the back button.
 *
 *   3. The bottom dock is `position: fixed`, so nothing about a screen's own
 *      layout tells you whether the last row is reachable. Only the rendered
 *      geometry does.
 *
 *   4. `window.confirm` renders browser chrome in the middle of an app that is
 *      trying to feel native, and it cannot be themed or trapped. The suite
 *      asserts it is never called.
 */
import { randomUUID } from "node:crypto";
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

const PORT = Number(process.env.SETTINGS_PORT ?? 4021);

/**
 * Two Playwright methods the shared harness type does not expose. Narrowed here
 * rather than widened in the harness, so no other suite inherits an optional
 * method it never calls.
 */
type PageExtras = {
  addInitScript?: (script: string) => Promise<void>;
  emulateMedia?: (options: { colorScheme: "dark" | "light" }) => Promise<void>;
};
type ContextExtras = { addInitScript?: (script: string) => Promise<void> };

/** iPhone 14 Pro logical width — the narrowest device the product supports. */
const VIEWPORT = { width: 393, height: 852 };

type ScreenSpec = { key: string; label: string; titleId: string };

const SCREENS: ScreenSpec[] = [
  { key: "profile", label: "Мой профиль", titleId: "profile-screen-profile" },
  { key: "notifications", label: "Уведомления", titleId: "profile-screen-notifications" },
  { key: "devices", label: "Устройства", titleId: "profile-screen-devices" },
  { key: "appearance", label: "Оформление", titleId: "profile-screen-appearance" },
  { key: "security", label: "Безопасность", titleId: "profile-screen-security" },
  { key: "folders", label: "Папки чатов", titleId: "profile-screen-folders" },
  { key: "data", label: "Данные и кэш", titleId: "profile-screen-data" },
];

/** Geometry of the open screen's header, so drift between screens is visible. */
const HEADER_METRICS = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  const header = dialog?.querySelector('header');
  const title = header?.querySelector('h1');
  if (!header || !title) return null;
  const h = header.getBoundingClientRect();
  const t = title.getBoundingClientRect();
  return {
    headerTop: Math.round(h.top),
    headerHeight: Math.round(h.height),
    titleCentre: Math.round(t.top + t.height / 2),
    titleLines: Math.round(t.height / parseFloat(getComputedStyle(title).lineHeight || '22')),
  };
})()`;

/** Anything wider than the viewport is a horizontal scrollbar waiting to happen. */
const OVERFLOW = `(() => {
  const limit = document.documentElement.clientWidth;
  const wide = Array.from(document.querySelectorAll('[role="dialog"] *'))
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && (rect.right > limit + 1 || rect.left < -1);
    })
    .slice(0, 4)
    .map((el) => el.tagName.toLowerCase() + '.' + String(el.className).split(' ').slice(0, 2).join('.'));
  return { docScroll: document.documentElement.scrollWidth > limit + 1, wide };
})()`;

/**
 * The palette a screen actually paints, so "one accent, neutral everything
 * else" is a measurement rather than an intention. Counts distinct saturated
 * background fills — the thing that made the old screens look like four apps.
 */
const SATURATED_FILLS = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dialog) return [];
  const seen = new Map();
  for (const el of Array.from(dialog.querySelectorAll('*'))) {
    // The accent picker is the one place whose entire job is showing colours.
    if (el.closest('[role="radiogroup"][aria-label="Акцентный цвет"]')) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 16) continue;
    const bg = getComputedStyle(el).backgroundColor;
    const m = bg.match(/rgba?\\(([^)]+)\\)/);
    if (!m) continue;
    const parts = m[1].split(',').map((n) => parseFloat(n));
    const [r, g, b] = parts;
    const alpha = parts.length > 3 ? parts[3] : 1;
    if (alpha < 0.5) continue;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    // A fill is "saturated" when its channels disagree enough to read as a hue.
    if (max - min < 40) continue;
    seen.set(bg, (seen.get(bg) ?? 0) + 1);
  }
  return Array.from(seen.entries()).map(([colour, count]) => colour + ' x' + count);
})()`;

/** The last row of the screen, versus the dock that floats over it. */
const LAST_ROW_CLEARANCE = `(() => {
  const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
  if (!dialog) return null;
  const rows = Array.from(dialog.querySelectorAll('button, label, input, a'))
    .filter((el) => el.getBoundingClientRect().height > 20);
  if (rows.length === 0) return null;
  const last = rows[rows.length - 1].getBoundingClientRect();
  const dock = document.querySelector('[data-bottom-dock], nav[aria-label], footer');
  const dockTop = dock ? dock.getBoundingClientRect().top : window.innerHeight;
  return { lastBottom: Math.round(last.bottom), dockTop: Math.round(dockTop) };
})()`;

async function openScreen(page: PageLike, spec: ScreenSpec): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const entry = page.getByText(spec.label, { exact: true }).first();
    if ((await entry.count()) > 0) {
      await entry.click({ force: true }).catch(() => undefined);
    }
    await page.waitForTimeout(350);
    const open = await page.evaluate(
      `document.querySelector('[role="dialog"][aria-labelledby="${spec.titleId}"]') !== null`,
    );
    if (open === true) return true;
  }
  return false;
}

async function closeScreen(page: PageLike): Promise<void> {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
}

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const shots = screenshotDir("settings-polish");
  const stamp = Date.now();

  // A deliberately long display name: Russian strings are the local worst case
  // for a row that assumed one line.
  const me = await seedUser(prisma, randomUUID(), `settings${stamp}`);
  await prisma.profile.update({
    where: { userId: me.id },
    data: { displayName: "Александр Константинопольский-Задунайский" },
  }).catch(() => undefined);
  const peer = await seedUser(prisma, randomUUID(), `settingsb${stamp}`);
  await seedChat(prisma, {
    id: randomUUID(),
    type: "GROUP",
    owner: me.id,
    members: [me.id, peer.id],
    title: "Очень длинное название группы для проверки переносов",
  });

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();
  const context: ContextLike = await browser.newContext({ viewport: VIEWPORT });
  const page: PageLike = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error: Error) => pageErrors.push(String(error)));

  try {
    await signIn(page, app.base, me.username);

    // `window.confirm` blocks the run and is the thing being removed, so it is
    // replaced with a recorder rather than auto-dismissed.
    await (page as PageLike & PageExtras).addInitScript?.(`
      window.__noxConfirmCalls = [];
      window.confirm = (message) => { window.__noxConfirmCalls.push(String(message)); return false; };
      window.alert = (message) => { window.__noxConfirmCalls.push('alert:' + String(message)); };
    `);

    for (const scheme of ["dark", "light"] as const) {
      await (context as ContextLike & ContextExtras).addInitScript?.(
        `localStorage.setItem('nox-theme', '${scheme}')`,
      )?.catch(() => undefined);
      await (page as PageLike & PageExtras).emulateMedia?.({ colorScheme: scheme })?.catch(() => undefined);
      await page.goto(`${app.base}/profile`, { waitUntil: "networkidle" });
      await page.evaluate(`document.documentElement.setAttribute('data-theme', '${scheme}')`);
      await page.waitForTimeout(700);

      const rootOverflow = (await page.evaluate(
        `(() => {
          const limit = document.documentElement.clientWidth;
          return document.documentElement.scrollWidth > limit + 1;
        })()`,
      )) as boolean;
      check(`[${scheme}] the settings list does not overflow ${VIEWPORT.width}px`, rootOverflow === false);
      await page.screenshot({ path: `${shots}/${scheme}-main.png` });

      // The dock floats over the list, so the last row is only reachable if the
      // page can scroll far enough to clear it.
      // Scroll whatever actually scrolls: the shell has changed which element
      // owns the overflow more than once.
      await page.evaluate(
        `(() => {
          const targets = [document.scrollingElement, document.documentElement, document.body,
            document.querySelector('.app-screen'), document.querySelector('main')];
          for (const el of targets) el?.scrollTo?.(0, 99999);
          window.scrollTo(0, 99999);
        })()`,
      );
      await page.waitForTimeout(400);
      const rootClearance = (await page.evaluate(
        `(() => {
          const rows = Array.from(document.querySelectorAll('main button, main a'))
            .filter((el) => el.getBoundingClientRect().height > 20);
          if (rows.length === 0) return null;
          const last = rows[rows.length - 1].getBoundingClientRect();
          const dock = document.querySelector('[data-bottom-dock], nav[aria-label], footer');
          const dockTop = dock ? dock.getBoundingClientRect().top : window.innerHeight;
          return { lastBottom: Math.round(last.bottom), dockTop: Math.round(dockTop) };
        })()`,
      )) as { lastBottom: number; dockTop: number } | null;
      check(
        `[${scheme}] the last row of the settings list clears the dock`,
        rootClearance === null || rootClearance.lastBottom <= rootClearance.dockTop + 1,
        JSON.stringify(rootClearance),
      );
      await page.evaluate(`window.scrollTo(0, 0)`);
      await page.waitForTimeout(250);

      const headers: Record<string, { headerTop: number; headerHeight: number; titleCentre: number; titleLines: number }> = {};

      for (const spec of SCREENS) {
        const opened = await openScreen(page, spec);
        check(`[${scheme}] «${spec.label}» opens`, opened);
        if (!opened) continue;

        await page.waitForTimeout(500);

        const metrics = (await page.evaluate(HEADER_METRICS)) as typeof headers[string] | null;
        if (metrics) headers[spec.key] = metrics;
        check(
          `[${scheme}] «${spec.label}» title stays on one line`,
          Boolean(metrics) && metrics!.titleLines <= 1,
          JSON.stringify(metrics),
        );

        const overflow = (await page.evaluate(OVERFLOW)) as { docScroll: boolean; wide: string[] };
        check(
          `[${scheme}] «${spec.label}» does not overflow ${VIEWPORT.width}px`,
          overflow.docScroll === false && overflow.wide.length === 0,
          overflow.wide.join(", "),
        );

        // Scroll to the end: the dock floats, so only the bottom of the screen
        // can show whether the last control is reachable.
        await page.evaluate(
          `document.querySelector('[role="dialog"][aria-modal="true"]')?.scrollTo(0, 99999)`,
        );
        await page.waitForTimeout(350);
        const clearance = (await page.evaluate(LAST_ROW_CLEARANCE)) as { lastBottom: number; dockTop: number } | null;
        check(
          `[${scheme}] «${spec.label}» last control clears the dock`,
          Boolean(clearance) && clearance!.lastBottom <= clearance!.dockTop + 1,
          JSON.stringify(clearance),
        );

        const fills = (await page.evaluate(SATURATED_FILLS)) as string[];
        // One accent family is the budget: the accent itself plus its tint.
        check(
          `[${scheme}] «${spec.label}» paints at most two saturated fills`,
          fills.length <= 2,
          fills.join(" | "),
        );

        await page.screenshot({ path: `${shots}/${scheme}-${spec.key}.png` });
        await closeScreen(page);
        await page.waitForTimeout(250);
      }

      // --- the header is the same object on every screen -------------------
      const values = Object.values(headers);
      if (values.length >= 2) {
        const heights = new Set(values.map((value) => value.headerHeight));
        const tops = new Set(values.map((value) => value.headerTop));
        const centres = values.map((value) => value.titleCentre);
        const centreSpread = Math.max(...centres) - Math.min(...centres);
        check(`[${scheme}] every header has one height`, heights.size === 1, [...heights].join(", "));
        check(`[${scheme}] every header sits at one offset`, tops.size === 1, [...tops].join(", "));
        check(`[${scheme}] the title never shifts between screens`, centreSpread <= 1, `spread=${centreSpread}px`);
      }
    }

    // --- nested screens: the audit must not stop at the first level --------
    await page.goto(`${app.base}/profile`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);

    const securityOpen = await openScreen(page, SCREENS.find((s) => s.key === "security")!);
    check("«Безопасность» opens", securityOpen);
    if (securityOpen) {
      for (const [label, titleId] of [
        ["Пароль", "profile-screen-password"],
        ["Ключ восстановления", "profile-screen-recovery"],
      ] as const) {
        const entry = page.getByText(label, { exact: true }).first();
        await entry.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(500);
        const open = await page.evaluate(
          `document.querySelector('[role="dialog"][aria-labelledby="${titleId}"]') !== null`,
        );
        check(`nested «${label}» opens from Безопасность`, open === true);
        if (open === true) {
          const overflow = (await page.evaluate(OVERFLOW)) as { docScroll: boolean; wide: string[] };
          check(`nested «${label}» does not overflow`, overflow.docScroll === false, overflow.wide.join(", "));
          await page.screenshot({ path: `${shots}/nested-${titleId}.png` });
          // Escape returns to Безопасность, not to the root list.
          await page.keyboard.press("Escape");
          await page.waitForTimeout(400);
          const backOnSecurity = await page.evaluate(
            `document.querySelector('[role="dialog"][aria-labelledby="profile-screen-security"]') !== null`,
          );
          check(`Escape from «${label}» returns to Безопасность`, backOnSecurity === true);
        }
      }
      await closeScreen(page);
    }

    // --- the wallpaper editor, nested under Оформление ---------------------
    const appearanceOpen = await openScreen(page, SCREENS.find((s) => s.key === "appearance")!);
    check("«Оформление» opens", appearanceOpen);
    if (appearanceOpen) {
      const entry = page.getByText("Фон чатов", { exact: true }).first();
      await entry.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(500);
      const open = await page.evaluate(
        `document.querySelector('[role="dialog"][aria-labelledby="profile-screen-wallpaper"]') !== null`,
      );
      check("nested «Фон чатов» opens from Оформление", open === true);
      if (open === true) {
        const overflow = (await page.evaluate(OVERFLOW)) as { docScroll: boolean; wide: string[] };
        check("nested «Фон чатов» does not overflow", overflow.docScroll === false, overflow.wide.join(", "));
        await page.screenshot({ path: `${shots}/nested-wallpaper.png` });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
        const backOnAppearance = await page.evaluate(
          `document.querySelector('[role="dialog"][aria-labelledby="profile-screen-appearance"]') !== null`,
        );
        check("Escape from «Фон чатов» returns to Оформление", backOnAppearance === true);
      }
      await closeScreen(page);
    }

    // --- the folder editor, which is the deepest screen in the area --------
    const foldersOpen = await openScreen(page, SCREENS.find((s) => s.key === "folders")!);
    check("«Папки чатов» opens", foldersOpen);
    if (foldersOpen) {
      const create = page.getByText("Новая папка", { exact: true }).first();
      await create.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(500);
      const editorOpen = await page.evaluate(
        `document.querySelector('[role="dialog"][aria-labelledby="folder-editor-title"]') !== null`,
      );
      check("the folder editor opens", editorOpen === true);
      if (editorOpen === true) {
        const overflow = (await page.evaluate(OVERFLOW)) as { docScroll: boolean; wide: string[] };
        check("the folder editor does not overflow", overflow.docScroll === false, overflow.wide.join(", "));
        await page.screenshot({ path: `${shots}/nested-folder-editor.png` });
        await page.keyboard.press("Escape");
        await page.waitForTimeout(350);
      }
      await closeScreen(page);
    }

    // --- destructive confirmation is in-app, never browser chrome ----------
    const dataOpen = await openScreen(page, SCREENS.find((s) => s.key === "data")!);
    check("«Данные и кэш» opens", dataOpen);
    if (dataOpen) {
      const reset = page.getByText("Сбросить ключи шифрования", { exact: true }).first();
      await reset.click({ force: true }).catch(() => undefined);
      await page.waitForTimeout(450);
      const sheet = await page.evaluate(`document.querySelector('[role="alertdialog"]') !== null`);
      check("a destructive action confirms in an in-app sheet", sheet === true);
      const sheetIsRed = await page.evaluate(
        `(() => {
          const dialog = document.querySelector('[role="alertdialog"]');
          if (!dialog) return null;
          // The confirm control carries the destructive colour; the panel does not.
          const panel = dialog.querySelector('div');
          return panel ? getComputedStyle(panel).backgroundColor : null;
        })()`,
      );
      check(
        "the confirmation panel is not itself red",
        typeof sheetIsRed === "string" && !/rgba?\(\s*2[0-9]{2},\s*[0-6][0-9],/.test(sheetIsRed),
        String(sheetIsRed),
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await closeScreen(page);
    }

    const confirmCalls = (await page.evaluate(`window.__noxConfirmCalls ?? []`)) as string[];
    check("no browser confirm dialog is used anywhere in settings", confirmCalls.length === 0, confirmCalls.join(" | "));

    check("no page error while walking settings", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));
    console.log(`\nScreenshots: ${shots}`);
  } finally {
    await browser.close();
    await app.stop();
    await prisma.$disconnect();
  }

  return failures();
}

main()
  .then((failed) => {
    if (failed > 0) {
      console.error(`\n${failed} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll settings polish checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
