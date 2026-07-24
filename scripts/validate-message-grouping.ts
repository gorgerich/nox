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

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll message-grouping checks passed.");
