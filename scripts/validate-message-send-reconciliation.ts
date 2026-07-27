/**
 * Race coverage for outgoing-message reconciliation.
 *   npm run validate:message-send-reconciliation
 *
 * These are the scenarios that produced the reported duplicates and stuck
 * bubbles. Matching is by identity only — no test here relies on text.
 */
import {
  createLocalMessage,
  reconcileServerMessage,
  mergeServerHistory,
  markSending,
  markFailed,
  expireStalledSends,
  resendableOnReconnect,
  SEND_TIMEOUT_MS,
  type ReconcilableMessage,
  type ServerMessage,
} from "../src/lib/messages/reconcile";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const server = (id: string, clientId: string | null, body = "текст"): ServerMessage => ({
  id,
  clientId,
  body,
  createdAt: "2026-07-26T10:00:00Z",
});

// 1 — plain success
{
  let list = [createLocalMessage({ clientMessageId: "c1", body: "привет" })];
  list = markSending(list, "c1");
  list = reconcileServerMessage(list, server("s1", "c1", "привет"));
  check("successful send yields one message", list.length === 1);
  check("optimistic entry adopts the server id", list[0].serverId === "s1");
  check("status advances to sent", list[0].status === "sent");
}

// 2/3 — HTTP before socket, and socket before HTTP
{
  let list = markSending([createLocalMessage({ clientMessageId: "c2", body: "x" })], "c2");
  list = reconcileServerMessage(list, server("s2", "c2")); // HTTP
  list = reconcileServerMessage(list, server("s2", "c2")); // socket echo
  check("HTTP then socket does not duplicate", list.length === 1);

  let other = markSending([createLocalMessage({ clientMessageId: "c3", body: "x" })], "c3");
  other = reconcileServerMessage(other, server("s3", "c3")); // socket first
  other = reconcileServerMessage(other, server("s3", "c3")); // HTTP after
  check("socket then HTTP does not duplicate", other.length === 1);
}

// 4 — repeated socket echo
{
  let list = markSending([createLocalMessage({ clientMessageId: "c4", body: "x" })], "c4");
  for (let i = 0; i < 5; i += 1) list = reconcileServerMessage(list, server("s4", "c4"));
  check("five identical socket echoes collapse to one", list.length === 1);
}

// 5 — server committed but the HTTP response was lost, then retry
{
  let list = markSending([createLocalMessage({ clientMessageId: "c5", body: "x" })], "c5");
  list = markFailed(list, "c5");                                   // response never arrived
  check("lost response leaves the message failed, not gone", list.length === 1 && list[0].status === "failed");
  list = markSending(list, "c5");                                  // retry, same client id
  check("retry does not create a second bubble", list.length === 1);
  list = reconcileServerMessage(list, server("s5", "c5"));         // server returns the original
  check("retry reconciles onto the original entry", list.length === 1 && list[0].serverId === "s5");
}

// 6 — echo arrives with no client id but a known server id
{
  let list = markSending([createLocalMessage({ clientMessageId: "c6", body: "x" })], "c6");
  list = reconcileServerMessage(list, server("s6", "c6"));
  list = reconcileServerMessage(list, server("s6", null));
  check("echo without a client id matches by server id", list.length === 1);
}

// 7 — a genuinely different message is appended
{
  let list = markSending([createLocalMessage({ clientMessageId: "c7", body: "x" })], "c7");
  list = reconcileServerMessage(list, server("s7", "c7"));
  list = reconcileServerMessage(list, server("s8", "c8"));
  check("an unrelated message is appended", list.length === 2);
}

// 8 — two messages with identical text must stay distinct
{
  let list = [
    createLocalMessage({ clientMessageId: "d1", body: "ок" }),
    createLocalMessage({ clientMessageId: "d2", body: "ок" }),
  ];
  list = reconcileServerMessage(list, server("sd1", "d1", "ок"));
  list = reconcileServerMessage(list, server("sd2", "d2", "ок"));
  check("identical text is not deduplicated", list.length === 2);
  check("each keeps its own server id", list[0].serverId === "sd1" && list[1].serverId === "sd2");
}

// 9 — history merge after remount keeps pending local messages
{
  const pending = markSending([createLocalMessage({ clientMessageId: "p1", body: "в полёте" })], "p1");
  const merged = mergeServerHistory(pending, [server("h1", null), server("h2", null)]);
  check("history merge preserves the pending message", merged.some((m) => m.clientMessageId === "p1"));
  check("history merge adds the canonical messages", merged.length === 3);

  // and the same history applied twice must not grow
  const twice = mergeServerHistory(merged, [server("h1", null), server("h2", null)]);
  check("re-merging the same history does not duplicate", twice.length === 3);
}

// 10 — render key stays stable so the bubble never remounts
{
  let list = markSending([createLocalMessage({ clientMessageId: "k1", body: "x" })], "k1");
  const before = list[0].renderKey;
  list = reconcileServerMessage(list, server("sk1", "k1"));
  check("render key is unchanged after adopting a server id", list[0].renderKey === before);
}

// 11 — order stays stable
{
  let list = ["o1", "o2", "o3"].map((id) => createLocalMessage({ clientMessageId: id, body: id }));
  list = reconcileServerMessage(list, server("so2", "o2"));
  list = reconcileServerMessage(list, server("so1", "o1"));
  check(
    "reconciling out of order does not reorder the list",
    list.map((m) => m.clientMessageId).join(",") === "o1,o2,o3",
  );
}

// 12 — nothing stays in flight forever
{
  const started = new Date(Date.now() - SEND_TIMEOUT_MS - 1_000).toISOString();
  const stalled: ReconcilableMessage[] = [
    { ...createLocalMessage({ clientMessageId: "t1", body: "x" }), status: "sending", attemptStartedAt: started },
  ];
  const expired = expireStalledSends(stalled);
  check("a stalled send becomes failed rather than spinning", expired[0].status === "failed");

  const fresh: ReconcilableMessage[] = [
    { ...createLocalMessage({ clientMessageId: "t2", body: "x" }), status: "sending", attemptStartedAt: new Date().toISOString() },
  ];
  check("a recent send is left alone", expireStalledSends(fresh)[0].status === "sending");

  const committed: ReconcilableMessage[] = [
    { ...createLocalMessage({ clientMessageId: "t3", body: "x" }), serverId: "s", status: "sending", attemptStartedAt: started },
  ];
  check("a committed message is never expired", expireStalledSends(committed)[0].status === "sending");
}

// 13 — reconnect resends only what was never committed
{
  const list: ReconcilableMessage[] = [
    { ...createLocalMessage({ clientMessageId: "r1", body: "x" }), status: "queued" },
    { ...createLocalMessage({ clientMessageId: "r2", body: "x" }), status: "failed" },
    { ...createLocalMessage({ clientMessageId: "r3", body: "x" }), serverId: "s3", status: "sent" },
  ];
  const resend = resendableOnReconnect(list);
  check("reconnect resends queued and failed", resend.length === 2);
  check("reconnect never resends a committed message", !resend.some((m) => m.serverId));
}

// 14 — status never regresses
{
  let list = markSending([createLocalMessage({ clientMessageId: "st1", body: "x" })], "st1");
  list = reconcileServerMessage(list, server("ss1", "st1"), "read");
  list = reconcileServerMessage(list, server("ss1", "st1"), "sent");
  check("a later echo does not regress read back to sent", list[0].status === "read");
}

// 15 — ten rapid sends stay ten
{
  let list = Array.from({ length: 10 }, (_, i) => createLocalMessage({ clientMessageId: `f${i}`, body: "спам" }));
  for (let i = 0; i < 10; i += 1) list = reconcileServerMessage(list, server(`sf${i}`, `f${i}`, "спам"));
  for (let i = 0; i < 10; i += 1) list = reconcileServerMessage(list, server(`sf${i}`, `f${i}`, "спам")); // echoes
  check("ten rapid sends with echoes yield exactly ten", list.length === 10);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll message-send reconciliation checks passed.");
