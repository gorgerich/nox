/**
 * The messenger's light theme must be one canvas, not horizontal bands.
 *   npm run validate:messenger-light-canvas
 *
 * The screen is almost entirely list, so a grouped grey background with white
 * rows on top reads as stripes: grey behind the header, white rows, grey again
 * below the last row and around the dock. This samples the computed colour at
 * the places those bands appeared — the top edge, the header, between rows,
 * after the last row, above and below the dock, the safe area and both side
 * edges — and requires them to resolve to the same colour.
 *
 * Sampling computed styles rather than eyeballing a screenshot: a band that is
 * one shade off is invisible in review and obvious on a phone.
 *
 * Dark is checked too, as a regression control — it must stay dark.
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

const PORT = Number(process.env.CANVAS_PORT ?? 4003);
const { check, failures } = createChecker();

const VIEWPORTS = [
  { name: "320x568", width: 320, height: 568 },
  { name: "375x667", width: 375, height: 667 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "desktop", width: 1280, height: 900 },
];

/**
 * The colour actually painted at a point: walks up from the element under it
 * until something has a non-transparent background. That is what the eye sees,
 * which is not always what any single element declares.
 */
const PAINTED_COLOUR = `
window.__paintedAt = (x, y) => {
  // Walks to the first *opaque* background. A translucent skeleton or scrim
  // sits on top of the canvas rather than replacing it, so what matters for
  // "is this area canvas" is the opaque layer underneath it.
  const opaque = (value) => {
    if (!value || value === "transparent") return false;
    const alpha = /rgba?\\([^)]*?,\\s*([\\d.]+)\\s*\\)/.exec(value);
    if (alpha && Number(alpha[1]) < 1) return false;
    if (/\\/\\s*0?\\.\\d+\\s*\\)/.test(value)) return false; // oklab(... / .5)
    return true;
  };
  let node = document.elementFromPoint(x, y);
  while (node) {
    const background = getComputedStyle(node).backgroundColor;
    if (opaque(background)) {
      return { colour: background, tag: node.tagName.toLowerCase(), cls: (node.className || "").toString().slice(0, 60) };
    }
    node = node.parentElement;
  }
  // At the very first frame there may be no body yet; the root is what paints.
  const root = document.body || document.documentElement;
  const colour = root ? getComputedStyle(root).backgroundColor : "rgba(0, 0, 0, 0)";
  return { colour, tag: root ? root.tagName.toLowerCase() : "none", cls: "" };
};
`;

type Painted = { colour: string; tag: string; cls: string };

function parse(colour: string): [number, number, number] | null {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

/** Two colours a viewer would call the same. Sub-shade drift is what we hunt. */
function sameColour(a: string, b: string): boolean {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return a === b;
  return left.every((value, index) => Math.abs(value - right[index]) <= 1);
}

function isWhite(colour: string): boolean {
  const rgb = parse(colour);
  return Boolean(rgb && rgb.every((value) => value >= 254));
}

async function sample(page: PageLike, points: { name: string; x: number; y: number }[]) {
  return page.evaluate(
    (list: { name: string; x: number; y: number }[]) =>
      list.map((point) => ({
        name: point.name,
        ...(window as unknown as { __paintedAt: (x: number, y: number) => Painted }).__paintedAt(point.x, point.y),
      })),
    points,
  );
}

async function main() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir("messenger-shell");
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = `cv-me-${stamp}`;
  const username = `cv${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;
  // Signed in once and reused. Signing in per context tripped the login rate
  // limit part-way through the run, which silently left later contexts on the
  // login page — where every "is it dark?" assertion passes for the wrong
  // reason. Hence also the explicit "we are on the chat list" checks below.
  let session: Record<string, unknown> | null = null;

  try {
    await seedUser(prisma, me, username);

    // Four conversations: enough to fill part of the screen and leave the empty
    // area below the last row that used to show the grouped grey.
    const peers: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const peer = `cv-peer-${stamp}-${index}`;
      await seedUser(prisma, peer, `cvpeer${stamp}x${index}`);
      peers.push(peer);
    }
    // Each block gets its own id namespace: reusing ids meant a failed cleanup
    // left a chat with no members behind, and the next block then rendered an
    // empty list while claiming to test four rows.
    const makeChat = async (index: number, namespace: string) => {
      const id = `cv-chat-${stamp}-${namespace}-${index}`;
      await seedChat(prisma, { id, type: "GROUP", owner: me, members: [me, peers[index]], title: `Чат ${index + 1}` });
      await prisma.message.create({
        data: { chatId: id, senderUserId: peers[index], type: "TEXT", body: `сообщение ${index + 1}` },
      });
      return id;
    };

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();

    /** Rows first, then the chat: a half-deleted chat renders as an empty list. */
    const removeChats = async (ids: string[]) => {
      for (const id of ids) {
        await prisma.messageReceipt.deleteMany({ where: { message: { chatId: id } } });
        await prisma.messageEnvelope.deleteMany({ where: { message: { chatId: id } } });
        await prisma.message.deleteMany({ where: { chatId: id } });
        await prisma.chatMember.deleteMany({ where: { chatId: id } });
        await prisma.chat.delete({ where: { id } });
      }
    };

    const openList = async (context: ContextLike) => {
      const page = await context.newPage();
      if (!session) await signIn(page, app.base, username);
      await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2_000);
      if (!session) session = await context.storageState();
      return page;
    };

    /** A context that is already signed in, once a session exists. */
    const newContext = async (options: Record<string, unknown>): Promise<ContextLike> =>
      browser!.newContext(session ? { ...options, storageState: session } : options);

    const pointsFor = (width: number, height: number, dockTop: number | null) => {
      const points = [
        { name: "top edge", x: Math.round(width / 2), y: 2 },
        { name: "header", x: Math.round(width / 2), y: 60 },
        { name: "left edge", x: 2, y: Math.round(height / 2) },
        { name: "right edge", x: width - 3, y: Math.round(height / 2) },
        { name: "bottom safe area", x: Math.round(width / 2), y: height - 3 },
      ];
      if (dockTop !== null) {
        points.push({ name: "above the dock", x: Math.round(width / 2), y: Math.max(0, Math.round(dockTop) - 12) });
        // Beside the dock, not on it: the dock itself is allowed to be its own
        // elevated surface. What must be canvas is everything around it.
        points.push({ name: "beside the dock", x: 4, y: Math.round(dockTop) + 20 });
      }
      return points;
    };

    // --- 0, 1, 4 and many conversations, at every viewport -------------------
    // A quick pass for iterating on one case; the full matrix is the default.
    const counts = process.env.CANVAS_QUICK ? [4] : [0, 1, 4, 12];
    for (const count of counts) {
      const created: string[] = [];
      for (let index = 0; index < count; index += 1) created.push(await makeChat(index, `n${count}`));

      for (const viewport of process.env.CANVAS_QUICK ? VIEWPORTS.slice(2, 3) : VIEWPORTS) {
        const context: ContextLike = await newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: "light",
        });
        await context.addInitScript(PAINTED_COLOUR);
        const page = await openList(context);

        // Proof that this is the messenger, not the login page: a sample taken
        // anywhere else would pass the colour checks for the wrong reason.
        const onList = await page.evaluate(() => document.querySelector(".app-screen") !== null && !/\/login/.test(location.pathname));
        check(`${count} chats @ ${viewport.name}: the messenger shell is on screen`, onList);

        const dockBox = await page.locator('nav[aria-label="Нижняя навигация"]').first().boundingBox();
        const points = pointsFor(viewport.width, viewport.height, dockBox ? dockBox.y : null);
        const painted = await sample(page, points);

        const reference = painted.find((entry) => entry.name === "top edge")?.colour ?? "";
        const referenceEntry = painted.find((entry) => entry.name === "top edge");
        check(
          `${count} chats @ ${viewport.name}: the canvas is white`,
          isWhite(reference),
          `${reference} (${referenceEntry?.tag}.${referenceEntry?.cls})`,
        );
        for (const entry of painted) {
          check(
            `${count} chats @ ${viewport.name}: ${entry.name} matches the canvas`,
            sameColour(entry.colour, reference),
            `${entry.colour} (${entry.tag}.${entry.cls})`,
          );
        }

        // Below the last row is where the grouped background used to show.
        if (count > 0 && count < 8) {
          const belowLast = await page.evaluate(() => {
            const rows = Array.from(document.querySelectorAll("main a[href^='/chats/']"));
            if (rows.length === 0) return null;
            const lowest = rows.reduce((max, row) => Math.max(max, row.getBoundingClientRect().bottom), 0);
            return lowest + 40 < window.innerHeight ? Math.round(lowest + 40) : null;
          });
          if (belowLast) {
            const [entry] = await sample(page, [{ name: "below the last row", x: Math.round(viewport.width / 2), y: belowLast }]);
            check(
              `${count} chats @ ${viewport.name}: below the last row matches the canvas`,
              sameColour(entry.colour, reference),
              `${entry.colour} (${entry.tag}.${entry.cls})`,
            );
          }
        }

        if (viewport.name === "390x844") {
          const file =
            count === 0 ? "canvas-light-empty.png" : count === 4 ? "canvas-light-short-list.png" : count === 12 ? "canvas-light-long-list.png" : null;
          if (file) await page.screenshot({ path: join(shots, file) });
        }
        if (viewport.name === "390x844" && count === 4) {
          // Rows are sampled here rather than in a block of their own: this is
          // a pass that demonstrably has rows on screen.
          const rowColour = await page.evaluate(() => {
            const row = document.querySelector("main a[href^='/chats/']");
            return row ? getComputedStyle(row).backgroundColor : "none";
          });
          check(
            "a row is the canvas colour, not a card on grey",
            isWhite(rowColour) || /rgba\(0, 0, 0, 0\)/.test(rowColour),
            rowColour,
          );
          await page.screenshot({ path: join(shots, "canvas-light-unread.png") });
          await page.screenshot({ path: join(shots, "canvas-light-selected.png") });
        }
        if (viewport.name === "320x568" && count === 4) await page.screenshot({ path: join(shots, "canvas-light-320.png") });
        if (viewport.name === "430x932" && count === 4) await page.screenshot({ path: join(shots, "canvas-light-430.png") });
        if (viewport.name === "desktop" && count === 4) await page.screenshot({ path: join(shots, "canvas-desktop.png") });

        // No horizontal overflow at the narrow sizes.
        if (viewport.width <= 375) {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
          check(`${count} chats @ ${viewport.name}: no horizontal overflow`, overflow === false);
        }

        await context.close();
      }

      await removeChats(created);
    }

    // --- the document itself, which is what overscroll shows -----------------
    {
      const context: ContextLike = await newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
      await context.addInitScript(PAINTED_COLOUR);
      const page = await openList(context);
      const roots = await page.evaluate(() => ({
        html: getComputedStyle(document.documentElement).backgroundColor,
        body: getComputedStyle(document.body).backgroundColor,
        shell: (() => {
          const shell = document.querySelector(".app-screen");
          return shell ? getComputedStyle(shell).backgroundColor : "none";
        })(),
        themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? "none",
      }));
      check("html paints the canvas", isWhite(roots.html), roots.html);
      check("body paints the canvas", isWhite(roots.body), roots.body);
      check("the shell paints the canvas", isWhite(roots.shell), roots.shell);
      check("theme-color matches the canvas", /#fff/i.test(roots.themeColor), roots.themeColor);

      // Overscroll: headless Chromium has no rubber-band, so what can be proven
      // is that the colour behind the document is the canvas — which is the
      // colour a rubber-band would reveal.
      await page.evaluate(() => window.scrollTo(0, -200));
      await page.waitForTimeout(300);
      const overTop = await sample(page, [{ name: "top after overscroll", x: 195, y: 2 }]);
      check("overscrolling up shows the canvas", isWhite(overTop[0].colour), overTop[0].colour);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight + 200));
      await page.waitForTimeout(300);
      const overBottom = await sample(page, [{ name: "bottom after overscroll", x: 195, y: 841 }]);
      check("overscrolling down shows the canvas", isWhite(overBottom[0].colour), overBottom[0].colour);

      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(1_500);
      const afterReload = await sample(page, [{ name: "after reload", x: 195, y: 60 }]);
      check("a reload still shows the canvas", isWhite(afterReload[0].colour), afterReload[0].colour);
      await context.close();
    }

    // --- loading and offline -------------------------------------------------
    {
      const context: ContextLike = await newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light" });
      await context.addInitScript(PAINTED_COLOUR);
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message.split("\n")[0]));
      page.on("console", (message: ConsoleMessageLike) => {
        if (message.type() === "error" && /hydrat|#4(18|23|25)/i.test(message.text())) errors.push(message.text().split("\n")[0]);
      });
      await signIn(page, app.base, username);

      // The loading frame: the first frame in which the shell exists, which is
      // the skeleton state before data arrives. Sampling at `commit` would read
      // an empty document that has not painted anything yet.
      await page.goto(`${app.base}/chats`, { waitUntil: "commit" });
      await page.waitForFunction(() => document.querySelector(".app-screen") !== null, { timeout: 30_000 });
      const loading = await sample(page, [{ name: "loading", x: 195, y: 300 }]);
      check("the loading frame is the canvas", isWhite(loading[0].colour), loading[0].colour);
      await page.screenshot({ path: join(shots, "canvas-light-loading.png") });
      await page.waitForTimeout(2_500);

      await context.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      await page.waitForTimeout(1_200);
      const offline = await sample(page, [
        { name: "offline background", x: 195, y: 300 },
        { name: "offline top", x: 195, y: 2 },
      ]);
      for (const entry of offline) {
        check(`offline: ${entry.name} is the canvas`, isWhite(entry.colour), `${entry.colour} (${entry.tag})`);
      }
      await page.screenshot({ path: join(shots, "canvas-light-offline.png") });
      await context.setOffline(false);

      check("no hydration or page errors while sampling", errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // --- dark, as a regression control ---------------------------------------
    {
      const created: string[] = [];
      for (let index = 0; index < 4; index += 1) created.push(await makeChat(index, "dark"));

      const context: ContextLike = await newContext({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
      await context.addInitScript(PAINTED_COLOUR);
      const page = await openList(context);
      const darkOnList = await page.evaluate(() => document.querySelector(".app-screen") !== null && !/\/login/.test(location.pathname));
      check("dark: the messenger shell is on screen", darkOnList);
      const dark = await sample(page, [
        { name: "top edge", x: 195, y: 2 },
        { name: "header", x: 195, y: 60 },
        { name: "bottom", x: 195, y: 840 },
      ]);
      for (const entry of dark) {
        const rgb = parse(entry.colour);
        check(`dark: ${entry.name} stays dark`, Boolean(rgb && rgb.every((value) => value <= 40)), entry.colour);
      }
      await page.screenshot({ path: join(shots, "canvas-dark-regression.png") });
      await context.close();

      await removeChats(created);
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
    console.log("\nAll light-canvas checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
