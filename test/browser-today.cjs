// Real-browser check of Today: the first-run checklist, the check-in that collapses to one line with Undo, and the
// activity picker: groups start open so a new list shows buttons, a logged activity turns green with a count
// and -/+ buttons in place, and groups the person opens stay open.
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

    // A new account gets the first-run checklist, with nothing ticked yet.
    await page.locator('#onboarding').waitFor();
    assert.equal(await page.locator('#onboarding li.done').count(), 0, 'nothing is ticked before anything is logged');

    // The check-in collapses to one line once chosen; changing or clearing it offers Undo.
    await page.locator('#checkin [data-s="amber"]').click();
    await saved(page);
    assert.ok(await page.locator('#checkin-done').isVisible(), 'a chosen check-in becomes one line');
    assert.equal(await page.locator('#checkin').isVisible(), false);
    assert.match(await page.locator('#checkin-done-text').textContent(), /Amber/);
    assert.ok(await page.locator('#step-checkin.done').count(), 'the check-in step ticks itself');
    await page.locator('#checkin-change').click();
    await page.locator('#checkin [data-s="amber"]').click(); // tapping the chosen one clears it
    await saved(page);
    assert.match(await page.locator('#advice').textContent(), /Pick one/);
    await page.locator('#toastbar button', { hasText: 'Undo' }).click();
    await saved(page);
    assert.match(await page.locator('#checkin-done-text').textContent(), /Amber/, 'Undo restores the cleared check-in');

    // Groups start open, so a new list shows buttons straight away; nothing is pinned yet.
    const initial = await groups(page);
    assert.ok(initial.length >= 2, 'the default list has several groups');
    assert.deepEqual(initial.filter(x => !x), [], 'every group starts open');
    assert.equal(await page.locator('#acts .act.on').count(), 0, 'nothing is logged yet');

    // Log the first group's first activity.
    const firstButton = page.locator('#acts details.act-group[open] button.act').first();
    const name = (await firstButton.locator('span').first().textContent()).trim();
    const inList = el => el.evaluate(e => { const a = e.getBoundingClientRect(), b = document.getElementById('acts').getBoundingClientRect(); return { x: a.x - b.x, y: a.y - b.y } });
    const before = await inList(firstButton);
    const beforeHeight = await firstButton.evaluate(el => el.getBoundingClientRect().height);
    await firstButton.click();
    await saved(page);

    const card = page.locator('#acts details.act-group .act.on', { hasText: name }).first();
    await card.waitFor();
    const after = await inList(card);
    assert.ok(Math.abs(await card.evaluate(el => el.getBoundingClientRect().height) - beforeHeight) < 2, "selection keeps the tile height");
    assert.equal(await page.getByRole("heading", { name: "So far", exact: true }).count(), 0);
    assert.ok(Math.abs(after.y - before.y) < 2 && Math.abs(after.x - before.x) < 2, 'a logged activity changes in place instead of moving');
    assert.equal(await page.locator('#onboarding li.done').count(), 2, 'both first steps are ticked');
    assert.match(await page.locator('#onboarding-title').textContent(), /set up/, 'the finished checklist stays up for now');
    assert.equal((await card.locator('.count').textContent()).trim(), '×1');
    assert.equal(await page.locator('#acts details.act-group button.act', { hasText: name }).count(), 0, 'the plain button became the logged card');
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

    // Closing every group hides everything, logged or not; reopening shows the card where it was.
    while (await page.locator('#acts details.act-group[open] summary').count()) await page.locator('#acts details.act-group[open] summary').first().click();
    assert.deepEqual((await groups(page)).filter(Boolean), []);
    assert.equal(await card.isVisible(), false, 'a logged activity lives in its group');
    await page.locator('#acts details.act-group summary').first().click();
    assert.ok(await card.isVisible());

    // A group the person opened stays open after tapping inside it.
    await page.locator('#acts details.act-group summary').nth(1).click();
    await page.locator('#acts details.act-group[open] button.act').first().click();
    await saved(page);
    assert.equal((await groups(page)).filter(Boolean).length, 2, 'the opened groups stay open after tapping');

    // Taking the last one off returns the plain button.
    await card.locator('[data-step="-1"]').click();
    await card.locator('[data-step="-1"]').click();
    await saved(page);
    assert.equal(await page.locator('#acts .act.on', { hasText: name }).count(), 0);
    assert.equal(await page.locator('#acts button.act', { hasText: name }).count(), 1, 'the plain button is back');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal overflow at phone width');

    // The new visual must preserve the ledger's full value: a bounded ring
    // must never hide overspending, recovery above the allowance, or a zero allowance.
    for (const sample of [
      { status: 'green', penalty: 0, costs: [4], left: 6, fill: 60, level: 'ready' },
      { status: 'green', penalty: 0, costs: [7, 7], left: -4, fill: 0, level: 'over' },
      { status: 'green', penalty: 0, costs: [-3], left: 13, fill: 100, level: 'ready' },
      { status: 'red', penalty: 10, costs: [], left: 0, fill: 0, level: 'empty' },
    ]) {
      const status = await page.evaluate(async sample => {
        const now = new Date(), date = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const id = 'd-' + date, docs = await (await fetch('/api/docs')).json();
        const body = { date, budget: 10, sleepPenalty: 3, status: sample.status, statusPenalty: sample.penalty,
          entries: sample.costs.map((c,i) => ({ id: 'visual-'+i, a: 'Visual check '+i, c, t: '10:00' })) };
        const response = await fetch('/api/docs/'+id, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'jiggered', 'If-Match': `"${docs[id].rev}"` }, body: JSON.stringify(body) });
        return response.status;
      }, sample);
      assert.equal(status, 200, 'sample accepted by the real document API');
      await page.reload(); await saved(page);
      assert.equal(Number((await page.locator('#left').textContent()).trim().split(/\s/)[0]), sample.left, 'readout preserves the full balance');
      assert.equal(Number((await page.locator('#energy-progress').getAttribute('stroke-dasharray')).split(' ')[0]), sample.fill, 'ring reflects the allowance');
      assert.equal(await page.locator('#energy-visual').getAttribute('data-level'), sample.level);
    }
    await page.locator('#t-history').click();
    assert.equal(await page.locator('#view-heading').textContent(), 'Your days, in perspective.');
    await page.reload(); await saved(page);
    assert.equal(await page.locator('#view-heading').textContent(), 'Your days, in perspective.', 'view heading survives a direct reload');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.locator('#energy-progress').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    assert.deepEqual(errors, []);
    console.log('PASS: Today: checklist, check-in/Undo, groups, logged-in-place activity controls, live energy ring including negative/above-budget/zero allowance, view headings and reduced motion');
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
