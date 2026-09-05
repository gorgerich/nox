/**
 * Screenshots every screen, light and dark, phone and desktop.
 *   npm run audit:screens
 *
 * This is a looking tool, not a gate: it asserts nothing and fails nothing. A
 * design review needs the actual pixels, and reasoning about screens from their
 * source is how details that only show up in composition get missed.
 *
 * Output: docs/screenshots/audit/<screen>-<theme>-<viewport>.png
 */
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
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

const PORT = Number(process.env.AUDIT_PORT ?? 3989);
const OUT = resolve(process.cwd(), process.env.AUDIT_OUT ?? "docs/screenshots/audit");

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1280, height: 900 },
];

async function main() {
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const stamp = Date.now();
  const me = await seedUser(prisma, randomUUID(), `audit${stamp}`);
  await prisma.user.update({ where: { id: me.id }, data: { role: "OWNER" } });
  const peer = await seedUser(prisma, randomUUID(), `peer${stamp}`);
  const third = await seedUser(prisma, randomUUID(), `third${stamp}`);

  const direct = await seedChat(prisma, { id: randomUUID(), type: "DIRECT", owner: me.id, members: [me.id, peer.id] });
  const group = await seedChat(prisma, {
    id: randomUUID(),
    type: "GROUP",
    owner: me.id,
    members: [me.id, peer.id, third.id],
    title: "Проектная группа",
  });

  // Enough traffic that the list and the conversation are not empty states.
  const bodies = [
    "Привет! Как дела с релизом?",
    "Всё готово, гейт зелёный",
    "Отлично. Тогда выкатываем сегодня",
    "Скинь, пожалуйста, ссылку на отчёт",
  ];
  for (const [index, body] of bodies.entries()) {
    for (const chatId of [direct, group]) {
      await prisma.message.create({
        data: {
          chatId,
          senderUserId: index % 2 === 0 ? me.id : peer.id,
          type: "TEXT",
          body,
          createdAt: new Date(Date.now() - (bodies.length - index) * 60_000),
        },
      });
    }
  }
  for (let i = 0; i < 6; i += 1) {
    const chatId = await seedChat(prisma, {
      id: randomUUID(),
      type: "GROUP",
      owner: me.id,
      members: [me.id, peer.id],
      title: `Чат ${i + 1}`,
    });
    await prisma.message.create({
      data: { chatId, senderUserId: peer.id, type: "TEXT", body: `Сообщение в чате ${i + 1}` },
    });
  }

  const app = await startApp(url, PORT);
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();

  const screens: { name: string; path: string }[] = [
    { name: "01-chats", path: "/chats" },
    { name: "02-conversation-direct", path: `/chats/${direct}` },
    { name: "03-conversation-group", path: `/chats/${group}` },
    { name: "04-new-chat", path: "/chats/new" },
    { name: "05-search", path: "/chats/search" },
    { name: "06-archive", path: "/chats/archive" },
    { name: "07-contacts", path: "/contacts" },
    { name: "08-calls", path: "/calls" },
    { name: "09-profile", path: "/profile" },
    { name: "10-chat-profile", path: `/chats/${direct}/profile` },
    { name: "11-group-profile", path: `/chats/${group}/group-profile` },
    { name: "12-user", path: `/users/${peer.id}` },
    { name: "13-safety", path: "/safety" },
    { name: "14-admin", path: "/admin" },
  ];

  const publicScreens = [
    { name: "90-login", path: "/login" },
    { name: "91-join", path: "/join" },
    { name: "92-forgot-password", path: "/forgot-password" },
  ];

  try {
    for (const viewport of VIEWPORTS) {
      for (const scheme of ["light", "dark"] as const) {
        const context: ContextLike = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: scheme,
          deviceScaleFactor: 2,
        });
        // Next's dev-mode indicator is a fixed badge in the bottom-left corner.
        // It sits on top of the dock and the composer in every shot and is not
        // part of the product; leaving it in makes the review argue with an
        // overlay that users never see.
        await context.addInitScript(
          "document.addEventListener('DOMContentLoaded', () => {" +
            "const style = document.createElement('style');" +
            "style.textContent = 'nextjs-portal, [data-nextjs-toast] { display: none !important; }';" +
            "document.head.appendChild(style);" +
          "});",
        );
        const page: PageLike = await context.newPage();
        await signIn(page, app.base, me.username);

        for (const screen of [...screens, ...publicScreens]) {
          await page.goto(`${app.base}${screen.path}`, { waitUntil: "networkidle" });
          await page.evaluate(() => window.scrollTo(0, 0));
          // Let entry animations settle so the shot is the resting state.
          await page.waitForTimeout(900);
          await page.screenshot({ path: join(OUT, `${screen.name}-${scheme}-${viewport.name}.png`) });
          console.log(`  ${screen.name}-${scheme}-${viewport.name}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await app.stop();
  }

  console.log(`\nScreens written to ${OUT}`);
  process.exit(0);
}

void main();
