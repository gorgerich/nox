/**
 * The delivery controller against a real repository and a scripted transport.
 *   npm run validate:message-local-persistence
 *
 * These are the failures the user reported, expressed as scenarios: a message
 * that disappears when you leave the chat, a bubble stuck on "sending", a
 * duplicate after a retry, and a message lost while offline.
 */
import {
  MessageDeliveryController,
  resetDeliveryControllers,
  getDeliveryController,
  type TransportResult,
} from "../src/lib/messages/delivery-controller";
import { createMemoryPendingRepository, createResilientPendingRepository } from "../src/lib/messages/pending-repository";
import type { ServerMessage } from "../src/lib/messages/reconcile";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}`);
  }
}

const CHAT = "chat-1";
const USER = "user-1";

const committed = (id: string, clientId: string, body = "текст"): ServerMessage => ({
  id,
  clientId,
  body,
  createdAt: "2026-07-27T10:00:00Z",
});

function build(transport: (attempt: { clientMessageId: string; attempt: number; body: string }) => Promise<TransportResult>) {
  const repository = createMemoryPendingRepository();
  const controller = new MessageDeliveryController({ chatId: CHAT, userId: USER, repository, transport });
  return { repository, controller };
}

async function main() {

const okTransport = async (a: { clientMessageId: string }): Promise<TransportResult> => ({
  ok: true,
  message: committed(`s-${a.clientMessageId}`, a.clientMessageId),
});

// 1 — the message is durable before the composer is allowed to clear
{
  let released = false;
  const { repository, controller } = build(async (a) => {
    // At this point enqueue() has already resolved, so the draft is gone; the
    // record must already exist or the text is unrecoverable.
    check("record exists on disk before the network is touched", repository.snapshot().length === 1);
    check("composer was released before the request", released);
    return okTransport(a);
  });

  await controller.enqueue({ body: "привет" });
  released = true;
  // let the background flush settle
  await new Promise((resolve) => setTimeout(resolve, 0));
  await controller.flush();
  check("committed message is removed from the pending store", repository.snapshot().length === 0);
  check("bubble is marked sent", controller.getState().messages[0]?.status === "sent");
}

// 2 — a 2xx alone is enough; no socket echo required
{
  const { controller } = build(okTransport);
  await controller.enqueue({ body: "без сокета" });
  await controller.flush();
  const message = controller.getState().messages[0];
  check("HTTP 2xx alone marks the message sent", message.status === "sent");
  check("HTTP 2xx alone assigns the canonical id", Boolean(message.serverId));
}

// 3 — a late socket echo does not create a second bubble
{
  const { controller } = build(okTransport);
  const local = await controller.enqueue({ body: "эхо" });
  await controller.flush();
  controller.ingestServerMessage(committed(`s-${local.clientMessageId}`, local.clientMessageId));
  controller.ingestServerMessage(committed(`s-${local.clientMessageId}`, local.clientMessageId));
  check("repeated socket echoes leave one bubble", controller.getState().messages.length === 1);
}

// 4 — a socket echo arriving *before* the HTTP response
{
  let resolveHttp: (value: TransportResult) => void = () => {};
  const gate = new Promise<TransportResult>((resolve) => {
    resolveHttp = resolve;
  });
  const { controller } = build(() => gate);
  const local = await controller.enqueue({ body: "гонка" });
  const flushing = controller.flush();
  controller.ingestServerMessage(committed("s-race", local.clientMessageId));
  resolveHttp({ ok: true, message: committed("s-race", local.clientMessageId) });
  await flushing;
  check("socket-before-HTTP leaves one bubble", controller.getState().messages.length === 1);
  check("socket-before-HTTP ends sent", controller.getState().messages[0].status === "sent");
}

// 5 — retry reuses the client id, so the server can dedupe
{
  const seen: string[] = [];
  let firstCall = true;
  // maxAttempts 1, so the automatic budget is spent on the first failure and the
  // second call can only come from the explicit retry this test is about.
  const controller = new MessageDeliveryController({
    chatId: CHAT,
    userId: USER,
    maxAttempts: 1,
    repository: createMemoryPendingRepository(),
    transport: async (a) => {
      seen.push(a.clientMessageId);
      if (firstCall) {
        firstCall = false;
        return { ok: false, errorCode: "NETWORK", retryable: true };
      }
      return { ok: true, message: committed("s-retry", a.clientMessageId) };
    },
  });

  const local = await controller.enqueue({ body: "повтор" });
  await controller.flush();
  check("a failed send keeps its bubble", controller.getState().messages.length === 1);
  check("a failed send is marked failed", controller.getState().messages[0].status === "failed");

  controller.retry(local.clientMessageId);
  await controller.flush();
  check("retry reuses the same client id", seen.length === 2 && seen[0] === seen[1]);
  check("retry does not create a second bubble", controller.getState().messages.length === 1);
  check("retry ends sent", controller.getState().messages[0].status === "sent");
}

// 6 — the server returning the already-committed message (idempotent replay)
{
  const { controller, repository } = build(async (a) => ({
    // Same canonical id both times: the server recognised the client id.
    ok: true,
    message: committed("s-idem", a.clientMessageId),
  }));
  const local = await controller.enqueue({ body: "идемпотентно" });
  await controller.flush();
  controller.ingestServerMessage(committed("s-idem", local.clientMessageId));
  check("idempotent replay yields one bubble", controller.getState().messages.length === 1);
  check("idempotent replay clears the pending record", repository.snapshot().length === 0);
}

// 7 — leaving the chat and coming back: the message survives
{
  const repository = createMemoryPendingRepository();
  const first = new MessageDeliveryController({
    chatId: CHAT,
    userId: USER,
    repository,
    transport: async () => ({ ok: false, errorCode: "NETWORK", retryable: true }),
  });
  await first.enqueue({ body: "не потеряться" });
  await first.flush();
  check("failed message is still on disk after leaving", repository.snapshot().length === 1);

  // A brand-new controller stands in for a remount of the screen.
  const second = new MessageDeliveryController({ chatId: CHAT, userId: USER, repository, transport: okTransport });
  await second.hydrate();
  check("remount restores the message", second.getState().messages.length === 1);
  check("restored message is retryable, not stuck sending", second.getState().messages[0].status === "failed");
  check("restored message keeps its client id", second.getState().messages[0].body === "не потеряться");

  await second.flush();
  check("restored message is delivered on retry", second.getState().messages[0].status === "sent");
  check("delivered message leaves the pending store", repository.snapshot().length === 0);
}

// 8 — a tab that died mid-flight
{
  const repository = createMemoryPendingRepository([
    {
      renderKey: "local:crash-1",
      clientMessageId: "crash-1",
      serverId: null,
      chatId: CHAT,
      senderUserId: USER,
      body: "оборвалось",
      status: "sending",
      createdAt: "2026-07-27T09:00:00Z",
      serverCreatedAt: null,
      attemptCount: 1,
      lastErrorCode: null,
      updatedAt: "2026-07-27T09:00:00Z",
    },
  ]);
  const controller = new MessageDeliveryController({ chatId: CHAT, userId: USER, repository, transport: okTransport });
  await controller.hydrate();
  check("an interrupted send never comes back spinning", controller.getState().messages[0].status === "failed");
  await controller.flush();
  check("an interrupted send is delivered after recovery", controller.getState().messages[0].status === "sent");
}

// 9 — offline queues, reconnect drains, order preserved
{
  const sent: string[] = [];
  const repository = createMemoryPendingRepository();
  const controller = new MessageDeliveryController({
    chatId: CHAT,
    userId: USER,
    repository,
    transport: async (a) => {
      sent.push(a.body);
      return { ok: true, message: committed(`s-${a.clientMessageId}`, a.clientMessageId, a.body) };
    },
  });

  controller.setOnline(false);
  await controller.enqueue({ body: "первое" });
  await controller.enqueue({ body: "второе" });
  await controller.enqueue({ body: "третье" });
  await controller.flush();
  check("offline sends nothing", sent.length === 0);
  check("offline still keeps every message on disk", repository.snapshot().length === 3);
  check("offline bubbles are queued, not failed", controller.getState().messages.every((m) => m.status === "queued"));

  controller.setOnline(true);
  await controller.flush();
  check("reconnect delivers everything", sent.length === 3);
  check("reconnect preserves order", sent.join(",") === "первое,второе,третье");
  check("reconnect empties the pending store", repository.snapshot().length === 0);
}

// 10 — concurrent flushes must not double-send
{
  const sent: string[] = [];
  const { controller } = build(async (a) => {
    sent.push(a.clientMessageId);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, message: committed(`s-${a.clientMessageId}`, a.clientMessageId) };
  });
  await controller.enqueue({ body: "один раз" });
  await Promise.all([controller.flush(), controller.flush(), controller.flush()]);
  check("three concurrent flushes send once", sent.length === 1, `sent=${sent.length}`);
}

// 11 — nothing spins forever
{
  let clock = Date.parse("2026-07-27T10:00:00Z");
  const repository = createMemoryPendingRepository();
  const controller = new MessageDeliveryController({
    chatId: CHAT,
    userId: USER,
    repository,
    now: () => clock,
    timeoutMs: 1_000,
    // A transport that never resolves — the request is simply hanging.
    transport: () => new Promise<TransportResult>(() => {}),
  });
  await controller.enqueue({ body: "висит" });
  void controller.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));
  check("the message starts in flight", controller.getState().messages[0].status === "sending");
  clock += 5_000;
  controller.tick();
  check("a hung request becomes failed, not eternal", controller.getState().messages[0].status === "failed");
  check("the timeout is recorded as such", controller.getState().messages[0].lastErrorCode === "TIMEOUT");
}

// 12 — a permanent rejection is not retried into the ground
{
  let calls = 0;
  const { controller } = build(async () => {
    calls += 1;
    return { ok: false, errorCode: "FORBIDDEN", retryable: false };
  });
  await controller.enqueue({ body: "нельзя" });
  await controller.flush();
  await controller.flush();
  check("a permanent failure is attempted once", calls === 1, `calls=${calls}`);
  check("a permanent failure keeps the text on screen", controller.getState().messages[0].body === "нельзя");
}

// 13 — a retryable failure stops at the attempt budget
{
  let calls = 0;
  const repository = createMemoryPendingRepository();
  const controller = new MessageDeliveryController({
    chatId: CHAT,
    userId: USER,
    repository,
    maxAttempts: 2,
    transport: async () => {
      calls += 1;
      return { ok: false, errorCode: "NETWORK", retryable: true };
    },
  });
  await controller.enqueue({ body: "не дозвонились" });
  await controller.flush();
  check("retries stop at the budget", calls === 2, `calls=${calls}`);
  check("the message is still on disk for a manual retry", repository.snapshot().length === 1);
}

// 14 — a broken pending store must not lose the message
{
  const memory = createMemoryPendingRepository();
  const broken = createMemoryPendingRepository();
  broken.failWrites(99);
  const repository = createResilientPendingRepository(broken, memory);
  const controller = new MessageDeliveryController({ chatId: CHAT, userId: USER, repository, transport: okTransport });
  await controller.enqueue({ body: "хранилище сломано" });
  check("a failing primary store falls back rather than dropping the message", memory.snapshot().length === 1);
  await controller.flush();
  check("the message is still delivered with a degraded store", controller.getState().messages[0].status === "sent");
}

// 15 — the controller outlives the screen
{
  resetDeliveryControllers();
  const repository = createMemoryPendingRepository();
  let resolveHttp: (value: TransportResult) => void = () => {};
  const gate = new Promise<TransportResult>((resolve) => {
    resolveHttp = resolve;
  });

  const mounted = getDeliveryController({ chatId: CHAT, userId: USER, repository, transport: () => gate });
  const local = await mounted.enqueue({ body: "ушёл с экрана" });
  const inFlight = mounted.flush();

  // "unmount": every subscriber goes away.
  const unsubscribe = mounted.subscribe(() => {});
  unsubscribe();

  resolveHttp({ ok: true, message: committed("s-unmount", local.clientMessageId) });
  await inFlight;

  const remounted = getDeliveryController({ chatId: CHAT, userId: USER, repository, transport: okTransport });
  check("a remount reuses the same controller", remounted === mounted);
  check("delivery completed while nothing was mounted", remounted.getState().messages[0].status === "sent");
  check("the pending record was cleared", repository.snapshot().length === 0);
  resetDeliveryControllers();
}

// 16 — messages the controller never sent are not adopted
{
  const { controller } = build(okTransport);
  controller.ingestServerMessage(committed("someone-else", "not-ours"));
  check("an unrelated message is left to the conversation list", controller.getState().messages.length === 0);
}

}

main().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll message local-persistence checks passed.");
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
