// Real-browser check of History search on a large account: typing a word updates the view once (after a short pause),
// says so while it waits, ends with the right results, and the other filters still react at once.
// Needs Playwright (see the README); run with `node test/browser-history.cjs`. It builds a temporary binary and database.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiggered-history-'));
const binary = process.env.JIGGERED_TEST_BINARY || path.join(dir, 'jiggered');
if (!process.env.JIGGERED_TEST_BINARY) execFileSync(process.env.GO_BINARY || 'go', ['build', '-o', binary, '.']);
const base = 'http://127.0.0.1:' + (process.env.JIGGERED_HISTORY_PORT || '18752');
const server = spawn(binary, [], {
  env: { ...process.env, APP_ADDR: new URL(base).host, APP_DB: dir + '/history.db', APP_USERNAME: 'tester', APP_PASSWORD: 'local-preview-password', APP_SECURE_COOKIE: 'false' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let logs = '';
server.stderr.on('data', b => (logs += b.toString()));

const DAYS = 600; // every day has a check-in; even-numbered days also log "Walk"
const EPISODES = 900;

(async () => {
  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* still starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true, ...(process.env.JIGGERED_BROWSER_PATH ? { executablePath: process.env.JIGGERED_BROWSER_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(base + '/login');
    await page.locator('#username').fill('tester');
    await page.locator('#password').fill('local-preview-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('#t-history').waitFor();

    // Seed through the real API, then reload so the page loads the whole account as a snapshot.
    const seeded = await page.evaluate(async ([days, episodes]) => {
      const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'jiggered', 'If-None-Match': '*' };
      const jobs = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
        jobs.push(['d-' + date, { date, status: ['green', 'amber', 'red'][i % 3], entries: i % 2 === 0 ? [{ id: 'w' + i, a: 'Walk', c: -2, t: '09:00' }, { id: 'k' + i, a: 'Work', c: 3, t: '11:00' }] : [{ id: 'k' + i, a: 'Work', c: 3, t: '11:00' }] }]);
      }
      for (let i = 0; i < episodes; i++) {
        const date = new Date(Date.UTC(2024, 0, 1) + (i % days) * 86400000).toISOString().slice(0, 10);
        jobs.push(['e-' + (1700000000000 + i * 1000), { when: date + 'T09:00', symptoms: ['Headache'], before: ['Poor sleep'], notes: 'n'.repeat(1500) }]);
      }
      let ok = 0;
      for (let i = 0; i < jobs.length; i += 25) {
        const results = await Promise.all(jobs.slice(i, i + 25).map(([id, body]) => fetch('/api/docs/' + id, { method: 'PUT', headers, body: JSON.stringify(body) })));
        ok += results.filter(r => r.status === 200).length;
      }
      return ok;
    }, [DAYS, EPISODES]);
    assert.equal(seeded, DAYS + EPISODES, 'every seeded document was accepted');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#sync')?.dataset.state === 'saved');

    await page.locator('#t-history').click();
    await page.locator('#history-presets [data-range="all"]').click();
    await page.waitForFunction(([d, e]) => new RegExp(`${d} days? and ${e} episodes?`).test(document.getElementById('history-count').textContent), [DAYS, EPISODES]);

    // One word, typed quickly, is one update: count how many times the charts are rebuilt while it is typed.
    await page.evaluate(() => {
      window.__rebuilds = 0;
      new MutationObserver(() => { window.__rebuilds++; }).observe(document.getElementById('history-charts'), { childList: true });
    });
    await page.evaluate(() => { document.getElementById('history-filter-panel').open = true });
    await page.locator('#hist-query').click();
    await page.keyboard.type('walk', { delay: 40 });
    assert.equal((await page.locator('#history-count').textContent()).trim(), 'Updating…', 'it says it is working while it waits for a pause');
    const expectedDays = Math.ceil(DAYS / 2);
    await page.waitForFunction(n => new RegExp(`^${n} days? and 0 episodes?`).test(document.getElementById('history-count').textContent.trim()), expectedDays);
    const rebuilds = await page.evaluate(() => window.__rebuilds);
    assert.ok(rebuilds >= 1 && rebuilds <= 2, `typing "walk" rebuilt the charts ${rebuilds} times; once (at most twice for the markup swap) is expected, not once per letter`);
    assert.equal(await page.locator('#days li').count() > 0, true, 'matching days are listed');
    assert.match(await page.locator('#days').first().textContent(), /\d/, 'the list shows days');

    // Enter does not wait for the pause.
    await page.locator('#hist-query').fill('');
    await page.waitForFunction(([d, e]) => new RegExp(`^${d} days? and ${e} episodes?`).test(document.getElementById('history-count').textContent.trim()), [DAYS, EPISODES]);
    await page.locator('#hist-query').pressSequentially('headache');
    await page.keyboard.press('Enter');
    await page.waitForFunction(n => new RegExp(`^0 days and ${n} episodes?`).test(document.getElementById('history-count').textContent.trim()), EPISODES);

    // Other filters react at once, and the search still applies on top of them.
    await page.locator('#hist-query').fill('');
    await page.waitForFunction(([d, e]) => new RegExp(`^${d} days? and ${e} episodes?`).test(document.getElementById('history-count').textContent.trim()), [DAYS, EPISODES]);
    // Changing the select and reading the count in the same tick: only a synchronous update can have changed it.
    const right = await page.evaluate(() => {
      const select = document.getElementById('hist-status');
      select.value = 'red';
      select.dispatchEvent(new Event('input', { bubbles: true }));
      return document.getElementById('history-count').textContent.trim();
    });
    assert.match(right, new RegExp(`^${Math.floor(DAYS / 3)} days? and`), 'a select changes the view at once, without the search pause');

    assert.deepEqual(errors, []);
    console.log(`PASS: History search on ${DAYS} days and ${EPISODES} episodes: one update per typed word with "Updating…" shown, correct results, Enter and selects immediate`);
  } catch (e) {
    console.error(e.stack);
    if (logs) console.error(logs);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    server.kill();
    await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();
