/**
 * Executable validation for the pure message-grouping rules.
 *
 * The project has no test runner, and adding one would be a large
 * infrastructure diff for a handful of pure functions, so these run as a
 * standalone script instead:  npm run validate:grouping
 */
import {
  startsGroup,
  endsGroup,
  groupPosition,
  needsDateSeparator,
  formatDateLabel,
  type GroupableMessage,
} from "../src/lib/message-grouping";
import {
  isVisualOnlyBubble,
  resolveMessageVisibility,
  type AttachmentRenderMode,
  type VisibilityInput,
} from "../src/lib/message-visibility";
import { quoteLabel } from "../src/lib/reply-quote";

let failures = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const at = (iso: string, sender = "a", type = "TEXT"): GroupableMessage => ({
  id: iso,
  senderUserId: sender,
  createdAt: new Date(iso).toISOString(),
  type,
});

// --- grouping ---------------------------------------------------------------
const m1 = at("2026-07-25T10:00:00");
const m2 = at("2026-07-25T10:01:00");
const other = at("2026-07-25T10:02:00", "b");
const muchLater = at("2026-07-25T10:30:00");

check("first message starts a group", startsGroup(m1, undefined), true);
check("same author within 5 min continues the group", startsGroup(m2, m1), false);
check("author change starts a group", startsGroup(other, m2), true);
check("gap over 5 min starts a group", startsGroup(muchLater, m2), true);
check("last message ends its group", endsGroup(muchLater, undefined), true);
check("same author within 5 min does not end the group", endsGroup(m1, m2), false);

// A date boundary must break the group, otherwise the date separator would be
// drawn inside a run of bubbles that still look joined.
const beforeMidnight = at("2026-07-25T23:59:30");
const afterMidnight = at("2026-07-26T00:00:10");
check("midnight boundary starts a new group", startsGroup(afterMidnight, beforeMidnight), true);
check("midnight boundary ends the previous group", endsGroup(beforeMidnight, afterMidnight), true);
check("date separator is required at a day change", needsDateSeparator(afterMidnight, beforeMidnight), true);
check("no date separator within one day", needsDateSeparator(m2, m1), false);

// System entries never merge into an author's group.
const system = at("2026-07-25T10:01:30", "a", "SYSTEM");
check("system message starts its own group", startsGroup(system, m2), true);
check("message after a system entry starts a group", startsGroup(at("2026-07-25T10:01:40"), system), true);

// --- positions --------------------------------------------------------------
check("lone message is single", groupPosition(m1, undefined, other), "single");
check("opening message is first", groupPosition(m1, undefined, m2), "first");
check("closing message is last", groupPosition(m2, m1, other), "last");
check(
  "middle message is middle",
  groupPosition(at("2026-07-25T10:00:30"), m1, m2),
  "middle",
);

// --- labels -----------------------------------------------------------------
const now = new Date("2026-07-25T12:00:00");
check("today label", formatDateLabel(new Date("2026-07-25T09:00:00"), now), "Сегодня");
check("yesterday label", formatDateLabel(new Date("2026-07-24T09:00:00"), now), "Вчера");
check("same-year label omits the year", formatDateLabel(new Date("2026-03-04T09:00:00"), now), "4 марта");
check("other-year label includes the year", formatDateLabel(new Date("2025-03-04T09:00:00"), now), "4 марта 2025 г.");

// --- visibility -------------------------------------------------------------
//
// The defect these guard: a bare `18:28 ✓✓` in the conversation with no bubble
// under it. A message drawn "visual only" is transparent with its timestamp in
// a pill positioned over the picture, so when the picture fails to paint the
// pill is the only thing left on screen.

const vis = (over: Partial<VisibilityInput> = {}): VisibilityInput => ({
  hasBody: true,
  hasReply: false,
  isEncrypted: false,
  isDeleted: false,
  settledUndecryptable: false,
  attachments: [],
  attachmentModes: {},
  ...over,
});

const photo = [{ id: "a1", mimeType: "image/jpeg" }];
const modes = (mode: AttachmentRenderMode) => ({ a1: mode });

check("an ordinary text message renders a bubble", resolveMessageVisibility(vis()), "bubble");
check(
  "a photo renders a bubble",
  resolveMessageVisibility(vis({ hasBody: false, attachments: photo })),
  "bubble",
);
check("a deleted message becomes a service line", resolveMessageVisibility(vis({ isDeleted: true })), "service");
check(
  "an encrypted message still decrypting says so",
  resolveMessageVisibility(vis({ hasBody: false, isEncrypted: true })),
  "service",
);
check(
  "an encrypted message that will never decrypt renders nothing",
  resolveMessageVisibility(vis({ hasBody: false, isEncrypted: true, settledUndecryptable: true })),
  "hidden",
);
check(
  "a message whose every attachment drew nothing renders nothing",
  resolveMessageVisibility(vis({ hasBody: false, attachments: photo, attachmentModes: modes("hidden") })),
  "hidden",
);
check(
  "a message with no body and no attachment is a service line, never an empty bubble",
  resolveMessageVisibility(vis({ hasBody: false })),
  "service",
);
check(
  "a hidden attachment hides the row even when the message is encrypted",
  resolveMessageVisibility(vis({ hasBody: false, isEncrypted: true, attachments: photo, attachmentModes: modes("hidden") })),
  "hidden",
);

// The orphan itself: media by type, but nothing actually drawn.
check(
  "a photo that painted is visual only",
  isVisualOnlyBubble(vis({ hasBody: false, attachments: photo, attachmentModes: modes("media") })),
  true,
);
check(
  "a photo that has not reported yet is still visual only, so chrome does not flicker",
  isVisualOnlyBubble(vis({ hasBody: false, attachments: photo })),
  true,
);
check(
  "a photo that fell back to a text box is NOT visual only — this is the orphan timestamp",
  isVisualOnlyBubble(vis({ hasBody: false, attachments: photo, attachmentModes: modes("fallback") })),
  false,
);
check(
  "a caption keeps the bubble out of visual-only mode",
  isVisualOnlyBubble(vis({ attachments: photo, attachmentModes: modes("media") })),
  false,
);
check(
  "a reply keeps the bubble out of visual-only mode",
  isVisualOnlyBubble(vis({ hasBody: false, hasReply: true, attachments: photo, attachmentModes: modes("media") })),
  false,
);
check(
  "a file is never visual only",
  isVisualOnlyBubble(vis({ hasBody: false, attachments: [{ id: "a1", mimeType: "application/pdf" }] })),
  false,
);
check(
  "one failed item among several drops the whole bubble out of visual-only mode",
  isVisualOnlyBubble(vis({
    hasBody: false,
    attachments: [{ id: "a1", mimeType: "image/jpeg" }, { id: "a2", mimeType: "image/jpeg" }],
    attachmentModes: { a1: "media", a2: "fallback" },
  })),
  false,
);

// ---------------------------------------------------------------------------
// Reply quotes.
//
// A quote is the one place where a message this device cannot read still has to
// say something. It used to say "Вложение" for everything, which claimed an
// attachment on replies to plain text.
// ---------------------------------------------------------------------------

check(
  "a readable quote shows its own text",
  quoteLabel({ body: "Нога в гипсе", type: "TEXT", deletedAt: null }),
  "Нога в гипсе",
);
check(
  "a quote to an unreadable text message does not claim an attachment",
  quoteLabel({ body: null, type: "TEXT", deletedAt: null }),
  "Сообщение",
);
check("a quote to a photo says so", quoteLabel({ body: null, type: "IMAGE", deletedAt: null }), "Фото");
check("a quote to a voice note says so", quoteLabel({ body: null, type: "VOICE", deletedAt: null }), "Голосовое сообщение");
check("a quote to a video note says video", quoteLabel({ body: null, type: "VIDEO_NOTE", deletedAt: null }), "Видео");
check("a quote to a file says so", quoteLabel({ body: null, type: "FILE", deletedAt: null }), "Файл");
check(
  "a deleted original wins over every other label",
  quoteLabel({ body: "текст", type: "IMAGE", deletedAt: "2026-08-16T00:00:00.000Z" }),
  "Исходное сообщение удалено",
);
check(
  "whitespace is not text",
  quoteLabel({ body: "   ", type: "IMAGE", deletedAt: null }),
  "Фото",
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll message-grouping checks passed.");
