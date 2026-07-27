/**
 * Shared scaffolding for the browser integration suites.
 *
 * Every suite that drives a real browser needs the same four things: proof that
 * the database is disposable, a seeded conversation, the real app running
 * against that database, and Playwright resolved from wherever it happens to
 * live. None of that is the thing under test, so it lives here once.
 *
 * The isolation check is not a formality — it is the guard that keeps these
 * suites away from production data. It runs before anything else and a failure
 * is terminal.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, readdirSync, existsSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { assertIsolation, testDatabaseUrl } from "../backup-test-db";

export const SHOT_DIR = join(process.cwd(), "docs/screenshots/messenger-fix");
export const HARNESS_PASSWORD = "harness-password-1";

export type CheckFn = (name: string, ok: boolean, detail?: string) => void;

/** A counter plus a reporter, so each suite prints the same way. */
export function createChecker() {
  let failures = 0;
  const check: CheckFn = (name, ok, detail = "") => {
    if (!ok) {
      failures += 1;
      console.error(`FAIL  ${name}${detail ? " :: " + detail : ""}`);
    } else {
      console.log(`ok    ${name}${detail ? " :: " + detail : ""}`);
    }
  };
  return { check, failures: () => failures };
}

/**
 * Only one browser suite may use the disposable database at a time.
 *
 * Two suites sharing it interleave their rows and their ports, and the result
 * is a wall of failures that look exactly like a product regression — which is
 * how an afternoon gets spent chasing a bug that does not exist. The lock is
 * advisory and self-healing: a stale lock from a killed run is taken over after
 * the holder is gone.
 */
const LOCK_PATH = join(process.cwd(), "node_modules", ".cache", "nox-browser-suite.lock");

function acquireSuiteLock(): () => void {
  mkdirSync(join(process.cwd(), "node_modules", ".cache"), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      writeFileSync(LOCK_PATH, String(process.pid), { flag: "wx" });
      return () => {
        try {
          rmSync(LOCK_PATH, { force: true });
        } catch {
          // nothing useful to do while tearing down
        }
      };
    } catch {
      const holder = Number(readFileSync(LOCK_PATH, "utf8").trim());
      let alive = false;
      try {
        process.kill(holder, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        console.error(
          `\nAnother browser suite is already running against the disposable database (pid ${holder}).`,
        );
        console.error("Running two at once corrupts both. Wait for it to finish, or stop it first.");
        process.exit(1);
      }
      rmSync(LOCK_PATH, { force: true });
    }
  }
  throw new Error("could not acquire the browser-suite lock");
}

/** Refuses to continue unless the target database is marked disposable. */
export async function requireIsolatedDatabase(): Promise<string> {
  const release = acquireSuiteLock();
  process.on("exit", release);
  process.on("SIGINT", () => {
    release();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    release();
    process.exit(143);
  });
  return requireIsolatedDatabaseInner();
}

async function requireIsolatedDatabaseInner(): Promise<string> {
  const isolation = await assertIsolation();
  if (!isolation.ok) {
    console.error("MESSAGE_TEST_DB_ISOLATION=FAIL");
    for (const reason of isolation.reasons) console.error(`  ${reason}`);
    console.error("\nStatus: BLOCKED — refusing to run a browser against a non-disposable database.");
    process.exit(1);
  }
  console.log(`MESSAGE_TEST_DB_ISOLATION=PASS (${isolation.fingerprint})\n`);
  return testDatabaseUrl();
}

export function createPrisma(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export function screenshotDir(): string {
  mkdirSync(SHOT_DIR, { recursive: true });
  return SHOT_DIR;
}

// --- the app under test ------------------------------------------------------

export type RunningApp = { base: string; stop: () => Promise<void> };

/**
 * Boots the real server — custom `server.js`, so the socket layer is the real
 * one too — against the disposable database.
 */
export async function startApp(url: string, port: number): Promise<RunningApp> {
  const base = `http://127.0.0.1:${port}`;
  const server: ChildProcess = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: url,
      DIRECT_URL: url,
      PORT: String(port),
      HOST: "127.0.0.1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stderr?.on("data", (chunk) => {
    const line = String(chunk);
    if (/error/i.test(line) && !/Unsupported style property/.test(line)) process.stdout.write(`  [server] ${line}`);
  });

  const started = Date.now();
  while (Date.now() - started < 180_000) {
    try {
      const response = await fetch(`${base}/login`, { redirect: "manual" });
      if (response.status < 500) {
        console.log(`app is up on ${base}\n`);
        return {
          base,
          stop: async () => {
            server.kill("SIGTERM");
            await new Promise((resolve) => setTimeout(resolve, 800));
            if (!server.killed) server.kill("SIGKILL");
          },
        };
      }
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  server.kill("SIGKILL");
  throw new Error("server did not come up in time");
}

// --- Playwright --------------------------------------------------------------

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

/**
 * Playwright is not a project dependency. It is picked up from the npx cache,
 * newest first — an older cached copy points at a chromium build that may no
 * longer be on disk, and its own error message sends you to reinstall when a
 * working copy is sitting right next to it.
 */
export async function loadPlaywright(): Promise<{ chromium: { launch(options?: unknown): Promise<BrowserLike>; executablePath?(): string } }> {
  const require = createRequire(import.meta.url);
  const roots: string[] = ["playwright"];
  const npxBase = process.env.HOME ? `${process.env.HOME}/.npm/_npx` : null;
  if (npxBase) {
    try {
      for (const dir of readdirSync(npxBase)) roots.push(`${npxBase}/${dir}/node_modules/playwright`);
    } catch {
      // no npx cache
    }
  }

  const ranked = roots.map((candidate) => {
    try {
      return { candidate, version: require(`${candidate}/package.json`).version as string };
    } catch {
      return { candidate, version: "0.0.0" };
    }
  });
  ranked.sort((a, b) => compareVersions(b.version, a.version));

  for (const { candidate } of ranked) {
    try {
      const playwright = require(candidate);
      const executable = playwright.chromium?.executablePath?.();
      if (executable && !existsSync(executable)) continue;
      return playwright;
    } catch {
      // try the next location
    }
  }
  throw new Error("Playwright not available. Run `npx playwright@latest install chromium` once.");
}

// --- the slice of Playwright's surface these suites use ----------------------

export type ApiResponse = {
  ok(): boolean;
  status(): number;
  json(): Promise<Record<string, unknown> & { messages?: unknown[]; hasMore?: boolean }>;
};

export type Locator = {
  first(): Locator;
  nth(index: number): Locator;
  count(): Promise<number>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  click(options?: { force?: boolean; timeout?: number }): Promise<void>;
  inputValue(): Promise<string>;
  setInputFiles(files: unknown): Promise<void>;
  waitFor(options: { state: string; timeout?: number }): Promise<void>;
  isVisible(): Promise<boolean>;
  textContent(): Promise<string | null>;
};

export type ResponseLike = {
  request(): { method(): string; url(): string; postData(): string | null };
  status(): number;
  url(): string;
};

export type ConsoleMessageLike = { type(): string; text(): string };

export type PageLike = {
  on(event: "pageerror", handler: (error: Error) => void): void;
  on(event: "response", handler: (response: ResponseLike) => void): void;
  on(event: "console", handler: (message: ConsoleMessageLike) => void): void;
  goto(url: string, options?: { waitUntil?: string }): Promise<unknown>;
  reload(options?: { waitUntil?: string }): Promise<unknown>;
  screenshot(options: { path: string }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  locator(selector: string): Locator;
  getByText(text: string, options?: { exact?: boolean }): Locator;
  getByRole(role: string, options?: { name?: string | RegExp }): Locator;
  evaluate<T, A = undefined>(fn: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
  close(): Promise<void>;
  request: {
    post(url: string, options: { data: unknown }): Promise<ApiResponse>;
    get(url: string): Promise<ApiResponse>;
  };
};

export type ContextLike = {
  newPage(): Promise<PageLike>;
  setOffline(offline: boolean): Promise<void>;
  route(pattern: string, handler: (route: { abort(): Promise<void>; continue(): Promise<void> }) => unknown): Promise<void>;
  unroute(pattern: string): Promise<void>;
  close(): Promise<void>;
};

export type BrowserLike = {
  newContext(options?: unknown): Promise<ContextLike>;
  close(): Promise<void>;
};

// --- seeding -----------------------------------------------------------------

export type SeededUser = { id: string; username: string };

/** Creates a user that can actually sign in through the real login route. */
export async function seedUser(
  prisma: ReturnType<typeof createPrisma>,
  id: string,
  username: string,
): Promise<SeededUser> {
  const passwordHash = await bcrypt.hash(HARNESS_PASSWORD, 10);
  await prisma.user.create({ data: { id, username, login: username, passwordHash, status: "ACTIVE" } });
  return { id, username };
}

export async function seedChat(
  prisma: ReturnType<typeof createPrisma>,
  params: { id: string; type: "DIRECT" | "GROUP"; owner: string; members: string[]; title?: string },
): Promise<string> {
  await prisma.chat.create({
    data: {
      id: params.id,
      type: params.type,
      title: params.title,
      createdBy: { connect: { id: params.owner } },
      members: {
        create: params.members.map((userId) => ({ userId, role: userId === params.owner ? "OWNER" : "MEMBER" })),
      },
    },
  });
  return params.id;
}

/** Signs a browser context in through the real login route. */
export async function signIn(page: PageLike, base: string, username: string): Promise<ApiResponse> {
  return page.request.post(`${base}/api/auth/login`, {
    data: { login: username, password: HARNESS_PASSWORD },
  });
}
