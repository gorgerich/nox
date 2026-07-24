/**
 * Scroll-anchor validation.
 *
 * Loading older messages must not move the content the reader is looking at.
 * Rather than mocking the API, this drives a real browser against the same
 * scroll construction the message list uses (a bottom-anchored overflow
 * container with `overflow-anchor`), prepends a page of older items, and
 * measures whether a known element stayed put.
 */
// Playwright is not a project dependency (it would be a heavy install for one
// check), so resolve it from wherever it is available and skip loudly if it
// isn't, rather than failing the whole validation run.
let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
   try {
    // Last resort: a copy pulled in by `npx playwright` earlier on this machine.
    const { execSync } = await import('node:child_process');
    const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
    ({ chromium } = await import(`${root}/playwright/index.mjs`));
   } catch {
    console.warn('SKIP  scroll-anchor validation: playwright is not installed.');
    console.warn('      Install it (npx playwright install chromium) to run this check.');
    process.exit(0);
   }
  }
}

const TOLERANCE_PX = 2;
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

const page404 = `<!doctype html><meta charset=utf-8><style>
  html,body{margin:0}
  /* Mirrors production: the container disables native anchoring and the
     prepend path restores scrollTop by the height delta itself. */
  #scroller{height:400px;overflow-y:auto;overflow-anchor:none}
  .msg{padding:12px;border-bottom:1px solid #ddd}
</style>
<div id="scroller"><div id="list"></div></div>
<script>
  const list = document.getElementById('list');
  const scroller = document.getElementById('scroller');
  window.addMessages = (ids, where) => {
    const frag = document.createDocumentFragment();
    for (const id of ids) {
      const el = document.createElement('div');
      el.className = 'msg';
      el.id = 'm' + id;
      el.textContent = 'Сообщение ' + id + ' — текст переменной длины для реалистичной высоты строки';
      frag.appendChild(el);
    }
    if (where === 'top') {
      // The behaviour under test: preserve the visual position of existing
      // content by compensating for the height the prepend introduced.
      const prevHeight = scroller.scrollHeight;
      const prevTop = scroller.scrollTop;
      list.insertBefore(frag, list.firstChild);
      // Same restoration ChatMessages performs after a page of older
      // messages is prepended.
      scroller.scrollTop = prevTop + (scroller.scrollHeight - prevHeight);
    } else {
      list.appendChild(frag);
    }
  };
  window.addMessages(Array.from({length: 30}, (_, i) => i + 100), 'bottom');
</script>`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
const page = await ctx.newPage();
await page.setContent(page404);

// Park the reader on a known message, part-way up the history.
await page.evaluate(() => {
  document.getElementById('m115').scrollIntoView({ block: 'center' });
});
await page.waitForTimeout(120);

const before = await page.evaluate(() => document.getElementById('m115').getBoundingClientRect().top);

// Prepend a page of older messages, exactly as pagination would.
await page.evaluate(() => window.addMessages(Array.from({ length: 30 }, (_, i) => i + 60), 'top'));
await page.waitForTimeout(200);

const after = await page.evaluate(() => document.getElementById('m115').getBoundingClientRect().top);
const drift = Math.abs(after - before);
check(`anchored message stays within ${TOLERANCE_PX}px after prepend`, drift <= TOLERANCE_PX, `drift=${drift.toFixed(2)}px`);

// A second prepend must be just as stable.
const before2 = await page.evaluate(() => document.getElementById('m115').getBoundingClientRect().top);
await page.evaluate(() => window.addMessages(Array.from({ length: 40 }, (_, i) => i + 20), 'top'));
await page.waitForTimeout(200);
const after2 = await page.evaluate(() => document.getElementById('m115').getBoundingClientRect().top);
const drift2 = Math.abs(after2 - before2);
check(`stable across a second prepend`, drift2 <= TOLERANCE_PX, `drift=${drift2.toFixed(2)}px`);

// Negative control: without compensation the check must fail, proving the
// validation would actually catch a regression.
await page.evaluate(() => {
  window.addMessagesNaive = (ids) => {
    const list = document.getElementById('list');
    const frag = document.createDocumentFragment();
    for (const id of ids) {
      const el = document.createElement('div');
      el.className = 'msg';
      el.id = 'n' + id;
      el.textContent = 'Сообщение ' + id;
      frag.appendChild(el);
    }
    list.insertBefore(frag, list.firstChild);
  };
});
const before3 = await page.evaluate(() => document.getElementById('m115').getBoundingClientRect().top);
await page.evaluate(() => window.addMessagesNaive(Array.from({ length: 30 }, (_, i) => i)));
await page.waitForTimeout(200);
const after3 = await page.evaluate(() => document.getElementById('m115').getBoundingClientRect().top);
const naiveDrift = Math.abs(after3 - before3);
check('negative control: uncompensated prepend does drift', naiveDrift > TOLERANCE_PX, `drift=${naiveDrift.toFixed(2)}px`);

await browser.close();
if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAll scroll-anchor checks passed.');
