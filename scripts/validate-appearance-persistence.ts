/**
 * Appearance settings survive, stay put, and stay separate.
 *   npm run validate:appearance-persistence
 *
 * The sheet suite covers the interaction; this covers the storage: one write
 * per save, the saved value still there after a reload, one conversation's
 * choice never leaking into another, reset clearing rather than half-clearing,
 * and no variables left behind from a discarded draft.
 *
 * Disposable database only.
 */
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

const PORT = Number(process.env.APPEARANCE_PERSIST_PORT ?? 4009);
const { check, failures } = createChecker();
const SHEET = ".appearance-sheet";
// The stored swatch is a preference token. Production resolves it to a deeper
// accessible bubble colour before painting white message text.
const EXPECTED_GREEN_BUBBLE = "#0c865d";

async function openSheet(page: PageLike, base: string, chatId: string) {
  await page.goto(`${base}/chats/${chatId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2_000);
  await page.getByRole("button", { name: "Ещё" }).first().click();
  await page.waitForTimeout(400);
  await page.getByRole("menuitem", { name: /Оформление чата/ }).first().click();
  await page.locator(SHEET).first().waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(400);
}

async function main() {
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = `pp-me-${stamp}`;
  const peer = `pp-peer-${stamp}`;
  const username = `pp${stamp}`;
  const chatA = `pp-a-${stamp}`;
  const chatB = `pp-b-${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, me, username);
    await seedUser(prisma, peer, `pppeer${stamp}`);
    for (const [id, title] of [[chatA, "Первый"], [chatB, "Второй"]] as const) {
      await seedChat(prisma, { id, type: "GROUP", owner: me, members: [me, peer], title });
      await prisma.message.create({ data: { chatId: id, senderUserId: peer, type: "TEXT", body: "привет" } });
    }

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    const context: ContextLike = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await signIn(page, app.base, username);

    const readStore = () =>
      page.evaluate(() =>
        Object.keys(window.localStorage)
          .filter((key) => key.startsWith("nox:chat-appearance"))
          .sort()
          .map((key) => ({ key, value: window.localStorage.getItem(key) ?? "" })),
      );

    // localStorage belongs to an origin, so the page has to be on one first.
    await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1_500);
    check("nothing is stored before anything is chosen", (await readStore()).length === 0);

    // --- a draft that is discarded must leave no trace ------------------------
    await openSheet(page, app.base, chatA);
    await page.getByRole("radio", { name: "Фиолетовый" }).first().click();
    await page.waitForTimeout(300);
    check("an in-flight draft is not written to storage", (await readStore()).length === 0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Выйти без изменений" }).first().click();
    await page.waitForTimeout(500);
    check("a discarded draft leaves nothing behind", (await readStore()).length === 0);

    // --- saving writes once, for this conversation only ----------------------
    await openSheet(page, app.base, chatA);
    await page.getByRole("radio", { name: "Зелёный" }).first().click();
    await page.waitForTimeout(250);
    await page.getByRole("radio", { name: "Мягкие" }).first().click();
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Готово" }).first().click();
    await page.waitForTimeout(700);

    const afterSave = await readStore();
    check("exactly one entry is written", afterSave.length === 1, afterSave.map((entry) => entry.key).join(", "));
    check("it belongs to this conversation", afterSave[0]?.key.includes(chatA));
    check("both changes are in the same write", /10b981/i.test(afterSave[0]?.value ?? "") && /soft/.test(afterSave[0]?.value ?? ""));

    // --- a reload keeps it ----------------------------------------------------
    await page.goto(`${app.base}/chats/${chatA}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2_000);
    const afterReload = await readStore();
    check("the settings survive a reload", afterReload.length === 1 && /10b981/i.test(afterReload[0].value));

    const appliedAfterReload = await page.evaluate(() => {
      // The conversation nests one shell inside another; the inner one carries
      // the appearance. Take the innermost rather than the first.
      const screens = Array.from(document.querySelectorAll(".chat-screen"));
      const anchor = screens[screens.length - 1] ?? document.body;
      return getComputedStyle(anchor).getPropertyValue("--bubble-outgoing-bg").trim();
    });
    if (process.env.PERSIST_DEBUG) {
      console.log(await page.evaluate(() => ({
        keys: Object.keys(window.localStorage).filter((key) => key.startsWith("nox:")),
        path: location.pathname,
        screens: Array.from(document.querySelectorAll(".chat-screen")).map((node) => ({
          computed: getComputedStyle(node).getPropertyValue("--bubble-outgoing-bg").trim(),
          inline: (node as HTMLElement).style.getPropertyValue("--bubble-outgoing-bg"),
        })),
        stored: window.localStorage.getItem(Object.keys(window.localStorage).find((key) => key.startsWith("nox:chat-appearance")) ?? ""),
      })));
    }
    check(
      "and are applied to the conversation",
      appliedAfterReload.toLowerCase() === EXPECTED_GREEN_BUBBLE,
      appliedAfterReload,
    );

    // --- the other conversation is untouched ---------------------------------
    await page.goto(`${app.base}/chats/${chatB}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2_000);
    const other = await page.evaluate(
      (id) => window.localStorage.getItem(`nox:chat-appearance:${id}:v2`),
      chatB,
    );
    check("the other conversation has no settings of its own", other === null, String(other));
    const otherApplied = await page.evaluate(() => {
      // The conversation nests one shell inside another; the inner one carries
      // the appearance. Take the innermost rather than the first.
      const screens = Array.from(document.querySelectorAll(".chat-screen"));
      const anchor = screens[screens.length - 1] ?? document.body;
      return getComputedStyle(anchor).getPropertyValue("--bubble-outgoing-bg").trim();
    });
    check(
      "and does not inherit the first one's colour",
      otherApplied.toLowerCase() !== EXPECTED_GREEN_BUBBLE,
      otherApplied,
    );

    // --- reset ----------------------------------------------------------------
    await openSheet(page, app.base, chatA);
    await page.getByRole("button", { name: "Сбросить" }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Готово" }).first().click();
    await page.waitForTimeout(700);

    const afterReset = await readStore();
    check("reset writes the defaults rather than half of them", afterReset.length === 1 && /3b82f6/i.test(afterReset[0].value));
    check("reset clears the custom shape too", /round/.test(afterReset[0]?.value ?? ""), afterReset[0]?.value.slice(0, 60));

    const appliedAfterReset = await page.evaluate(() => {
      // The conversation nests one shell inside another; the inner one carries
      // the appearance. Take the innermost rather than the first.
      const screens = Array.from(document.querySelectorAll(".chat-screen"));
      const anchor = screens[screens.length - 1] ?? document.body;
      return getComputedStyle(anchor).getPropertyValue("--bubble-outgoing-bg").trim();
    });
    check(
      "no stale variable is left applied",
      appliedAfterReset.toLowerCase() !== EXPECTED_GREEN_BUBBLE,
      appliedAfterReset,
    );

    // --- a corrupted entry must not take the conversation down ---------------
    await page.evaluate((id) => window.localStorage.setItem(`nox:chat-appearance:${id}:v2`, "{not json"), chatA);
    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message.split("\n")[0]));
    await page.goto(`${app.base}/chats/${chatA}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2_000);
    check("a corrupted entry falls back instead of crashing", errors.length === 0, errors.join(" | "));
    check("the conversation still renders", (await page.locator("textarea, input[type=text]").first().count()) >= 1);

    await context.close();
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
    console.log("\nAll appearance persistence checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
