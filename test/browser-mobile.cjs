// Real-browser checks at phone width. Account: the page is short until a list is opened, a shortcut opens exactly the
// list it names, collapsing keeps what was typed, and a validation error opens the list it is in. History: with almost
// no data the overview is compact, and the Records and Share shortcuts only scroll and focus (filters stay put) and
// are not hidden under the sticky tab bar. Episodes: an offline save that is recovered across a reload still ends with
// a truthful confirmation and reaches the server.
// Needs Playwright (see the README); run with `node test/browser-mobile.cjs`. It builds a temporary binary and database.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jiggered-mobile-'));
const binary = process.env.JIGGERED_TEST_BINARY || path.join(dir, 'jiggered');
if (!process.env.JIGGERED_TEST_BINARY) execFileSync(process.env.GO_BINARY || 'go', ['build', '-o', binary, '.']);
const base = 'http://127.0.0.1:' + (process.env.JIGGERED_MOBILE_PORT || '18753');
const server = spawn(binary, [], {
  env: { ...process.env, APP_ADDR: new URL(base).host, APP_DB: dir + '/mobile.db', APP_USERNAME: 'tester', APP_PASSWORD: 'local-preview-password', APP_SECURE_COOKIE: 'false' },
  stdio: ['ignore', 'ignore', 'pipe'],
});
let logs = '';
server.stderr.on('data', b => (logs += b.toString()));

const saved = page => page.waitForFunction(() => document.querySelector('#sync')?.dataset.state === 'saved');
const section = (page, key) => page.locator(`#settings-panel details[data-section="${key}"]`);
const openKeys = page => page.evaluate(() => [...document.querySelectorAll('#settings-panel details[data-section]')].filter(d => d.open).map(d => d.dataset.section));

(async () => {
  let browser;
  try {
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(base + '/healthz')).ok) break; } catch { /* still starting */ }
      await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true, ...(process.env.JIGGERED_BROWSER_PATH ? { executablePath: process.env.JIGGERED_BROWSER_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true })).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(base + '/login');
    await page.locator('#username').fill('tester');
    await page.locator('#password').fill('local-preview-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('#t-account').waitFor();
    await saved(page);

    // 1. The page is short with every list closed (it was about 20,000 px with the default lists open), with counts.
    await page.locator('#t-account').click();
    await section(page, 'acts').waitFor();
    assert.deepEqual(await openKeys(page), [], 'every list starts closed');
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    assert.ok(height < 8000, `the Account page is ${height}px tall at phone width; it should be well under the old ~20,000px`);
    for (const key of ['acts', 'sym', 'trig']) {
      const rows = await page.locator(`#set-${key} [data-row]`).count();
      assert.match((await section(page, key).locator('summary [data-count]').textContent()).trim(), new RegExp(`^\\(${rows}\\)$`), `the ${key} summary shows its ${rows} items`);
    }

    // 2. A shortcut from Today opens the list it names and no other, with focus inside it.
    await page.locator('#t-today').click();
    await page.locator('#today-panel [data-settings="set-acts"]').first().click();
    await page.waitForFunction(() => document.querySelector('#settings-panel details[data-section="acts"]')?.open);
    assert.deepEqual(await openKeys(page), ['acts'], 'only Activities opened');
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('details[data-section="acts"]')), true, 'focus is inside the Activities list');

    // 3. Collapsing keeps what was typed, and it saves and survives a reload.
    const firstName = page.locator('#set-acts [data-row] input[type=text]:not(.order-group)').first();
    await firstName.fill('Renamed first activity');
    await section(page, 'acts').locator('summary').click();
    assert.equal(await section(page, 'acts').evaluate(d => d.open), false, 'collapsed');
    await section(page, 'acts').locator('summary').click();
    assert.equal(await firstName.inputValue(), 'Renamed first activity', 'the typed name is still there after collapsing and reopening');
    await page.locator('#setform [type=submit]').click();
    await page.locator('#set-msg').filter({ hasText: 'Saved.' }).waitFor();
    await saved(page);
    await page.reload();
    await page.locator('#t-account').click();
    await section(page, 'acts').locator('summary').click();
    assert.equal(await page.locator('#set-acts [data-row] input[type=text]:not(.order-group)').first().inputValue(), 'Renamed first activity', 'saved and reloaded');

    // 4. A validation error inside a closed list opens that list instead of failing out of sight.
    const names = page.locator('#set-acts [data-row] input[type=text]:not(.order-group)');
    await names.nth(1).fill(await names.first().inputValue()); // two activities with the same name
    await section(page, 'acts').locator('summary').click();
    assert.equal(await section(page, 'acts').evaluate(d => d.open), false);
    await page.locator('#setform [type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#settings-panel details[data-section="acts"]')?.open);
    assert.equal(await page.locator('#set-msg.err, #set-msg').first().isVisible(), true);
    assert.equal(await page.evaluate(() => !!document.activeElement?.closest('details[data-section="acts"]')), true, 'focus moves to the problem inside the opened list');

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal overflow at phone width');

    // 5. History with one day and one episode: compact overview, and shortcuts that reach the records and sharing.
    await page.evaluate(async () => {
      const today = new Date(), pad = n => String(n).padStart(2, '0'), date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
      const headers = { 'Content-Type': 'application/json', 'X-Requested-With': 'jiggered', 'If-None-Match': '*' };
      await fetch('/api/docs/d-' + date, { method: 'PUT', headers, body: JSON.stringify({ date, status: 'green', entries: [{ id: 'a1', a: 'Walk', c: -1, t: '09:00' }] }) });
      await fetch('/api/docs/e-1790000000000', { method: 'PUT', headers, body: JSON.stringify({ when: date + 'T09:00', symptoms: ['Headache'], before: [], notes: '' }) });
    });
    await page.reload();
    await saved(page);
    await page.locator('#t-history').click();
    await page.waitForFunction(() => /1 day and 1 episode/.test(document.getElementById('history-count').textContent));
    assert.match(await page.locator('#history-insights').textContent(), /Patterns need at least a few/, 'a nearly empty history shows the short note, not the full insight cards');
    const historyHeight = await page.evaluate(() => document.documentElement.scrollHeight);

    await page.locator('#hist-query').fill('walk');
    await page.waitForFunction(() => !/Updating/.test(document.getElementById('history-count').textContent));
    const nav = () => page.evaluate(() => document.querySelector('nav').getBoundingClientRect().bottom);
    for (const [target, panel] of [['history-records', '#history-records'], ['history-share', '#history-share']]) {
      await page.locator(`#history-shortcuts [data-history-target="${target}"]`).click();
      // On screen and clear of the tab bar. The last panel may stay lower down: the page cannot scroll past its end.
      await page.waitForFunction(sel => { const r = document.querySelector(sel + ' h2').getBoundingClientRect(); return r.top >= document.querySelector('nav').getBoundingClientRect().bottom && r.top < window.innerHeight - 40 }, panel, { timeout: 5000 });
      const top = await page.evaluate(sel => document.querySelector(sel + ' h2').getBoundingClientRect().top, panel);
      assert.ok(top >= (await nav()), `the ${target} heading (top ${Math.round(top)}) is not hidden under the sticky tab bar`);
      assert.equal(await page.evaluate(sel => document.activeElement === document.querySelector(sel + ' h2'), panel), true, 'focus moves to the heading');
      assert.equal(await page.locator('#hist-query').inputValue(), 'walk', 'the search is still there after jumping');
    }
    await page.locator('#history-shortcuts [data-history-target="trends-panel"]').click();
    await page.waitForFunction(() => { const t = document.getElementById('trends-panel').getBoundingClientRect().top; return t >= document.querySelector('nav').getBoundingClientRect().bottom && t < window.innerHeight - 40 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'no horizontal overflow on History');

    // 6. An offline episode save, then the connection returns while the page reloads: the save may finish before the
    // form has restored its draft, and it must still end with a confirmation (and the note must reach the server).
    const context = page.context();
    await page.locator('#t-episode').click();
    await page.locator('#ep-notes').fill('Saved while offline, confirmed after reload');
    await context.setOffline(true);
    await page.locator('#ep-save').click();
    await page.locator('#eptoast').filter({ hasText: 'queued on this device' }).waitFor();
    assert.ok(!(await page.locator('#eptoast').textContent()).includes('Saved.'), 'queued is not claimed as saved');
    await context.setOffline(false);
    await page.reload();
    await page.locator('#t-episode').click();
    await page.waitForFunction(() => document.querySelector('#sync')?.dataset.state === 'saved');
    await page.locator('#eptoast').filter({ hasText: 'Saved.' }).waitFor({ timeout: 10000 });
    assert.equal(await page.locator('#ep-notes').inputValue(), '', 'the form is clear once the save is confirmed');
    const exported = await (await context.request.get(base + '/api/export')).json();
    assert.ok(Object.values(exported).some(d => d.notes === 'Saved while offline, confirmed after reload'), 'the note reached the server');
    assert.deepEqual(errors, []);
    console.log(`PASS: Account lists (${height}px tall when closed): counts, one list per shortcut, values survive collapsing, an error opens its list. History (${historyHeight}px with one day and one episode): compact overview, Records/Share/Overview shortcuts keep the search and clear the tab bar. Offline episode save recovered across a reload ends with Saved.`);
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
