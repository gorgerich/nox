/**
 * Executable checks for the history-availability classifier.
 *   npm run validate:history-availability
 *
 * The point of these is that a reinstalled user must get an explanation, while
 * a genuinely empty chat and a transient sync failure must NOT be mislabelled
 * as permanent key loss.
 */
import {
  classifyHistory,
  isSealedForAnotherDevice,
  countPermanentlyUnavailable,
  type AvailabilityInput,
} from "../src/lib/history-availability";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`FAIL  ${name}\n      expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const ME = "device-new";
const OLD = "device-old";

const readable = (id: string): AvailabilityInput => ({ id, envelopeDeviceIds: [ME], unavailable: false });
const sealedElsewhere = (id: string): AvailabilityInput => ({ id, envelopeDeviceIds: [OLD], unavailable: true });
/** Envelope IS for us but we still failed — e.g. a transient decrypt/sync problem. */
const transientFail = (id: string): AvailabilityInput => ({ id, envelopeDeviceIds: [ME], unavailable: true });
/** Server returned no envelopes at all — not evidence of a lost key. */
const noEnvelopes = (id: string): AvailabilityInput => ({ id, envelopeDeviceIds: [], unavailable: true });

// --- the reinstall case -----------------------------------------------------
check(
  "all history sealed to a previous install",
  classifyHistory({ messages: [sealedElsewhere("1"), sealedElsewhere("2")], localDeviceId: ME }),
  "missing-device-key",
);
check(
  "some history sealed to a previous install",
  classifyHistory({ messages: [sealedElsewhere("1"), readable("2")], localDeviceId: ME }),
  "partially-unavailable",
);

// --- must NOT be mistaken for key loss --------------------------------------
check("genuinely empty chat", classifyHistory({ messages: [], localDeviceId: ME }), "empty-chat");
check(
  "fully readable history",
  classifyHistory({ messages: [readable("1"), readable("2")], localDeviceId: ME }),
  "ok",
);
check(
  "transient failure on our own envelope is not key loss",
  classifyHistory({ messages: [transientFail("1")], localDeviceId: ME }),
  "ok",
);
check(
  "no envelopes returned is not key loss",
  classifyHistory({ messages: [noEnvelopes("1")], localDeviceId: ME }),
  "ok",
);
check(
  "before device registration nothing is claimed",
  classifyHistory({ messages: [sealedElsewhere("1")], localDeviceId: null }),
  "ok",
);

// --- predicate + count ------------------------------------------------------
check("predicate: sealed elsewhere", isSealedForAnotherDevice(sealedElsewhere("1"), ME), true);
check("predicate: our own envelope", isSealedForAnotherDevice(transientFail("1"), ME), false);
check(
  "counts only permanently unreadable messages",
  countPermanentlyUnavailable([sealedElsewhere("1"), sealedElsewhere("2"), readable("3"), transientFail("4")], ME),
  2,
);

// A message addressed to several devices including ours is readable in principle.
check(
  "multi-device envelope including ours",
  isSealedForAnotherDevice({ id: "m", envelopeDeviceIds: [OLD, ME], unavailable: true }, ME),
  false,
);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll history-availability checks passed.");
