// Real-browser check of the Today activity picker: groups start closed, a logged activity turns green with a count
// and -/+ buttons, and it stays pinned at the top however the groups below are opened or closed.
// Needs Playwright (see the README); run with `node test/browser-today.cjs`. It builds a temporary binary and database.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiggered-today-'));
const binary = process.env.JIGGERED_TEST_BINARY || path.join(dir, 'jiggered');
if (!process.env.JIGGERED_TEST_BINARY) execFileSync(process.env.GO_BINARY || 'go', ['build', '-o', binary, '.']);
const base = 'http://127.0.0.1:' + (process.env.JIGGERED_TODAY_PORT || '18751');
const server = spawn(binary, [], {
  env: { ...process.env, APP_ADDR: new URL(base).host, APP_DB: dir + '/today.db', APP_USERNAME: 'tester', APP_PASSWORD: 'local-preview-password', APP_SECURE_COOKIE: 'false' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let logs = '';
server.stderr.on('data', b => (logs += b.toString()));

const saved = page => page.waitForFunction(() => document.querySelector('#sync')?.dataset.state === 'saved');
const groups = page => page.evaluate(() => [...document.querySelectorAll('#acts details.act-group')].map(d => d.open));

(async () => {
  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* still starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true, ...(process.env.JIGGERED_BROWSER_PATH ? { executablePath: process.env.JIGGERED_BROWSER_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 390, height: 900 } })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(base + '/login');
    await page.locator('#username').fill('tester');
    await page.locator('#password').fill('local-preview-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('#acts details.act-group').first().waitFor();
    await saved(page);

    // Groups start closed, and nothing is pinned yet.
    const initial = await groups(page);
    assert.ok(initial.length >= 2, 'the default list has several groups');
    assert.deepEqual(initial.filter(Boolean), [], 'every group starts closed');
    assert.equal(await page.locator('.act-picked').count(), 0, 'nothing is logged, so nothing is pinned');

    // Open the first group and log its first activity.
    await page.locator('#acts details.act-group summary').first().click();
    const firstButton = page.locator('#acts details.act-group[open] button.act').first();
    const name = (await firstButton.locator('span').first().textContent()).trim();
    await firstButton.click();
    await saved(page);

    const card = page.locator('.act-picked .act.on', { hasText: name });
    await card.waitFor();
    assert.equal((await card.locator('.count').textContent()).trim(), '×1');
    assert.match(await page.locator('.act-picked .label').textContent(), /Logged today/);
    assert.equal(await page.locator('#acts details.act-group button.act', { hasText: name }).count(), 0, 'a logged activity is not shown twice');
    const green = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--green').trim());
    const border = await card.evaluate(el => getComputedStyle(el).borderTopColor);
    assert.ok(green && border !== 'rgba(0, 0, 0, 0)', 'the card has a visible green border');
    assert.equal(await card.locator('[data-step="1"]').getAttribute('aria-label'), `Add one more ${name}`);
    assert.equal(await card.locator('[data-step="-1"]').getAttribute('aria-label'), `Remove one ${name}`);

    // + logs another, - takes one off (with Undo), and the entries list agrees at every step.
    const entries = () => page.locator('#entries li').count();
    assert.equal(await entries(), 1);
    await card.locator('[data-step="1"]').click();
    await saved(page);
    assert.equal((await card.locator('.count').textContent()).trim(), '×2');
    assert.equal(await entries(), 2);
    await card.locator('[data-step="-1"]').click();
    await saved(page);
    assert.equal((await card.locator('.count').textContent()).trim(), '×1');
    assert.equal(await entries(), 1);
    await page.locator('#toastbar button', { hasText: 'Undo removal' }).click();
    await saved(page);
    assert.equal((await card.locator('.count').textContent()).trim(), '×2', 'Undo puts the removed one back');

    // Pinned means pinned: closing every group leaves it in view.
    for (const open of await page.locator('#acts details.act-group[open] summary').all()) await open.click();
    assert.deepEqual((await groups(page)).filter(Boolean), []);
    assert.ok(await card.isVisible(), 'a logged activity stays visible with every group closed');

    // A group the person opened stays open after tapping inside it.
    await page.locator('#acts details.act-group summary').nth(1).click();
    await page.locator('#acts details.act-group[open] button.act').first().click();
    await saved(page);
    assert.equal((await groups(page)).filter(Boolean).length, 1, 'the opened group stays open');

    // Taking the last one off returns the plain button.
    await card.locator('[data-step="-1"]').click();
    await card.locator('[data-step="-1"]').click();
    await saved(page);
    assert.equal(await page.locator('.act-picked .act.on', { hasText: name }).count(), 0);
    assert.equal(await page.locator('#acts button.act', { hasText: name }).count(), 1, 'the plain button is back');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal overflow at phone width');
    assert.deepEqual(errors, []);
    console.log('PASS: Today picker: groups start closed, logged activities turn green with a count, -/+ and Undo, pinned with groups closed, opened group stays open, plain button returns');
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
