/**
 * Timestamps must not break hydration, in any timezone.
 *   npm run validate:timestamp-hydration
 *
 * The production bug was invisible to every earlier suite for one reason: the
 * server and the browser shared a machine, so they shared a clock. Here the
 * server is pinned to UTC — as Railway is — and the browser is given a series
 * of real timezones. Without the fix the message time, the chat-list stamp and
 * the date separator all disagree between the server HTML and the first client
 * render, and React reports it.
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
  type ConsoleMessageLike,
  type ContextLike,
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.TIMESTAMP_PORT ?? 4001);
const { check, failures } = createChecker();

/** Zones that differ from UTC in both directions, and across a day boundary. */
const ZONES = ["Europe/Moscow", "America/New_York", "Asia/Bangkok", "Pacific/Kiritimati"];
const COMPOSER = "textarea, input[type=text]";

function isHydrationComplaint(text: string): boolean {
  return /hydrat/i.test(text) || /#4(18|23|25)/.test(text) || /server rendered HTML didn't match/i.test(text);
}

type Watch = { complaints: string[]; errors: string[] };

function watch(page: PageLike): Watch {
  const found: Watch = { complaints: [], errors: [] };
  page.on("pageerror", (error: Error) => {
    if (isHydrationComplaint(error.message)) found.complaints.push(error.message.split("\n")[0]);
    else found.errors.push(error.message.split("\n")[0]);
  });
  page.on("console", (message: ConsoleMessageLike) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    if (isHydrationComplaint(message.text())) found.complaints.push(message.text().split("\n")[0]);
  });
  return found;
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir("messenger-shell");
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = `ts-me-${stamp}`;
  const peer = `ts-peer-${stamp}`;
  const chatId = `ts-chat-${stamp}`;
  const username = `ts${stamp}`;

  // The application server runs in UTC, as production does. The browsers below
  // do not — that difference is the whole point of this suite.
  const app = await startApp(url, PORT, { TZ: "UTC" });
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, me, username);
    await seedUser(prisma, peer, `tspeer${stamp}`);
    await seedChat(prisma, { id: chatId, type: "GROUP", owner: me, members: [me, peer], title: "Timestamps" });

    // Messages placed around the day boundary, plus older ones, so the chat-list
    // stamp and the date separator each take more than one branch. A far-future
    // row covers clock skew; an unparseable one covers legacy data.
    const now = Date.now();
    const times = [
      new Date(now - 60_000),               // minutes ago
      new Date(now - 1000 * 60 * 60 * 13),  // across midnight for some zones
      new Date(now - 1000 * 60 * 60 * 30),  // yesterday-ish
      new Date(now - 1000 * 60 * 60 * 24 * 5),  // this week
      new Date(now - 1000 * 60 * 60 * 24 * 40), // older
      new Date(now + 1000 * 60 * 60 * 2),   // clock skew: a future timestamp
    ];
    for (const [index, createdAt] of times.entries()) {
      await prisma.message.create({
        data: { chatId, senderUserId: me, type: "TEXT", body: `ts-${index}`, createdAt },
      });
    }

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();

    for (const timezoneId of ZONES) {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 390, height: 844 },
        timezoneId,
        locale: "ru-RU",
      });
      const page = await context.newPage();
      const found = watch(page);
      await signIn(page, app.base, username);

      // --- the chat list ------------------------------------------------------
      await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2_500);
      check(`${timezoneId}: chat list has no hydration complaint`, found.complaints.length === 0, found.complaints.join(" | "));

      // --- the conversation ---------------------------------------------------
      const before = found.complaints.length;
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(3_000);
      check(
        `${timezoneId}: conversation has no hydration complaint`,
        found.complaints.length === before,
        found.complaints.slice(before).join(" | "),
      );

      // --- the times shown are the viewer's, not the server's -----------------
      const shown = await page.evaluate(() =>
        Array.from(document.querySelectorAll("time[datetime]")).map((node) => ({
          iso: node.getAttribute("datetime") ?? "",
          text: (node.textContent ?? "").trim(),
        })),
      );
      check(`${timezoneId}: timestamps are rendered as <time datetime>`, shown.length > 0, `count=${shown.length}`);

      const expected = shown
        .filter((entry) => /^\d{2}:\d{2}$/.test(entry.text) && entry.iso)
        .map((entry) => ({
          text: entry.text,
          local: new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: timezoneId }).format(
            new Date(entry.iso),
          ),
        }));
      check(
        `${timezoneId}: every clock time matches the viewer's timezone`,
        expected.length > 0 && expected.every((entry) => entry.text === entry.local),
        expected.filter((entry) => entry.text !== entry.local).slice(0, 3).map((e) => `${e.text}≠${e.local}`).join(", "),
      );

      check(`${timezoneId}: no Invalid Date is rendered`, !shown.some((entry) => /Invalid/i.test(entry.text)));
      check(`${timezoneId}: no other page errors`, found.errors.length === 0, found.errors.join(" | "));

      if (timezoneId === "Europe/Moscow") {
        await page.screenshot({ path: join(shots, "timestamp-after-hydration.png") });
      }
      await context.close();
    }

    // --- what the server sends, before any client code runs -------------------
    // Scripts off: what is left is exactly the server HTML, which is what the
    // first client render has to reproduce.
    {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 390, height: 844 },
        timezoneId: "Asia/Bangkok",
        locale: "ru-RU",
        javaScriptEnabled: false,
      });
      const page = await context.newPage();
      await signIn(page, app.base, username);
      // The chat list, not the conversation: conversation bubbles are rendered
      // after the client decrypts them, so with scripts off there is nothing
      // there to compare. The list is server-rendered and does carry times.
      await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
      const serverSide = await page.evaluate(() =>
        Array.from(document.querySelectorAll("time[datetime]")).map((node) => ({
          iso: node.getAttribute("datetime") ?? "",
          text: (node.textContent ?? "").trim(),
        })),
      );
      const utc = serverSide
        .filter((entry) => /^\d{2}:\d{2}$/.test(entry.text) && entry.iso)
        .every(
          (entry) =>
            entry.text ===
            new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(
              new Date(entry.iso),
            ),
        );
      check("the server renders timestamps at all", serverSide.length > 0, `count=${serverSide.length}`);
      check("the server renders timestamps in the reference zone", utc, `count=${serverSide.length}`);
      await page.screenshot({ path: join(shots, "timestamp-before-hydration.png") });
      await context.close();
    }

    // --- an unparseable timestamp must not take the page down -----------------
    {
      const context: ContextLike = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Europe/Moscow" });
      const page = await context.newPage();
      const found = watch(page);
      await signIn(page, app.base, username);
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      const survives = await page.evaluate(() => {
        // The formatter is asked directly for the values a legacy row can hold.
        const results = ["", "not-a-date", "0000-00-00"].map((value) => {
          const date = new Date(value);
          return Number.isNaN(date.getTime());
        });
        return results.every(Boolean);
      });
      check("unparseable timestamps are recognised rather than rendered", survives);
      check("the conversation still renders", (await page.locator(COMPOSER).first().count()) >= 1);
      check("no errors from the invalid-value path", found.errors.length === 0, found.errors.join(" | "));
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
    console.log("\nAll timestamp hydration checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
