/**
 * Long Russian text, on the narrowest phone.
 *   npm run validate:long-text
 *
 * Every screen in this app is built and reviewed against names like "Мама" and
 * "igor". Real accounts carry names that are three times longer, and Russian
 * runs longer than English for the same meaning — so the first place a layout
 * gives way is a label nobody tested with, on a 320px iPhone SE.
 *
 * The failure this catches is specifically *clipping*, not wrapping: a name cut
 * off mid-word by a container with no ellipsis, a value that slides under its
 * own chevron, a header title that pushes the call buttons off the edge. A
 * `truncate` that fires is a design decision; a `scrollWidth` wider than the
 * box it is drawn in is a bug.
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

const PORT = Number(process.env.LONG_TEXT_PORT ?? 4027);

/** Long, but not absurd — a real name of a real length. */
const LONG_NAME = "Александра Константиновна Мирошниченко-Оболенская";
const LONG_BIO =
  "Работаю над несколькими проектами одновременно и обычно отвечаю не сразу, но всегда отвечаю.";

const WIDTHS = [320, 375];

type Screen = { name: string; path: (chatId: string) => string };

const SCREENS: Screen[] = [
  { name: "chats", path: () => "/chats" },
  { name: "chat", path: (chatId) => `/chats/${chatId}` },
  { name: "profile", path: () => "/profile" },
  { name: "partner-profile", path: (chatId) => `/chats/${chatId}/profile` },
];

async function main(): Promise<number> {
  const { check, failures } = createChecker();
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);

  const me = await seedUser(prisma, randomUUID(), `длинныйпользователь${Date.now()}`.slice(0, 30));
  const peer = await seedUser(prisma, randomUUID(), `собеседник${Date.now()}`.slice(0, 30));

  await prisma.profile.create({
    data: { userId: me.id, displayName: LONG_NAME, bio: LONG_BIO },
  });
  await prisma.profile.create({
    data: { userId: peer.id, displayName: LONG_NAME, bio: LONG_BIO },
  });

  const chatId = await seedChat(prisma, {
    id: randomUUID(),
    type: "DIRECT",
    owner: me.id,
    members: [me.id, peer.id],
  });

  await prisma.message.createMany({
    data: [
      {
        id: randomUUID(),
        chatId,
        senderUserId: peer.id,
        type: "TEXT",
        // No spaces: the classic overflow case, a URL or an identifier that
        // cannot be broken on a word boundary.
        body: "ОченьДлинноеСловоБезПробеловКотороеНекудаПеренестиПоСловам",
      },
      { id: randomUUID(), chatId, senderUserId: me.id, type: "TEXT", body: LONG_BIO },
    ],
  });

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();

  try {
    for (const width of WIDTHS) {
      const context: ContextLike = await browser.newContext({
        viewport: { width, height: 852 },
        isMobile: true,
        hasTouch: true,
      });
      const page: PageLike = await context.newPage();
      await signIn(page, app.base, me.username);

      for (const screen of SCREENS) {
        await page.goto(`${app.base}${screen.path(chatId)}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(700);

        // 1. Nothing may extend the document sideways.
        const doc = (await page.evaluate(
          `(() => {
            const el = document.documentElement;
            return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
          })()`,
        )) as { scrollWidth: number; clientWidth: number };
        check(
          `${screen.name} @${width}px: no horizontal overflow`,
          doc.scrollWidth <= doc.clientWidth + 1,
          `scrollWidth=${doc.scrollWidth} clientWidth=${doc.clientWidth}`,
        );

        // 2. Nothing may be cut off without saying so.
        //
        // An element whose content is wider than its box is only acceptable if
        // it has actually asked to be truncated — `text-overflow: ellipsis` or
        // a line clamp. Anything else is a word sliced in half.
        const clipped = (await page.evaluate(
          `(() => {
            const offenders = [];
            for (const el of Array.from(document.querySelectorAll('body *'))) {
              if (el.children.length > 0) continue;             // leaf text only
              const text = (el.textContent || '').trim();
              if (!text) continue;
              const cs = getComputedStyle(el);
              if (cs.visibility === 'hidden' || cs.display === 'none') continue;
              if (cs.overflow === 'visible' && cs.overflowX === 'visible') continue;
              const declaredEllipsis = cs.textOverflow === 'ellipsis'
                || cs.webkitLineClamp !== 'none';
              if (declaredEllipsis) continue;
              // Deliberately collapsed — a dock label animating shut, a value
              // hidden behind a transition. Not clipped text; absent text.
              if (Number(cs.opacity) < 0.05) continue;
              const rect = el.getBoundingClientRect();
              if (rect.width < 2) continue;
              if (el.scrollWidth > Math.ceil(rect.width) + 1) {
                offenders.push(text.slice(0, 28) + ' [' + el.scrollWidth + '>' + Math.round(rect.width) + ']');
              }
            }
            return offenders.slice(0, 5);
          })()`,
        )) as string[];
        check(
          `${screen.name} @${width}px: no text is clipped without an ellipsis`,
          clipped.length === 0,
          clipped.join(" | "),
        );

        // 3. Nothing may be drawn on top of something else along the trailing
        //    edge — a value sliding under its own chevron is the settings-row
        //    version of the same defect.
        const collisions = (await page.evaluate(
          `(() => {
            const rows = Array.from(document.querySelectorAll('a, button, [role="button"]'));
            const hits = [];
            for (const row of rows) {
              const kids = Array.from(row.children);
              if (kids.length < 2) continue;
              for (let i = 0; i < kids.length - 1; i += 1) {
                const a = kids[i].getBoundingClientRect();
                const b = kids[i + 1].getBoundingClientRect();
                if (a.width === 0 || b.width === 0) continue;
                // Only side-by-side pairs; stacked ones legitimately share x.
                const sideBySide = Math.abs(a.top - b.top) < Math.min(a.height, b.height) * 0.6;
                if (!sideBySide) continue;
                if (a.right > b.left + 1) {
                  hits.push(((row.textContent || '').trim().slice(0, 24)) + ' overlap ' + Math.round(a.right - b.left) + 'px');
                }
              }
            }
            return hits.slice(0, 5);
          })()`,
        )) as string[];
        check(
          `${screen.name} @${width}px: nothing overlaps its neighbour in a row`,
          collisions.length === 0,
          collisions.join(" | "),
        );
      }

      await page.close();
      await context.close();
    }
  } finally {
    await browser.close();
    await app.stop();
    await prisma.$disconnect();
  }

  if (failures() > 0) {
    console.error(`\n${failures()} check(s) failed.`);
    return 1;
  }
  console.log("\nLong text: all checks passed.");
  return 0;
}

main().then((code) => process.exit(code)).catch((error) => {
  console.error(error);
  process.exit(1);
});
