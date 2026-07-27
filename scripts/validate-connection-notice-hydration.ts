/**
 * Hydration cleanliness of the conversation screen.
 *   npm run validate:connection-notice-hydration
 *
 * InlineConnectionNotice renders from the socket's connected flag. The server
 * always renders "not connected"; by the time React hydrates, the socket is
 * often already up — so the two markups disagreed and React threw away the
 * server tree. The fix renders nothing on either side until hydration, then
 * shows the real state.
 *
 * This suite asserts zero hydration warnings across the states that used to
 * produce them, and does so against the disposable database only.
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
  type PageLike,
} from "./lib/browser-harness";

const PORT = Number(process.env.HYDRATION_PORT ?? 3989);
const { check, failures } = createChecker();

/** Anything React says about hydration, however it is worded. */
function isHydrationComplaint(text: string): boolean {
  return /hydrat/i.test(text) || /server rendered HTML didn't match/i.test(text);
}

type Watcher = { complaints: string[]; errors: string[]; details: string[] };

function watch(page: PageLike): Watcher {
  const watcher: Watcher = { complaints: [], errors: [], details: [] };
  page.on("pageerror", (error: Error) => {
    if (isHydrationComplaint(error.message)) {
      watcher.complaints.push(error.message.split("\n")[0]);
      watcher.details.push(error.message);
    } else {
      watcher.errors.push(error.message.split("\n")[0]);
    }
  });
  page.on("console", (message: ConsoleMessageLike) => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    if (isHydrationComplaint(message.text())) watcher.complaints.push(message.text().split("\n")[0]);
  });
  return watcher;
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = `hyd-me-${stamp}`;
  const peer = `hyd-peer-${stamp}`;
  const chatId = `hyd-chat-${stamp}`;
  const directId = `hyd-direct-${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, me, `hydme${stamp}`);
    await seedUser(prisma, peer, `hydpeer${stamp}`);
    await seedChat(prisma, { id: chatId, type: "GROUP", owner: me, members: [me, peer], title: "Hydration" });
    // A one-to-one conversation renders the peer's presence in the header,
    // which is a second source of server/client disagreement.
    await seedChat(prisma, { id: directId, type: "DIRECT", owner: me, members: [me, peer] });

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 430, height: 900 } });

    const open = async (path: string) => {
      const page = await context.newPage();
      const watcher = watch(page);
      await page.goto(`${app.base}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2_500);
      return { page, watcher };
    };

    const first = await context.newPage();
    check("harness signs in", (await signIn(first, app.base, `hydme${stamp}`)).ok());
    await first.close();

    // 1 — the ordinary case: online, socket connects during or before hydration
    {
      const { page, watcher } = await open(`/chats/${chatId}`);
      check("online: no hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      check("online: no other page errors", watcher.errors.length === 0, watcher.errors.join(" | "));
      await page.screenshot({ path: join(shots, "hydration-online.png") });
      await page.close();
    }

    // 2 — reload, which is where the mismatch was originally observed
    {
      const { page, watcher } = await open(`/chats/${chatId}`);
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(2_500);
      check("reload: no hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      await page.close();
    }

    // 3 — the socket never connects, so the banner is showing at first paint.
    // This is the mirror of the original bug: previously either side of the
    // connected/not-connected split could be the one that disagreed.
    {
      await context.route("**/socket.io/**", (route) => route.abort());
      const { page, watcher } = await open(`/chats/${chatId}`);
      check("socket down at first paint: no hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      const reconnecting = page.getByText("Восстанавливаем соединение…", { exact: true });
      check("socket down at first paint: the notice is shown", (await reconnecting.count()) === 1);
      await page.screenshot({ path: join(shots, "hydration-reconnecting.png") });
      await page.close();
      await context.unroute("**/socket.io/**");
    }

    // 4 — a direct link, no client-side navigation before it
    {
      const { page, watcher } = await open(`/chats/${chatId}`);
      check("direct link: no hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      await page.close();
    }

    // 4b — a one-to-one conversation, whose header renders peer presence
    {
      const { page, watcher } = await open(`/chats/${directId}`);
      if (watcher.complaints.length > 0 && process.env.HYDRATION_VERBOSE) console.log(watcher.details.join("\n"));
      check("direct conversation: no hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      await page.close();
    }

    // 5 — the chat list, which mounts the same providers
    {
      const { page, watcher } = await open("/chats");
      check("chat list: no hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      await page.close();
    }

    // 6 — dark scheme, since the notice is themed
    {
      const darkContext = await browser.newContext({ viewport: { width: 430, height: 900 }, colorScheme: "dark" });
      const page = await darkContext.newPage();
      const watcher = watch(page);
      await signIn(page, app.base, `hydme${stamp}`);
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2_500);
      check("dark: no hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      await page.screenshot({ path: join(shots, "hydration-dark.png") });
      await darkContext.close();
    }

    // 7 — the banner still works after hydration; the fix must not silence it
    {
      const page = await context.newPage();
      const watcher = watch(page);
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1_500);
      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.waitForTimeout(1_200);
      const banner = page.getByText("Нет подключения к сети", { exact: true });
      check("the notice still appears once offline after hydration", (await banner.count()) === 1);
      check("showing the notice does not produce a hydration complaint", watcher.complaints.length === 0, watcher.complaints.join(" | "));
      await page.screenshot({ path: join(shots, "hydration-offline-banner.png") });
      await context.setOffline(false);
      await page.close();
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
    console.log("\nAll connection-notice hydration checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
