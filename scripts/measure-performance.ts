/**
 * Performance measurement against a production build.
 *   npm run measure:performance
 *
 * A looking tool, not a gate. It reports; it asserts nothing. The point is to
 * have numbers before changing anything, and the same numbers afterwards.
 *
 * What it measures, and why each one is here:
 *
 *   - cold load per screen: TTFB, first paint, largest paint, DOM ready. The
 *     web app is judged against a native one, and a native app does not show
 *     a blank screen while a bundle downloads.
 *   - transferred bytes, split by type. On a phone the download is the cost.
 *   - long tasks: any main-thread block over 50ms is a frame the user's touch
 *     cannot reach.
 *   - layout shift: content moving under a thumb that is already reaching for
 *     it is the single most un-native thing an interface can do.
 *   - chat open: the interaction the messenger lives or dies by, measured from
 *     the tap to the first message painted.
 *   - scroll: frame intervals during a real fling, reported as the worst ones
 *     rather than the average, because the average hides exactly the stutter
 *     the hand feels.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
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

const PORT = Number(process.env.PERF_PORT ?? 4017);
const RUNS = Number(process.env.PERF_RUNS ?? 5);
const OUT = join(process.cwd(), "docs/perf");

type Timings = {
  ttfb: number;
  domContentLoaded: number;
  firstPaint: number;
  largestPaint: number;
  transferredKb: number;
  scriptKb: number;
  longTasks: number;
  longTaskMs: number;
  cls: number;
};

const COLLECT = `(() => {
  const nav = performance.getEntriesByType('navigation')[0];
  const paints = performance.getEntriesByType('paint');
  const resources = performance.getEntriesByType('resource');
  const sum = (list) => list.reduce((total, entry) => total + (entry.transferSize || 0), 0);
  const scripts = resources.filter((entry) => entry.initiatorType === 'script' || /\\.js(\\?|$)/.test(entry.name));
  return {
    ttfb: nav ? nav.responseStart - nav.requestStart : -1,
    domContentLoaded: nav ? nav.domContentLoadedEventEnd - nav.startTime : -1,
    firstPaint: paints.find((p) => p.name === 'first-contentful-paint')?.startTime ?? -1,
    largestPaint: window.__lcp ?? -1,
    transferredKb: Math.round((sum(resources) + (nav?.transferSize || 0)) / 1024),
    scriptKb: Math.round(sum(scripts) / 1024),
    longTasks: (window.__longTasks || []).length,
    longTaskMs: Math.round((window.__longTasks || []).reduce((t, d) => t + d, 0)),
    cls: Math.round((window.__cls || 0) * 10000) / 10000,
  };
})()`;

/** Installed before any app code so nothing is missed. */
const OBSERVERS = `
  window.__longTasks = [];
  window.__cls = 0;
  window.__lcp = -1;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch {}
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      window.__lcp = entries[entries.length - 1].startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
`;

function median(values: number[]): number {
  if (values.length === 0) return -1;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function report(label: string, samples: Timings[]) {
  const pick = (key: keyof Timings) => median(samples.map((s) => s[key]));
  console.log(`\n${label}`);
  console.log(`  TTFB              ${Math.round(pick("ttfb"))} ms`);
  console.log(`  first paint       ${Math.round(pick("firstPaint"))} ms`);
  console.log(`  largest paint     ${Math.round(pick("largestPaint"))} ms`);
  console.log(`  DOM ready         ${Math.round(pick("domContentLoaded"))} ms`);
  console.log(`  transferred       ${Math.round(pick("transferredKb"))} kB  (script ${Math.round(pick("scriptKb"))} kB)`);
  console.log(`  long tasks        ${Math.round(pick("longTasks"))} blocking ${Math.round(pick("longTaskMs"))} ms`);
  console.log(`  layout shift      ${pick("cls")}`);
  return {
    label,
    ttfb: pick("ttfb"),
    firstPaint: pick("firstPaint"),
    largestPaint: pick("largestPaint"),
    domContentLoaded: pick("domContentLoaded"),
    transferredKb: pick("transferredKb"),
    scriptKb: pick("scriptKb"),
    longTasks: pick("longTasks"),
    longTaskMs: pick("longTaskMs"),
    cls: pick("cls"),
  };
}

async function main() {
  const url = await requireIsolatedDatabase();
  const prisma = createPrisma(url);
  const stamp = Date.now();
  const me = await seedUser(prisma, randomUUID(), `perf${stamp}`);
  const peer = await seedUser(prisma, randomUUID(), `perfb${stamp}`);

  // A conversation with enough history that the list is doing real work.
  const chatId = await seedChat(prisma, {
    id: randomUUID(),
    type: "GROUP",
    owner: me.id,
    members: [me.id, peer.id],
    title: "Производительность",
  });
  for (let index = 0; index < 200; index += 1) {
    await prisma.message.create({
      data: {
        chatId,
        senderUserId: index % 2 === 0 ? me.id : peer.id,
        type: "TEXT",
        body: `Сообщение номер ${index + 1} — обычной длины, как в настоящей переписке.`,
        createdAt: new Date(Date.now() - (200 - index) * 60_000),
      },
    });
  }
  // And a list with enough chats to scroll.
  for (let index = 0; index < 25; index += 1) {
    const id = await seedChat(prisma, {
      id: randomUUID(),
      type: "GROUP",
      owner: me.id,
      members: [me.id, peer.id],
      title: `Чат ${index + 1}`,
    });
    await prisma.message.create({
      data: { chatId: id, senderUserId: peer.id, type: "TEXT", body: `Последнее сообщение ${index + 1}` },
    });
  }

  // Production, not dev: dev-mode numbers describe a compiler, not a product.
  const app = await startApp(url, PORT, { NODE_ENV: "production" });
  const { chromium } = await loadPlaywright();
  const browser: BrowserLike = await chromium.launch();

  const results: Record<string, unknown>[] = [];

  try {
    const measure = async (label: string, path: string) => {
      const samples: Timings[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        // A fresh context each run: a warm HTTP cache measures the second
        // visit, and the first visit is the one that decides whether the app
        // feels native or feels like a web page.
        const context: ContextLike = await browser.newContext({
          viewport: { width: 393, height: 852 },
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
        });
        await context.addInitScript(OBSERVERS);
        const page: PageLike = await context.newPage();
        await signIn(page, app.base, me.username);
        await page.goto(`${app.base}${path}`, { waitUntil: "networkidle" });
        await page.waitForTimeout(1200);
        samples.push((await page.evaluate(COLLECT)) as Timings);
        await context.close();
      }
      results.push(report(label, samples));
    };

    await measure("cold: chat list", "/chats");
    await measure("cold: conversation (200 messages)", `/chats/${chatId}`);
    await measure("cold: profile", "/profile");

    // --- the interaction, not the page load --------------------------------
    {
      const context: ContextLike = await browser.newContext({
        viewport: { width: 393, height: 852 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
      });
      await context.addInitScript(OBSERVERS);
      const page: PageLike = await context.newPage();
      await signIn(page, app.base, me.username);
      await page.goto(`${app.base}/chats`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);

      const opens: number[] = [];
      for (let run = 0; run < RUNS; run += 1) {
        await page.goto(`${app.base}/chats`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(700);
        const row = page.locator(`a[href="/chats/${chatId}"]`).first();
        if ((await row.count()) === 0) break;
        const started = await page.evaluate(`performance.now()`);
        await row.click();
        await page.getByText("Сообщение номер 200", { exact: false }).first().waitFor({ state: "attached", timeout: 20_000 });
        const ended = await page.evaluate(`performance.now()`);
        opens.push((ended as number) - (started as number));
      }
      if (opens.length > 0) {
        console.log(`\ninteraction: opening a conversation`);
        console.log(`  tap to first message   ${Math.round(median(opens))} ms   (runs: ${opens.map((o) => Math.round(o)).join(", ")})`);
        results.push({ label: "chat open", medianMs: median(opens), runs: opens });
      }

      // --- scroll, reported as the worst frames ----------------------------
      await page.goto(`${app.base}/chats/${chatId}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1500);
      await page.evaluate(`
        window.__frames = [];
        let last = performance.now();
        const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      `);
      for (let step = 0; step < 24; step += 1) {
        await page.mouse.wheel(0, -260);
        await page.waitForTimeout(24);
      }
      await page.waitForTimeout(400);
      const frames = (await page.evaluate(
        `(() => {
          const all = (window.__frames || []).slice(3);
          const sorted = [...all].sort((a, b) => a - b);
          const at = (q) => sorted.length ? Math.round(sorted[Math.floor(sorted.length * q)] * 100) / 100 : -1;
          return { count: all.length, median: at(0.5), p95: at(0.95), worst: Math.round(Math.max(...all, 0) * 100) / 100,
                   dropped: all.filter((f) => f > 20).length };
        })()`,
      )) as { count: number; median: number; p95: number; worst: number; dropped: number };
      console.log(`\nscroll: flinging a 200-message conversation`);
      console.log(`  frames            ${frames.count}`);
      console.log(`  median interval   ${frames.median} ms`);
      console.log(`  p95 interval      ${frames.p95} ms`);
      console.log(`  worst frame       ${frames.worst} ms`);
      console.log(`  over 20ms         ${frames.dropped}`);
      results.push({ label: "scroll", ...frames });

      await context.close();
    }
  } finally {
    await browser.close();
    await app.stop();
  }

  const path = join(OUT, `measurements-${process.env.PERF_TAG ?? "run"}.json`);
  try {
    writeFileSync(path, JSON.stringify(results, null, 2));
    console.log(`\nWritten to ${path}`);
  } catch {
    console.log("\n(no file written)");
  }
  process.exit(0);
}

void main();
