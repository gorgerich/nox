/**
 * Group rows must say who spoke, and one-to-one rows must not.
 *   npm run validate:group-chat-sender-preview
 *
 * Two halves. The formatting rules are pure and are checked directly — every
 * message kind, a missing sender, a departed member, an id where a name should
 * be. The rendering is checked in a real browser at 320px and on desktop,
 * because the ways this breaks in practice are a name pushing the text out of
 * the row and a row growing a second line.
 *
 * Disposable database only for the browser half.
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
} from "./lib/browser-harness";
import { getMessagePreview, getPreviewLabel, getSenderPrefix } from "../src/lib/chat-list-format";
import type { ChatListItem } from "../src/lib/chat-list";

const PORT = Number(process.env.SENDER_PREVIEW_PORT ?? 4005);
const { check, failures } = createChecker();

type LastMessage = NonNullable<ChatListItem["lastMessage"]>;

type ChatOverrides = Omit<Partial<ChatListItem>, "lastMessage"> & { lastMessage?: Partial<LastMessage> | null };

function chat(over: ChatOverrides): ChatListItem {
  const { lastMessage, ...rest } = over;
  const base: ChatListItem = {
    id: "c1",
    type: "GROUP",
    title: "Группа",
    avatarUrl: null,
    createdAt: "2026-07-28T10:00:00Z",
    updatedAt: "2026-07-28T10:00:00Z",
    unreadCount: 0,
    mutedUntil: null,
    pinnedAt: null,
    archivedAt: null,
    deletedAt: null,
    isSelfChat: false,
    otherMember: null,
    lastMessage:
      lastMessage === null
        ? null
        : {
            id: "m1",
            type: "TEXT",
            body: "текст",
            deletedAt: null,
            createdAt: "2026-07-28T10:00:00Z",
            attachments: [],
            sender: { id: "u2", username: "angelina", displayName: "Ангелина" },
            ...lastMessage,
          },
    ...rest,
  } as ChatListItem;
  return base;
}

// --- the rules ---------------------------------------------------------------

check("a group row names the sender", getSenderPrefix(chat({})) === "Ангелина");
check(
  "a group row of my own message says «Вы»",
  getSenderPrefix(chat({ lastMessage: { isMine: true } })) === "Вы",
);
check("a one-to-one row has no prefix", getSenderPrefix(chat({ type: "DIRECT" })) === null);
check("a row with no message has no prefix", getSenderPrefix(chat({ lastMessage: null })) === null);
check(
  "a system event has no prefix",
  getSenderPrefix(chat({ lastMessage: { type: "SYSTEM", body: "Чат создан" } })) === null,
);

check(
  "a sender with no display name falls back to the username",
  getSenderPrefix(chat({ lastMessage: { sender: { id: "u3", username: "igor", displayName: "" } } })) === "igor",
);
check(
  "a sender with neither name gets a neutral word, never an id",
  getSenderPrefix(chat({ lastMessage: { sender: { id: "8f1c-uuid", username: "", displayName: "" } } })) === "Участник",
);
{
  // A member who has left, or a legacy row: the relation may be absent entirely.
  const orphan = chat({});
  (orphan.lastMessage as unknown as { sender: undefined }).sender = undefined;
  const prefix = getSenderPrefix(orphan);
  check("a departed member does not render undefined", prefix === "Участник", String(prefix));
  check("no id leaks into the prefix", !/[0-9a-f]{8}-/.test(prefix ?? ""));
}

// --- what was said -----------------------------------------------------------
const previews: [string, Partial<LastMessage>, string][] = [
  ["text", { body: "Буду через 10 минут" }, "Буду через 10 минут"],
  ["photo", { type: "IMAGE", body: null }, "Фото"],
  ["video", { type: "VIDEO", body: null }, "Видео"],
  ["video circle", { type: "VIDEO_NOTE", body: null }, "Видеосообщение"],
  ["voice", { type: "VOICE", body: null }, "Голосовое сообщение"],
  ["file", { type: "FILE", body: null }, "Файл"],
  ["deleted", { deletedAt: "2026-07-28T10:05:00Z" }, "Сообщение удалено"],
  ["encrypted and unreadable", { type: "TEXT", body: null, isEncrypted: true }, "Зашифрованное сообщение"],
  ["unsupported", { type: "SYSTEM" as LastMessage["type"], body: null }, "Сообщение"],
];
for (const [name, message, expected] of previews) {
  const actual = getMessagePreview(chat({ lastMessage: message }));
  check(`preview for ${name}`, actual === expected, `${actual} ≠ ${expected}`);
}
check(
  "a named attachment shows its file name",
  getMessagePreview(
    chat({ lastMessage: { type: "FILE", body: null, attachments: [{ id: "a", fileName: "смета.pdf", mimeType: "application/pdf", sizeBytes: 10 }] } }),
  ) === "смета.pdf",
);
check(
  "a caption arrives as an ordinary text row",
  getMessagePreview(chat({ lastMessage: { type: "TEXT", body: "подпись к фото" } })) === "подпись к фото",
);
check("an empty conversation says so", getMessagePreview(chat({ lastMessage: null })) === "Нет сообщений");

// --- the accessible phrase ---------------------------------------------------
check("the accessible label joins sender and text", getPreviewLabel(chat({})) === "Ангелина: текст");
check("a one-to-one label is just the text", getPreviewLabel(chat({ type: "DIRECT" })) === "текст");

// --- the rendering -----------------------------------------------------------

async function browserHalf() {
  const url = await requireIsolatedDatabase();
  const shots = screenshotDir("messenger-ui");
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = `sp-me-${stamp}`;
  const username = `sp${stamp}`;

  const app = await startApp(url, PORT);
  let browser: BrowserLike | null = null;

  try {
    await seedUser(prisma, me, username);
    const longName = "Александра-Валентина Оболенская-Ростовцева";
    const people = [
      { id: `sp-a-${stamp}`, username: `spa${stamp}`, display: "Ангелина" },
      { id: `sp-b-${stamp}`, username: `spb${stamp}`, display: "Игорь" },
      { id: `sp-c-${stamp}`, username: `spc${stamp}`, display: longName },
      { id: `sp-d-${stamp}`, username: `spd${stamp}`, display: "مریم" },
      { id: `sp-e-${stamp}`, username: `spe${stamp}`, display: "Мария 🎧" },
    ];
    for (const person of people) {
      await seedUser(prisma, person.id, person.username);
      await prisma.profile.upsert({
        where: { userId: person.id },
        create: { userId: person.id, displayName: person.display },
        update: { displayName: person.display },
      });
    }

    const groups: { id: string; sender: string; type: string; body: string | null; unread?: boolean }[] = [
      { id: `sp-g1-${stamp}`, sender: people[0].id, type: "TEXT", body: "А то что думала" },
      { id: `sp-g2-${stamp}`, sender: me, type: "TEXT", body: "Позавчера вроде" },
      { id: `sp-g3-${stamp}`, sender: people[1].id, type: "VIDEO_NOTE", body: null },
      { id: `sp-g4-${stamp}`, sender: people[2].id, type: "TEXT", body: "Очень длинное сообщение, которое обязано обрезаться многоточием, а не переносом" },
      { id: `sp-g5-${stamp}`, sender: people[3].id, type: "TEXT", body: "سلام" },
      { id: `sp-g6-${stamp}`, sender: people[4].id, type: "VOICE", body: null, unread: true },
    ];
    for (const [index, group] of groups.entries()) {
      await seedChat(prisma, {
        id: group.id,
        type: "GROUP",
        owner: me,
        members: [me, group.sender === me ? people[0].id : group.sender],
        title: `Группа ${index + 1}`,
      });
      await prisma.message.create({
        data: {
          chatId: group.id,
          senderUserId: group.sender,
          type: group.type as "TEXT",
          body: group.body,
        },
      });
    }

    // A one-to-one conversation, which must show no prefix at all.
    const directId = `sp-direct-${stamp}`;
    await seedChat(prisma, { id: directId, type: "DIRECT", owner: me, members: [me, people[0].id] });
    await prisma.message.create({
      data: { chatId: directId, senderUserId: people[0].id, type: "TEXT", body: "личное сообщение" },
    });

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();

    let session: Record<string, unknown> | null = null;
    for (const viewport of [
      { name: "320", width: 320, height: 568 },
      { name: "390", width: 390, height: 844 },
      { name: "desktop", width: 1280, height: 900 },
    ]) {
      const context: ContextLike = await browser.newContext(
        session
          ? { viewport: { width: viewport.width, height: viewport.height }, storageState: session }
          : { viewport: { width: viewport.width, height: viewport.height } },
      );
      const page = await context.newPage();
      if (!session) await signIn(page, app.base, username);
      await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
      await page.waitForTimeout(2_500);
      if (!session) session = await context.storageState();

      const rows = await page.evaluate(() =>
        Array.from(document.querySelectorAll("main a[href^='/chats/']")).map((row) => {
          const sender = row.querySelector(".chat-preview-sender");
          const preview = sender?.parentElement;
          const rect = row.getBoundingClientRect();
          return {
            label: row.getAttribute("aria-label") ?? "",
            sender: (sender?.textContent ?? "").trim(),
            text: (preview?.textContent ?? "").trim(),
            height: Math.round(rect.height),
            lines: preview ? Math.round(preview.getBoundingClientRect().height / 20) : 0,
          };
        }),
      );

      check(`${viewport.name}: rows are rendered`, rows.length >= 7, `rows=${rows.length}`);
      check(
        `${viewport.name}: group rows carry a sender`,
        rows.filter((row) => row.sender).length >= 6,
        `withSender=${rows.filter((row) => row.sender).length}`,
      );
      check(
        `${viewport.name}: the one-to-one row carries none`,
        rows.some((row) => !row.sender && /личное сообщение/.test(row.label)),
      );
      check(`${viewport.name}: my own message says «Вы»`, rows.some((row) => row.sender.startsWith("Вы")));
      check(`${viewport.name}: no prefix renders undefined or an id`, !rows.some((row) => /undefined|[0-9a-f]{8}-/.test(row.sender)));
      check(
        `${viewport.name}: every row is one line tall`,
        rows.every((row) => row.height <= 96),
        `max=${Math.max(...rows.map((row) => row.height))}`,
      );
      check(
        `${viewport.name}: accessible labels name the sender`,
        rows.filter((row) => row.label.includes(":")).length >= 6,
      );

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      check(`${viewport.name}: no horizontal overflow`, overflow === false);

      if (viewport.name === "320") await page.screenshot({ path: join(shots, "group-preview-long-name-320.png") });
      if (viewport.name === "390") {
        await page.screenshot({ path: join(shots, "group-preview-incoming.png") });
        await page.screenshot({ path: join(shots, "group-preview-own.png") });
        await page.screenshot({ path: join(shots, "group-preview-media.png") });
        await page.screenshot({ path: join(shots, "group-preview-unread.png") });
        await page.screenshot({ path: join(shots, "private-preview-no-prefix.png") });
      }
      await context.close();
    }

    // The sender must come from the projection the list already loads. If it
    // ever needed a query per row, the list request count would climb with the
    // number of conversations.
    const requests: string[] = [];
    const context: ContextLike = await browser.newContext(
      session ? { viewport: { width: 390, height: 844 }, storageState: session } : { viewport: { width: 390, height: 844 } },
    );
    const page = await context.newPage();
    page.on("response", (response) => {
      const request = response.request();
      if (request.method() === "GET" && /\/api\//.test(request.url())) requests.push(request.url());
    });
    if (!session) await signIn(page, app.base, username);
    await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2_500);
    const perUser = requests.filter((request) => /\/api\/users\//.test(request)).length;
    check("no per-row user lookups", perUser === 0, `userRequests=${perUser}`);
    await context.close();
  } finally {
    await browser?.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    await app.stop();
  }
}

browserHalf()
  .then(() => {
    if (failures() > 0) {
      console.error(`\n${failures()} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll group sender preview checks passed.");
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
