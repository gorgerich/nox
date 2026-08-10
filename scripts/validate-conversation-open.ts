/**
 * How a conversation opens.
 *   npm run validate:conversation-open
 *
 * A messenger opens on its newest message. That is not a preference, it is
 * what the screen is for, and it was broken in a way no screenshot and no type
 * check could show.
 *
 * The history is not server-rendered in full; the opening scroll used to run
 * on a timer from mount — 0ms, 100ms, 240ms — while the messages arrived at
 * 3673ms. All three fired against an empty list. The conversation opened at
 * its oldest loaded message, the scroll handler read `scrollTop === 0` as "the
 * user is at the top" and pulled in a page of older history nobody had
 * scrolled to, and the prepend moved everything down: a layout shift of 0.799
 * out of a total of 0.879.
 *
 * Every one of those is asserted here, because every one of them is a single
 * line away from coming back.
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

const PORT = Number(process.env.CONVERSATION_OPEN_PORT ?? 4019);
const MESSAGES = 120;

/** Records what the page does to itself while it opens. */
const WATCH = `
  window.__cls = 0;
  window.__pagedWhileOpening = 0;
  window.__opened = performance.now() + 1e9;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    // Older-history pagination while the conversation is still opening is the
    // symptom: nobody has scrolled yet, so nothing should be paged in.
    if (String(args[0]).includes('before=')) window.__pagedWhileOpening += 1;
    return originalFetch.apply(this, args);
  };
`;

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = await seedUser(prisma, randomUUID(), `open${stamp}`);
  const peer = await seedUser(prisma, randomUUID(), `openb${stamp}`);
  const chatId = await seedChat(prisma, {
    id: randomUUID(),
    type: "GROUP",
    owner: me.id,
    members: [me.id, peer.id],
    title: "Открытие",
  });
  // Enough history that the list scrolls, and a recognisable newest message.
  for (let index = 0; index < MESSAGES; index += 1) {
    await prisma.message.create({
      data: {
        chatId,
        senderUserId: index % 2 === 0 ? me.id : peer.id,
        type: "TEXT",
        body: index === MESSAGES - 1 ? "ПОСЛЕДНЕЕ СООБЩЕНИЕ" : `Сообщение номер ${index + 1}`,
        createdAt: new Date(Date.now() - (MESSAGES - index) * 60_000),
      },
    });
  }

  const app = await startApp(url, PORT, { NODE_ENV: "production" });
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();
  const context: ContextLike = await browser.newContext({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await context.addInitScript(WATCH);
  const page: PageLike = await context.newPage();

  try {
    await signIn(page, app.base, me.username);
    await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });

    // 1. Something is on screen without waiting for a client round trip.
    const seeded = await page.evaluate(
      `document.body.innerText.includes('ПОСЛЕДНЕЕ СООБЩЕНИЕ')`,
    );
    check("the newest message is in the first paint", seeded === true);

    // Let the client's authoritative batch land and settle.
    await page.getByText("ПОСЛЕДНЕЕ СООБЩЕНИЕ", { exact: false }).first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(3500);

    // 2. The conversation is sitting at its newest message, not its oldest.
    const position = (await page.evaluate(
      `(() => {
        const container = Array.from(document.querySelectorAll('div'))
          .find((el) => el.scrollHeight > el.clientHeight + 200 && getComputedStyle(el).overflowY !== 'visible');
        if (!container) return null;
        return {
          top: Math.round(container.scrollTop),
          height: Math.round(container.scrollHeight),
          view: Math.round(container.clientHeight),
          fromBottom: Math.round(container.scrollHeight - container.scrollTop - container.clientHeight),
        };
      })()`,
    )) as { top: number; height: number; view: number; fromBottom: number } | null;
    check("the conversation has scrollable history", position !== null && position.height > position.view + 200,
      position ? `height=${position.height} view=${position.view}` : "no container");
    check(
      "the conversation opens at its newest message",
      position !== null && position.fromBottom < 120,
      position ? `${position.fromBottom}px from the bottom (top=${position.top}/${position.height})` : "not measured",
    );

    // 3. Nothing paginated on the way in.
    const paged = await page.evaluate(`window.__pagedWhileOpening`);
    check("no older history is paged in while opening", paged === 0, `requests=${paged}`);

    // 4. And the whole opening stayed still.
    const cls = (await page.evaluate(`Math.round(window.__cls * 1000) / 1000`)) as number;
    check("opening the conversation does not move the content", cls < 0.1, `cls=${cls}`);
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
    console.log("\nAll conversation-open checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
