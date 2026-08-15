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
import { buildConversationPreview } from "../src/lib/chat-preview";
import { formatTimestamp } from "../src/lib/time-format";
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
    lastCall: null,
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
//
// The presenter is pure, so every branch is checked directly. The cases below
// are the ones that were wrong before it existed: an encrypted message (which
// is all of them) fell through to a single generic phrase, and an encrypted
// attachment showed its placeholder file name verbatim.

const preview = (over: ChatOverrides, extra: Partial<Parameters<typeof buildConversationPreview>[0]> = {}) =>
  buildConversationPreview({ chat: chat(over), ...extra });

check("a group row names the sender", preview({}).prefix === "Ангелина");
check("a group row of my own message says «Вы»", preview({ lastMessage: { isMine: true } }).prefix === "Вы");
check("a one-to-one incoming row has no prefix", preview({ type: "DIRECT" }).prefix === null);
check(
  "a one-to-one row of my own message still says «Вы»",
  preview({ type: "DIRECT", lastMessage: { isMine: true } }).prefix === "Вы",
);
check("a row with no message has no prefix", preview({ lastMessage: null }).prefix === null);
check(
  "a system event has no prefix",
  preview({ lastMessage: { type: "SYSTEM", body: "Чат создан" } }).prefix === null,
);
check(
  "a sender with no display name falls back to the username",
  preview({ lastMessage: { sender: { id: "u3", username: "igor", displayName: "" } } }).prefix === "igor",
);
check(
  "a sender with neither name gets a neutral word, never an id",
  preview({ lastMessage: { sender: { id: "8f1c-uuid", username: "", displayName: "" } } }).prefix === "Участник",
);
{
  const orphan = chat({});
  (orphan.lastMessage as unknown as { sender: undefined }).sender = undefined;
  const prefix = buildConversationPreview({ chat: orphan }).prefix;
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
];
for (const [name, message, expected] of previews) {
  const actual = preview({ lastMessage: message }).text;
  check(`preview for ${name}`, actual === expected, `${actual} ≠ ${expected}`);
}

// The whole point of the change: an encrypted message whose plaintext this
// device holds reads as itself, not as the fallback.
check(
  "a decrypted body replaces the encrypted fallback",
  preview({ lastMessage: { type: "TEXT", body: null, isEncrypted: true } }, { decryptedBody: "Буду через 10 минут" }).text
    === "Буду через 10 минут",
);
check(
  "the fallback survives when this device holds nothing",
  preview({ lastMessage: { type: "TEXT", body: null, isEncrypted: true } }, { decryptedBody: null }).text
    === "Зашифрованное сообщение",
);
check(
  "the encrypted fallback is muted, not presented as ordinary text",
  preview({ lastMessage: { type: "TEXT", body: null, isEncrypted: true } }).tone === "muted",
);

// An encrypted attachment stores a placeholder name on the server. It used to
// be shown to the user verbatim, so a photo's row read "encrypted-file".
check(
  "an encrypted attachment never shows its placeholder name",
  preview({
    lastMessage: {
      type: "IMAGE",
      body: null,
      isEncrypted: true,
      attachments: [{ id: "a", fileName: "encrypted-file", mimeType: "image/jpeg", sizeBytes: 10, isEncrypted: true }],
    },
  }).text === "Фото",
);
check(
  "a named attachment still shows its file name",
  preview({
    lastMessage: { type: "FILE", body: null, attachments: [{ id: "a", fileName: "смета.pdf", mimeType: "application/pdf", sizeBytes: 10 }] },
  }).text === "смета.pdf",
);
check(
  "a voice note carries its length",
  preview({
    lastMessage: { type: "VOICE", body: null, attachments: [{ id: "a", fileName: "v", mimeType: "audio/webm", sizeBytes: 10, durationSeconds: 38 }] },
  }).text === "Голосовое · 0:38",
);
check(
  "several photos in one event are counted, never guessed",
  preview({
    lastMessage: {
      type: "IMAGE",
      body: null,
      attachments: [
        { id: "a", fileName: "1", mimeType: "image/jpeg", sizeBytes: 1 },
        { id: "b", fileName: "2", mimeType: "image/jpeg", sizeBytes: 1 },
        { id: "c", fileName: "3", mimeType: "image/jpeg", sizeBytes: 1 },
      ],
    },
  }).text === "3 фото",
);
check(
  "an audio file is not called a voice message",
  preview({
    lastMessage: { type: "FILE", body: null, attachments: [{ id: "a", fileName: "song.mp3", mimeType: "audio/mpeg", sizeBytes: 10 }] },
  }).text === "Аудио · song.mp3",
);
check("an empty conversation says so", preview({ lastMessage: null }).text === "Нет сообщений");
check("the self chat says what it is", preview({ isSelfChat: true, lastMessage: null }).text === "Сообщения самому себе");
check(
  "an emoji-only message is left exactly as written",
  preview({ lastMessage: { body: "👍" } }).text === "👍",
);

// --- ticks belong to our own message, and to nothing else --------------------
check(
  "an outgoing message carries its delivery state",
  preview({ lastMessage: { isMine: true, deliveryStatus: "read" } }).deliveryState === "read",
);
check(
  "an incoming message carries none",
  preview({ lastMessage: { isMine: false } }).deliveryState === null,
);
check(
  "delivery state falls back to the receipts when not precomputed",
  preview({ lastMessage: { isMine: true, deliveryStatus: undefined, deliveredAt: "2026-07-28T10:01:00Z" } }).deliveryState
    === "delivered",
);
check(
  "a deleted message shows no ticks",
  preview({ lastMessage: { isMine: true, deletedAt: "2026-07-28T10:05:00Z" } }).deliveryState === null,
);

// --- calls -------------------------------------------------------------------
const callChat = (over: Partial<NonNullable<ChatListItem["lastCall"]>>) =>
  buildConversationPreview({
    chat: chat({
      lastCall: {
        id: "call1",
        status: "completed",
        outgoing: true,
        durationSec: 720,
        createdAt: "2026-07-28T11:00:00Z",
        ...over,
      },
    } as ChatOverrides),
  });

check("a finished call reports its length", callChat({}).text === "Звонок · 12 мин");
check("a call outranks the older message it sits above", callChat({}).icon === "callOutgoing");
check("an incoming call is marked as such", callChat({ outgoing: false }).icon === "callIncoming");
check("a short call is reported in seconds", callChat({ durationSec: 45 }).text === "Звонок · 45 сек");
check("a long call is reported in hours", callChat({ durationSec: 3900 }).text === "Звонок · 1 ч 5 мин");
check(
  "a missed incoming call is the one thing shown in red",
  callChat({ status: "missed", outgoing: false, durationSec: null }).tone === "danger",
);
check(
  "a missed incoming call says so",
  callChat({ status: "missed", outgoing: false, durationSec: null }).text === "Пропущенный звонок",
);
check(
  "an unanswered outgoing call is not the caller's missed call",
  callChat({ status: "missed", outgoing: true, durationSec: null }).text === "Звонок без ответа",
);
check("a call never carries ticks", callChat({}).deliveryState === null);
check("a call never carries a sender prefix", callChat({}).prefix === null);

// --- live states outrank stored history --------------------------------------
check(
  "a call in progress replaces the preview",
  preview({}, { liveCall: { video: false } }).text === "Аудиозвонок · идёт",
);
check(
  "a video call in progress says which it is",
  preview({}, { liveCall: { video: true } }).text === "Видеозвонок · идёт",
);
check("a live call is toned as live", preview({}, { liveCall: { video: false } }).tone === "live");
check(
  "a live call outranks a typing indicator",
  preview({}, { liveCall: { video: false }, typingName: "Игорь" }).text === "Аудиозвонок · идёт",
);
check(
  "typing outranks the stored message",
  preview({ type: "DIRECT" }, { typingName: "Игорь" }).text === "печатает…",
);
check(
  "typing in a group names who",
  preview({}, { typingName: "Игорь" }).text === "Игорь печатает…",
);
check("a draft is shown when nothing is live", preview({}, { draft: "недописанное" }).prefix === "Черновик");
check(
  "a live state never carries ticks",
  preview({ lastMessage: { isMine: true, deliveryStatus: "read" } }, { liveCall: { video: false } }).deliveryState === null,
);

// --- the accessible phrase ---------------------------------------------------
check("the accessible label joins sender and text", preview({}).label === "Ангелина: текст");
check("a one-to-one label is just the text", preview({ type: "DIRECT" }).label === "текст");
check(
  "the label states the delivery state in words, not only as a glyph",
  preview({ lastMessage: { isMine: true, deliveryStatus: "read" } }).label.includes("прочитано"),
);
check(
  "the label states the unread count",
  preview({ unreadCount: 3 }).label.includes("непрочитанных: 3"),
);

// --- the timestamp -----------------------------------------------------------
{
  const zone = "UTC";
  const now = new Date();
  const at = (offsetMs: number) => new Date(now.getTime() - offsetMs);
  const stamp = (value: Date) => formatTimestamp(value, "chatListStamp", zone);

  check("today shows a time", /^\d{2}:\d{2}$/.test(stamp(at(60 * 1000))), stamp(at(60 * 1000)));
  const yesterday = stamp(at(26 * 60 * 60 * 1000));
  check("yesterday is named, not dated", yesterday === "Вчера", yesterday);
  const older = stamp(at(3 * 24 * 60 * 60 * 1000));
  check("a recent day is a weekday name", older.length <= 4 && !/\d/.test(older), older);
  const lastYear = stamp(new Date(Date.UTC(now.getUTCFullYear() - 2, 6, 28)));
  check("a previous year carries the year", /^\d{2}\.\d{2}\.\d{2}$/.test(lastYear), lastYear);
}

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
