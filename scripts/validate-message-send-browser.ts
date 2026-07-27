/**
 * End-to-end send path in a real browser, against the disposable test database.
 *   npm run validate:message-send-browser
 *
 * Composer → local persist → delivery controller → HTTP → Postgres → socket →
 * reconciliation → IndexedDB → reload → offline → reconnect → retry.
 *
 * Nothing here touches production: the run refuses to start unless the database
 * carries the disposable marker, and the server it boots is given that same URL.
 *
 * Screenshots land in docs/screenshots/messenger-fix/.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertIsolation, testDatabaseUrl } from "./backup-test-db";

const PORT = Number(process.env.MESSAGE_BROWSER_PORT ?? 3987);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOT_DIR = join(process.cwd(), "docs/screenshots/messenger-fix");
const PASSWORD = "harness-password-1";

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
  } else {
    console.log(`ok    ${name}${detail ? " :: " + detail : ""}`);
  }
}

/** The slice of Playwright's surface this harness relies on. */
type ApiResponse = { ok(): boolean; status(): number; json(): Promise<Record<string, unknown> & { messages?: unknown[]; hasMore?: boolean }> };
type Locator = {
  first(): Locator;
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  inputValue(): Promise<string>;
  waitFor(options: { state: string; timeout?: number }): Promise<void>;
};
type PageLike = {
  on(event: "pageerror", handler: (error: Error) => void): void;
  on(event: "response", handler: (response: ResponseLike) => void): void;
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  reload(options?: { waitUntil?: string }): Promise<unknown>;
  screenshot(options: { path: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
  request: { post(url: string, options: { data: unknown }): Promise<ApiResponse>; get(url: string): Promise<ApiResponse> };
};
type ResponseLike = { request(): { method(): string; url(): string; postData(): string | null }; status(): number };
type ContextLike = { newPage(): Promise<PageLike>; setOffline(offline: boolean): Promise<void> };
type BrowserLike = { newContext(options: unknown): Promise<ContextLike> };

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/** Playwright is resolved from the npx cache; it is not a project dependency. */
async function loadPlaywright() {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const candidates = [
    "playwright",
    ...[process.env.HOME ? `${process.env.HOME}/.npm/_npx` : null]
      .filter(Boolean)
      .flatMap(() => {
        const { readdirSync } = require("node:fs") as typeof import("node:fs");
        const base = `${process.env.HOME}/.npm/_npx`;
        try {
          return readdirSync(base).map((dir: string) => `${base}/${dir}/node_modules/playwright`);
        } catch {
          return [];
        }
      }),
  ];
  // Newest first: an older cached copy points at a chromium build that may no
  // longer be on disk, and its failure message ("run npx playwright install")
  // is misleading when a working newer copy is sitting right next to it.
  const withVersions = candidates.map((candidate) => {
    try {
      return { candidate, version: require(`${candidate}/package.json`).version as string };
    } catch {
      return { candidate, version: "0.0.0" };
    }
  });
  withVersions.sort((a, b) => compareVersions(b.version, a.version));

  for (const { candidate } of withVersions) {
    try {
      const playwright = require(candidate);
      const executable = playwright.chromium?.executablePath?.();
      const { existsSync } = require("node:fs") as typeof import("node:fs");
      if (executable && !existsSync(executable)) continue;
      return playwright;
    } catch {
      // try the next location
    }
  }
  throw new Error("Playwright not available. Run `npx playwright@latest install chromium` once.");
}

async function waitForServer(timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${BASE}/login`, { redirect: "manual" });
      if (response.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error("server did not come up in time");
}

async function main() {
  const isolation = await assertIsolation();
  if (!isolation.ok) {
    console.error("MESSAGE_TEST_DB_ISOLATION=FAIL");
    for (const reason of isolation.reasons) console.error(`  ${reason}`);
    console.error("\nStatus: BLOCKED — refusing to run a browser against a non-disposable database.");
    process.exit(1);
  }
  console.log(`MESSAGE_TEST_DB_ISOLATION=PASS (${isolation.fingerprint})\n`);

  mkdirSync(SHOT_DIR, { recursive: true });

  const url = testDatabaseUrl();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const stamp = Date.now();
  const meId = `me-${stamp}`;
  const peerId = `peer-${stamp}`;
  const chatId = `chat-${stamp}`;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  let server: ChildProcess | null = null;
  let browser: { close(): Promise<void> } | null = null;

  try {
    for (const [id, username] of [[meId, `me${stamp}`], [peerId, `peer${stamp}`]] as const) {
      await prisma.user.create({
        data: { id, username, login: username, passwordHash, status: "ACTIVE" },
      });
    }
    // A GROUP conversation, so the plaintext send branch runs. The E2EE branch
    // needs registered recipient devices and is covered by the crypto suites;
    // what is under test here is the delivery path, which is shared.
    await prisma.chat.create({
      data: {
        id: chatId,
        type: "GROUP",
        title: "Harness",
        createdBy: { connect: { id: meId } },
        members: { create: [{ userId: meId, role: "OWNER" }, { userId: peerId, role: "MEMBER" }] },
      },
    });

    console.log("starting the app against the disposable database…");
    server = spawn(process.execPath, ["server.js"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        DATABASE_URL: url,
        DIRECT_URL: url,
        PORT: String(PORT),
        HOST: "127.0.0.1",
        NEXT_TELEMETRY_DISABLED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => {
      const line = String(chunk);
      if (/error/i.test(line)) process.stdout.write(`  [server] ${line}`);
    });
    server.stderr?.on("data", (chunk) => process.stdout.write(`  [server:err] ${chunk}`));

    await waitForServer();
    console.log(`app is up on ${BASE}\n`);

    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    // Playwright is not a project dependency, so its types are not available
    // here; the shapes this harness uses are declared structurally instead.
    const context = await (browser as never as BrowserLike).newContext({ viewport: { width: 430, height: 900 } });
    const page = await context.newPage();

    const errors: string[] = [];
    page.on("pageerror", (error: Error) => errors.push(error.message));

    // --- sign in ------------------------------------------------------------
    const login = await page.request.post(`${BASE}/api/auth/login`, {
      data: { login: `me${stamp}`, password: PASSWORD },
    });
    check("harness signs in", login.ok(), `status ${login.status()}`);

    const posts: { clientMessageId: string | null; status: number }[] = [];
    page.on("response", (response: ResponseLike) => {
      const request = response.request();
      if (request.method() !== "POST" || !request.url().includes(`/api/chats/${chatId}/messages`)) return;
      let clientMessageId: string | null = null;
      try {
        clientMessageId = JSON.parse(request.postData() ?? "{}").clientId ?? null;
      } catch {
        clientMessageId = null;
      }
      posts.push({ clientMessageId, status: response.status() });
    });

    await page.goto(`${BASE}/chats/${chatId}`, { waitUntil: "networkidle" });

    const composer = page.locator("textarea, input[type=text]").first();
    await composer.waitFor({ state: "visible", timeout: 60_000 });

    const bubbles = (text: string) => page.getByText(text, { exact: true });

    // --- 1. a plain send ----------------------------------------------------
    const first = `harness-первое-${stamp}`;
    await composer.fill(first);
    await page.screenshot({ path: join(SHOT_DIR, "01-composer-typed.png") });

    await composer.press("Enter");
    await page.waitForTimeout(2_500);
    check("the composer is cleared after the message is accepted", (await composer.inputValue()) === "");
    check("the message is on screen exactly once", (await bubbles(first).count()) === 1, `count=${await bubbles(first).count()}`);
    await page.screenshot({ path: join(SHOT_DIR, "02-sent-single-bubble.png") });

    const committed = await prisma.message.findMany({ where: { chatId, body: first } });
    check("the message reached Postgres exactly once", committed.length === 1, `rows=${committed.length}`);
    check("the row carries the client id", Boolean(committed[0]?.clientMessageId));

    // --- 2. reload ----------------------------------------------------------
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2_000);
    check("the message survives a reload", (await bubbles(first).count()) === 1, `count=${await bubbles(first).count()}`);
    await page.screenshot({ path: join(SHOT_DIR, "03-after-reload.png") });

    // --- 3. offline ---------------------------------------------------------
    const offline = `harness-офлайн-${stamp}`;
    await context.setOffline(true);
    await page.locator("textarea, input[type=text]").first().fill(offline);
    await page.locator("textarea, input[type=text]").first().press("Enter");
    await page.waitForTimeout(2_000);
    check("an offline message stays on screen", (await bubbles(offline).count()) === 1);
    check("the composer is still cleared offline", (await page.locator("textarea, input[type=text]").first().inputValue()) === "");
    const offlineRows = await prisma.message.count({ where: { chatId, body: offline } });
    check("an offline message is not in the database yet", offlineRows === 0, `rows=${offlineRows}`);
    await page.screenshot({ path: join(SHOT_DIR, "04-offline-queued.png") });

    // --- 4. reconnect -------------------------------------------------------
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(6_000);
    const afterReconnect = await prisma.message.findMany({ where: { chatId, body: offline } });
    check("reconnect delivers the queued message", afterReconnect.length === 1, `rows=${afterReconnect.length}`);
    check("reconnect does not duplicate it on screen", (await bubbles(offline).count()) === 1, `count=${await bubbles(offline).count()}`);
    await page.screenshot({ path: join(SHOT_DIR, "05-reconnect-delivered.png") });

    // --- 5. leaving and coming back -----------------------------------------
    await page.goto(`${BASE}/chats`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1_000);
    await page.goto(`${BASE}/chats/${chatId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2_500);
    const apiAfterRemount = await page.evaluate(async (id) => {
      const response = await fetch(`/api/chats/${id}/messages`, { cache: "no-store" });
      const data = await response.json();
      return (data.messages ?? []).map((message: { body: string | null }) => message.body);
    }, chatId);
    // A history refresh with no explicit limit must return the page, not one
    // row. `Number(null)` is 0, which used to clamp the page size to 1 and made
    // the conversation look emptied after leaving and coming back.
    check("the history refresh returns the whole page", apiAfterRemount.length === 2, `count=${apiAfterRemount.length}`);
    check("both messages are there after leaving and returning", (await bubbles(first).count()) === 1 && (await bubbles(offline).count()) === 1);
    await page.screenshot({ path: join(SHOT_DIR, "06-remount-return.png") });

    // --- 6. a repeated request with the same client id ----------------------
    const replayed = committed[0]?.clientMessageId as string;
    const replay = await page.request.post(`${BASE}/api/chats/${chatId}/messages`, {
      data: { body: first, clientId: replayed, clientMessageId: replayed },
    });
    check("a replayed request is accepted", replay.ok(), `status ${replay.status()}`);
    const afterReplay = await prisma.message.count({ where: { chatId, clientMessageId: replayed } });
    check("a replayed request does not create a second row", afterReplay === 1, `rows=${afterReplay}`);

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(2_500);
    check("a replayed request does not create a second bubble", (await bubbles(first).count()) === 1, `count=${await bubbles(first).count()}`);
    await page.screenshot({ path: join(SHOT_DIR, "07-idempotent-replay.png") });

    // --- 7. the invariants that span the whole run ---------------------------
    const total = await prisma.message.count({ where: { chatId } });
    check("the conversation holds exactly the two messages that were sent", total === 2, `rows=${total}`);
    check("every send carried a client id", posts.length > 0 && posts.every((post) => Boolean(post.clientMessageId)));
    // One known pre-existing mismatch is excluded: InlineConnectionNotice
    // renders from the socket's connected flag, which differs between the
    // server render and hydration. Verified present with this branch's changes
    // stashed, so it is not part of the delivery work — see the report's
    // remaining constraints. Everything else must be clean.
    const unexpected = errors.filter((error) => !error.startsWith("Hydration failed"));
    if (errors.length > 0) console.log(`  page errors (${errors.length}, ${unexpected.length} unexpected):\n${errors.map((e) => e.split("\n")[0]).join("\n")}`);
    check("no unexpected errors in the page", unexpected.length === 0, unexpected.map((error) => error.split("\n")[0]).join(" | "));

    const pendingLeft = await page.evaluate(async () => {
      const open = indexedDB.open("nox-e2ee");
      const db: IDBDatabase = await new Promise((resolve, reject) => {
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      if (!db.objectStoreNames.contains("pending")) return 0;
      const request = db.transaction("pending", "readonly").objectStore("pending").getAll();
      const rows: unknown[] = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
      return rows.length;
    });
    check("nothing is left owed in the pending store", pendingLeft === 0, `pending=${pendingLeft}`);
  } finally {
    await browser?.close().catch(() => {});
    await prisma.$disconnect().catch(() => {});
    if (server) {
      server.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (!server.killed) server.kill("SIGKILL");
    }
  }
}

main()
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log(`\nAll browser send checks passed. Screenshots in ${SHOT_DIR}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
