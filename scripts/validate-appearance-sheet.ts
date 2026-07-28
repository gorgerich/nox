/**
 * The appearance sheet, driven as a user drives it.
 *   npm run validate:appearance-sheet
 *
 * What this is really testing is that the sheet is a modal: the dock cannot be
 * reached through it, the background does not scroll, focus stays inside,
 * Escape closes it, and the two colour schemes stay separate — the chrome
 * follows the app, the preview follows the chat. Then that the controls do
 * what they say, and that leaving with unsaved changes asks first.
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

const PORT = Number(process.env.APPEARANCE_PORT ?? 4007);
const { check, failures } = createChecker();

const SHEET = ".appearance-sheet";
const PREVIEW = ".appearance-preview";

async function openSheet(page: PageLike, base: string, chatId: string) {
  await page.goto(`${base}/chats/${chatId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2_000);
  // It lives behind the conversation header's overflow menu, which is where a
  // user finds it — driving the real path rather than calling the handler.
  await page.getByRole("button", { name: "Ещё" }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: /Оформление чата/ }).first().click();
  await page.locator(SHEET).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir("messenger-ui");
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = `ap-me-${stamp}`;
  const peer = `ap-peer-${stamp}`;
  const username = `ap${stamp}`;
  const chatId = `ap-chat-${stamp}`;
  const otherChatId = `ap-chat2-${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, me, username);
    await seedUser(prisma, peer, `appeer${stamp}`);
    for (const id of [chatId, otherChatId]) {
      await seedChat(prisma, { id, type: "GROUP", owner: me, members: [me, peer], title: id === chatId ? "Оформление" : "Второй чат" });
      await prisma.message.create({ data: { chatId: id, senderUserId: peer, type: "TEXT", body: "привет" } });
    }

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    let session: Record<string, unknown> | null = null;

    const context = async (options: Record<string, unknown>): Promise<ContextLike> =>
      browser!.newContext(session ? { ...options, storageState: session } : options);

    // --- opening, layering, focus -------------------------------------------
    {
      const ctx = await context({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
      await ctx.addInitScript(`
        window.__dockHidden = false;
        window.addEventListener("nox:dock-visibility", (event) => {
          window.__dockHidden = Boolean(event.detail && event.detail.hidden);
        });
      `);
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message.split("\n")[0]));
      if (!session) await signIn(page, app.base, username);
      await openSheet(page, app.base, chatId);
      if (!session) session = await ctx.storageState();

      check("the sheet opens", (await page.locator(SHEET).count()) === 1);
      // Counting the element is not enough: a collapsed preview passes that and
      // shows the user nothing.
      if (process.env.APPEARANCE_DEBUG) {
        console.log(await page.evaluate(() => {
          const preview = document.querySelector(".appearance-preview");
          const surface = document.querySelector(".appearance-preview-surface");
          const bubble = document.querySelector(".appearance-preview-bubble-in");
          return {
            previewChildren: preview?.children.length ?? -1,
            surfaceChildren: surface?.children.length ?? -1,
            surfaceHeight: surface ? Math.round(surface.getBoundingClientRect().height) : -1,
            surfaceDisplay: surface ? getComputedStyle(surface).display : "",
            bubbleHeight: bubble ? Math.round(bubble.getBoundingClientRect().height) : -1,
            bubbleDisplay: bubble ? getComputedStyle(bubble).display : "",
            bubbleText: (bubble?.textContent ?? "").slice(0, 40),
          };
        }));
      }
      const previewBox = await page.locator(PREVIEW).first().boundingBox();
      check("a live preview is shown", (await page.locator(PREVIEW).count()) === 1);
      check(
        "the preview is actually visible",
        Boolean(previewBox && previewBox.height > 120 && previewBox.width > 200),
        `${Math.round(previewBox?.width ?? 0)}x${Math.round(previewBox?.height ?? 0)}`,
      );

      const layering = await page.evaluate(() => {
        const dock = document.querySelector('nav[aria-label="Нижняя навигация"]');
        const sheet = document.querySelector(".appearance-sheet");
        const backdrop = document.querySelector(".appearance-backdrop");
        const dockRect = dock?.getBoundingClientRect();
        return {
          dockHideRequested: (window as unknown as { __dockHidden?: boolean }).__dockHidden === true,
          dockPresent: Boolean(dock),
          dockVisible: Boolean(dockRect && dockRect.width > 0 && dockRect.height > 0),
          backdropCoversViewport:
            Boolean(backdrop) &&
            backdrop!.getBoundingClientRect().width >= window.innerWidth - 1 &&
            backdrop!.getBoundingClientRect().height >= window.innerHeight - 1,
          bodyOverflowY: getComputedStyle(document.body).overflowY,
          sheetZ: sheet ? Number(getComputedStyle(sheet.parentElement!).zIndex) : 0,
        };
      });
      // The dock is already absent on a conversation route by product design,
      // so "not visible" alone would pass for the wrong reason. What the sheet
      // must do is ask for it to be hidden and put itself above every app
      // surface — both of which are checked here.
      check("the dock is not showing through the sheet", !layering.dockVisible);
      check("the sheet asks the dock to hide", layering.dockHideRequested, String(layering.dockHideRequested));
      check("the backdrop covers the viewport", layering.backdropCoversViewport);
      check("background scroll is locked", layering.bodyOverflowY === "hidden", layering.bodyOverflowY);
      check("the sheet sits above app surfaces", layering.sheetZ >= 1000, String(layering.sheetZ));
      await page.screenshot({ path: join(shots, "appearance-dock-hidden.png") });
      await page.screenshot({ path: join(shots, "appearance-light.png") });

      // Focus is trapped: tabbing many times must never leave the sheet.
      let escaped = false;
      for (let index = 0; index < 25; index += 1) {
        await page.keyboard.press("Tab");
        const inside = await page.evaluate(() => Boolean(document.activeElement?.closest(".appearance-sheet")));
        if (!inside) {
          escaped = true;
          break;
        }
      }
      check("focus stays inside the sheet", !escaped);

      // The sheet body scrolls even though the page does not.
      // Scrolled the way a user does — a wheel over the sheet — rather than by
      // assigning scrollTop, which a scroll container can quietly ignore.
      const bodyBox = await page.locator(".appearance-body").first().boundingBox();
      if (bodyBox) {
        await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + bodyBox.height / 2);
        await page.mouse.wheel(0, 240);
      }
      await page.waitForTimeout(400);
      const scrolls = await page.evaluate(() => {
        const body = document.querySelector(".appearance-body") as HTMLElement | null;
        if (!body) return { scrolled: false, scrollHeight: 0, clientHeight: 0 };
        return { scrolled: body.scrollTop > 0, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight };
      });
      check(
        "the sheet scrolls internally",
        scrolls.scrolled,
        `content=${scrolls.scrollHeight} viewport=${scrolls.clientHeight}`,
      );

      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      check("Escape closes an unchanged sheet", (await page.locator(SHEET).count()) === 0);
      check(
        "closing releases the dock again",
        await page.evaluate(() => (window as unknown as { __dockHidden?: boolean }).__dockHidden === false),
      );
      check("no page errors", errors.length === 0, errors.join(" | "));
      await ctx.close();
    }

    // --- the controls --------------------------------------------------------
    {
      const ctx = await context({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
      const page = await ctx.newPage();
      await openSheet(page, app.base, chatId);

      const readPreview = () =>
        page.evaluate(() => {
          const preview = document.querySelector(".appearance-preview") as HTMLElement | null;
          const out = document.querySelector(".appearance-preview-bubble-out") as HTMLElement | null;
          const bubble = out ? getComputedStyle(out) : null;
          return {
            scheme: preview?.getAttribute("data-chat-scheme") ?? "",
            outgoing: bubble?.backgroundColor ?? "",
            radius: bubble?.borderTopLeftRadius ?? "",
            background: preview ? getComputedStyle(preview).backgroundColor : "",
          };
        });

      const before = await readPreview();
      if (process.env.APPEARANCE_DEBUG) {
        console.log(await page.evaluate(() => {
          const preview = document.querySelector(".appearance-preview") as HTMLElement | null;
          const out = document.querySelector(".appearance-preview-bubble-out") as HTMLElement | null;
          return {
            inlineVar: preview?.style.getPropertyValue("--bubble-outgoing-bg"),
            computedVar: preview ? getComputedStyle(preview).getPropertyValue("--bubble-outgoing-bg") : "",
            outVar: out ? getComputedStyle(out).getPropertyValue("--bubble-outgoing-bg") : "",
            radioNames: Array.from(document.querySelectorAll('[role="radio"]')).map((n) => n.getAttribute("aria-label")).slice(0, 24),
          };
        }));
      }

      // Outgoing colour.
      await page.getByRole("radio", { name: "Зелёный" }).first().click();
      await page.waitForTimeout(350);
      const afterColour = await readPreview();
      check("choosing an outgoing colour changes the preview", afterColour.outgoing !== before.outgoing, `${before.outgoing} → ${afterColour.outgoing}`);
      await page.screenshot({ path: join(shots, "appearance-outgoing-colors.png") });

      // Bubble shape.
      await page.getByRole("radio", { name: "Мягкие" }).first().click();
      await page.waitForTimeout(350);
      const afterRadius = await readPreview();
      check("changing the shape changes the preview", afterRadius.radius !== afterColour.radius, `${afterColour.radius} → ${afterRadius.radius}`);
      await page.screenshot({ path: join(shots, "appearance-radius.png") });

      // Incoming style: the three options must be visibly different.
      const incomingStyles: string[] = [];
      for (const style of ["Заливка", "Стекло", "Без заливки"]) {
        await page.getByRole("radio", { name: style }).first().click();
        await page.waitForTimeout(300);
        incomingStyles.push(
          await page.evaluate(() => {
            const bubble = document.querySelector(".appearance-preview-bubble-in") as HTMLElement | null;
            if (!bubble) return "";
            const styles = getComputedStyle(bubble);
            return `${styles.backgroundColor}|${styles.borderTopWidth}|${styles.backdropFilter}`;
          }),
        );
      }
      check("the three incoming styles differ", new Set(incomingStyles).size === 3, incomingStyles.join(" / "));
      await page.screenshot({ path: join(shots, "appearance-incoming-styles.png") });

      // Wallpaper.
      await page.getByRole("radio", { name: "Орбиты" }).first().click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(shots, "appearance-wallpapers.png") });

      // A dark chat theme in a light app: the preview darkens, the sheet does not.
      await page.getByRole("radio", { name: /Полночь/ }).first().click();
      await page.waitForTimeout(400);
      const split = await page.evaluate(() => {
        const preview = document.querySelector(".appearance-preview") as HTMLElement | null;
        const sheet = document.querySelector(".appearance-sheet") as HTMLElement | null;
        // Written without a named helper: the transpiler injects a `__name`
        // shim into named functions, and that shim does not exist in the page.
        const previewMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
          preview ? getComputedStyle(preview).backgroundColor : "",
        );
        const sheetMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
          sheet ? getComputedStyle(sheet).backgroundColor : "",
        );
        return {
          previewScheme: preview?.getAttribute("data-chat-scheme") ?? "",
          previewBrightness: previewMatch ? Number(previewMatch[1]) + Number(previewMatch[2]) + Number(previewMatch[3]) : -1,
          sheetBrightness: sheetMatch ? Number(sheetMatch[1]) + Number(sheetMatch[2]) + Number(sheetMatch[3]) : -1,
        };
      });
      check("a dark chat theme darkens the preview", split.previewScheme === "dark", split.previewScheme);
      check(
        "a dark chat theme leaves the sheet light",
        split.sheetBrightness > split.previewBrightness,
        `sheet=${split.sheetBrightness} preview=${split.previewBrightness}`,
      );
      await page.screenshot({ path: join(shots, "appearance-dark-preview-light-app.png") });

      // Leaving with unsaved changes asks first.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      check("a dirty sheet does not close silently", (await page.locator(SHEET).count()) === 1);
      check("it asks what to do", (await page.getByText("Сохранить оформление?", { exact: false }).count()) === 1);
      await page.screenshot({ path: join(shots, "appearance-dirty-exit.png") });

      // Discard leaves the conversation as it was.
      await page.getByRole("button", { name: "Выйти без изменений" }).first().click();
      await page.waitForTimeout(600);
      check("discarding closes the sheet", (await page.locator(SHEET).count()) === 0);
      const persistedAfterDiscard = await page.evaluate(
        (id) => window.localStorage.getItem(`nox:chat-appearance:${id}:v2`),
        chatId,
      );
      check("discarding writes nothing", persistedAfterDiscard === null, String(persistedAfterDiscard));

      await ctx.close();
    }

    // --- saving, persistence and isolation between conversations -------------
    {
      const ctx = await context({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
      const page = await ctx.newPage();
      await openSheet(page, app.base, chatId);

      await page.getByRole("radio", { name: "Зелёный" }).first().click();
      await page.waitForTimeout(300);
      const done = page.getByRole("button", { name: "Готово" }).first();
      check("«Готово» is enabled once something changed", await done.isEnabled());
      await done.click();
      await page.waitForTimeout(700);
      check("saving closes the sheet", (await page.locator(SHEET).count()) === 0);

      const saved = await page.evaluate((id) => window.localStorage.getItem(`nox:chat-appearance:${id}:v2`), chatId);
      check("the settings are persisted", Boolean(saved && /10b981/i.test(saved)), String(saved).slice(0, 80));

      // Reload: still there.
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2_000);
      const afterReload = await page.evaluate((id) => window.localStorage.getItem(`nox:chat-appearance:${id}:v2`), chatId);
      check("the settings survive a reload", Boolean(afterReload && /10b981/i.test(afterReload)));

      // A different conversation must not inherit them.
      const otherSaved = await page.evaluate(
        (id) => window.localStorage.getItem(`nox:chat-appearance:${id}:v2`),
        otherChatId,
      );
      check("another conversation keeps its own settings", otherSaved === null, String(otherSaved));

      // Reset returns to the defaults.
      await openSheet(page, app.base, chatId);
      await page.getByRole("button", { name: "Сбросить" }).first().click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(shots, "appearance-reset.png") });
      await page.getByRole("button", { name: "Готово" }).first().click();
      await page.waitForTimeout(700);
      const afterReset = await page.evaluate((id) => window.localStorage.getItem(`nox:chat-appearance:${id}:v2`), chatId);
      check("reset stores the defaults", Boolean(afterReset && /3b82f6/i.test(afterReset)), String(afterReset).slice(0, 80));
      await ctx.close();
    }

    // --- sizes, and dark ------------------------------------------------------
    for (const viewport of [
      { name: "320", width: 320, height: 568 },
      { name: "375", width: 375, height: 667 },
      { name: "430", width: 430, height: 932 },
      { name: "desktop", width: 1280, height: 900 },
    ]) {
      const ctx = await context({ viewport: { width: viewport.width, height: viewport.height }, colorScheme: "light" });
      const page = await ctx.newPage();
      await openSheet(page, app.base, chatId);

      const geometry = await page.evaluate(() => {
        const sheet = document.querySelector(".appearance-sheet") as HTMLElement | null;
        const footer = document.querySelector(".appearance-footer") as HTMLElement | null;
        const cards = Array.from(document.querySelectorAll(".appearance-card")) as HTMLElement[];
        const tops = new Set(cards.map((card) => Math.round(card.getBoundingClientRect().top)));
        return {
          sheetHeight: sheet ? Math.round(sheet.getBoundingClientRect().height) : 0,
          viewportHeight: window.innerHeight,
          footerVisible: footer ? footer.getBoundingClientRect().bottom <= window.innerHeight + 1 : false,
          cardRows: tops.size,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          smallTargets: Array.from(document.querySelectorAll(".appearance-sheet button")).filter(
            (node) => node.getBoundingClientRect().height < 40 && node.getBoundingClientRect().height > 0,
          ).length,
        };
      });

      check(`${viewport.name}: the sheet uses the height available`, geometry.sheetHeight >= geometry.viewportHeight * 0.7, `${geometry.sheetHeight}/${geometry.viewportHeight}`);
      check(`${viewport.name}: the footer is reachable`, geometry.footerVisible);
      check(`${viewport.name}: theme cards stay on one row`, geometry.cardRows <= 2, `rows=${geometry.cardRows}`);
      check(`${viewport.name}: no horizontal overflow`, geometry.overflow === false);
      check(`${viewport.name}: touch targets are big enough`, geometry.smallTargets === 0, `small=${geometry.smallTargets}`);

      if (viewport.name === "320") await page.screenshot({ path: join(shots, "appearance-small-320.png") });
      if (viewport.name === "desktop") await page.screenshot({ path: join(shots, "appearance-desktop.png") });
      await ctx.close();
    }

    // Dark app: the sheet is dark, and a light chat theme keeps the preview light.
    {
      const ctx = await context({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
      const page = await ctx.newPage();
      await openSheet(page, app.base, chatId);
      await page.screenshot({ path: join(shots, "appearance-dark.png") });

      await page.getByRole("radio", { name: /Молоко|Лёд/ }).first().click();
      await page.waitForTimeout(400);
      const split = await page.evaluate(() => {
        const preview = document.querySelector(".appearance-preview") as HTMLElement | null;
        const sheet = document.querySelector(".appearance-sheet") as HTMLElement | null;
        // Written without a named helper: the transpiler injects a `__name`
        // shim into named functions, and that shim does not exist in the page.
        const previewMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
          preview ? getComputedStyle(preview).backgroundColor : "",
        );
        const sheetMatch = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(
          sheet ? getComputedStyle(sheet).backgroundColor : "",
        );
        return {
          previewScheme: preview?.getAttribute("data-chat-scheme") ?? "",
          previewBrightness: previewMatch ? Number(previewMatch[1]) + Number(previewMatch[2]) + Number(previewMatch[3]) : -1,
          sheetBrightness: sheetMatch ? Number(sheetMatch[1]) + Number(sheetMatch[2]) + Number(sheetMatch[3]) : -1,
        };
      });
      check("a dark app keeps the sheet dark", split.sheetBrightness < 200, String(split.sheetBrightness));
      check(
        "a light chat theme keeps the preview light in a dark app",
        split.previewBrightness > split.sheetBrightness,
        `preview=${split.previewBrightness} sheet=${split.sheetBrightness}`,
      );
      await page.screenshot({ path: join(shots, "appearance-light-preview-dark-app.png") });
      await ctx.close();
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
    console.log("\nAll appearance sheet checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
