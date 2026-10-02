// Real-browser checks at phone width. Account: the page is short until a list is opened, a shortcut opens exactly the
// list it names, collapsing keeps what was typed, and a validation error opens the list it is in. History: with almost
// no data the calendar remains available, optional sections keep filters in place, and Prepare summary moves focus
// clear of the sticky tab bar. Episodes: an offline save that is recovered across a reload still ends with
// a truthful confirmation and reaches the server.
// Needs Playwright (see the README); run with `node test/browser-mobile.cjs`. It builds a temporary binary and database.
const assert = require("node:assert/strict");
const { runBrowser } = require("./support/browser.cjs");
const saved = (page) =>
  page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
const section = (page, key) => page.locator(`#settings-panel details[data-section="${key}"]`);
const openKeys = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("#settings-panel details[data-section]")]
      .filter((d) => d.open)
      .map((d) => d.dataset.section),
  );

runBrowser({ name: "mobile", portEnv: "JIGGERED_MOBILE_PORT" }, async (harness) => {
  const browser = await harness.launchBrowser();
  const { base } = harness;
  const page = await (
    await browser.newContext({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base + "/login");
  await page.locator("#username").fill("tester");
  await page.locator("#password").fill("local-preview-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("#t-account").waitFor();
  await saved(page);

  // 1. The page is short with every list closed (it was about 20,000 px with the default lists open), with counts.
  await page.locator("#t-account").click();
  await section(page, "acts").waitFor();
  assert.deepEqual(await openKeys(page), [], "every list starts closed");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  assert.ok(
    height < 8000,
    `the Account page is ${height}px tall at phone width; it should be well under the old ~20,000px`,
  );
  for (const key of ["acts", "sym", "trig"]) {
    const rows = await page.locator(`#set-${key} [data-row]`).count();
    assert.match(
      (await section(page, key).locator("summary [data-count]").textContent()).trim(),
      new RegExp(`^\\(${rows}\\)$`),
      `the ${key} summary shows its ${rows} items`,
    );
  }

  // 2. A shortcut from Today opens the list it names and no other, with focus inside it.
  await page.locator("#t-today").click();
  await page.locator('#today-panel [data-settings="set-acts"]:visible').first().click();
  await page.waitForFunction(
    () => document.querySelector('#settings-panel details[data-section="acts"]')?.open,
  );
  assert.deepEqual(await openKeys(page), ["acts"], "only Activities opened");
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest('details[data-section="acts"]')),
    true,
    "focus is inside the Activities list",
  );

  // 3. Collapsing keeps what was typed, and it saves and survives a reload.
  const firstName = page.locator("#set-acts [data-row] input[type=text]:not(.order-group)").first();
  await firstName.fill("Renamed first activity");
  await section(page, "acts").locator("summary").click();
  assert.equal(await section(page, "acts").evaluate((d) => d.open), false, "collapsed");
  await section(page, "acts").locator("summary").click();
  assert.equal(
    await firstName.inputValue(),
    "Renamed first activity",
    "the typed name is still there after collapsing and reopening",
  );
  await page.locator("#setform [type=submit]").click();
  await page.locator("#set-msg").filter({ hasText: "Saved." }).waitFor();
  await saved(page);
  await page.reload();
  await page.locator("#t-account").click();
  await section(page, "acts").locator("summary").click();
  assert.equal(
    await page
      .locator("#set-acts [data-row] input[type=text]:not(.order-group)")
      .first()
      .inputValue(),
    "Renamed first activity",
    "saved and reloaded",
  );

  // 4. A validation error inside a closed list opens that list instead of failing out of sight.
  const names = page.locator("#set-acts [data-row] input[type=text]:not(.order-group)");
  await names.nth(1).fill(await names.first().inputValue()); // two activities with the same name
  await section(page, "acts").locator("summary").click();
  assert.equal(await section(page, "acts").evaluate((d) => d.open), false);
  await page.locator("#setform [type=submit]").click();
  await page.waitForFunction(
    () => document.querySelector('#settings-panel details[data-section="acts"]')?.open,
  );
  assert.equal(await page.locator("#set-msg.err, #set-msg").first().isVisible(), true);
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest('details[data-section="acts"]')),
    true,
    "focus moves to the problem inside the opened list",
  );

  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    "no horizontal overflow at phone width",
  );

  // 5. History with one day and one episode: calendar, optional detail and a summary using the current search.
  await page.evaluate(async () => {
    const today = new Date(),
      pad = (n) => String(n).padStart(2, "0"),
      date = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const headers = {
      "Content-Type": "application/json",
      "X-Requested-With": "jiggered",
      "If-None-Match": "*",
    };
    await fetch("/api/docs/d-" + date, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        date,
        status: "green",
        entries: [{ id: "a1", a: "Walk", c: -1, t: "09:00" }],
      }),
    });
    await fetch("/api/docs/e-1790000000000", {
      method: "PUT",
      headers,
      body: JSON.stringify({
        when: date + "T09:00",
        symptoms: ["Headache"],
        before: [],
        notes: "",
      }),
    });
  });
  await page.reload();
  await saved(page);
  await page.locator("#t-history").click();
  await page.waitForFunction(() =>
    /1 day and 1 episode/.test(document.getElementById("history-count").textContent),
  );
  assert.match(
    await page.locator("#history-insights").textContent(),
    /Patterns need at least a few/,
    "a nearly empty history shows the short note, not the full insight cards",
  );
  const historyHeight = await page.evaluate(() => document.documentElement.scrollHeight);

  await page.evaluate(() => {
    document.getElementById("history-filter-panel").open = true;
  });
  await page.locator("#hist-query").fill("walk");
  await page.waitForFunction(
    () => !/Updating/.test(document.getElementById("history-count").textContent),
  );
  // Optional detail is reachable by a native summary or the primary action, with the search intact.
  for (const id of ["history-records", "history-explore"]) {
    await page.locator(`#${id} > summary`).click();
    assert.equal(await page.locator(`#${id}`).getAttribute("open"), "");
    assert.equal(
      await page.locator(`#${id} > summary`).evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(await page.locator("#hist-query").inputValue(), "walk");
    await page.locator(`#${id} > summary`).click();
  }
  await page.locator("#history-prepare").click();
  await page.waitForFunction(() => {
    const heading = document.querySelector("#history-share > summary h2").getBoundingClientRect();
    const nav = document.querySelector("nav").getBoundingClientRect();
    return (
      heading.top >= (nav.top > innerHeight / 2 ? 0 : nav.bottom) && heading.top < innerHeight - 100
    );
  });
  assert.equal(
    await page
      .locator("#history-share > summary h2")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  assert.equal(await page.locator("#summary-preview").isVisible(), true);
  assert.equal(await page.locator("#hist-query").inputValue(), "walk");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
    "no horizontal overflow on History",
  );

  // 6. An offline episode save, then the connection returns while the page reloads: the save may finish before the
  // form has restored its draft, and it must still end with a confirmation (and the note must reach the server).
  const context = page.context();
  await page.locator("#t-episode").click();
  await page.locator("#ep-notes").fill("Saved while offline, confirmed after reload");
  await context.setOffline(true);
  await page.locator("#ep-save").click();
  await page.locator("#eptoast").filter({ hasText: "queued on this device" }).waitFor();
  assert.ok(
    !(await page.locator("#eptoast").textContent()).includes("Saved."),
    "queued is not claimed as saved",
  );
  await context.setOffline(false);
  await page.reload();
  await page.locator("#t-episode").click();
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  await page.locator("#eptoast").filter({ hasText: "Saved." }).waitFor({ timeout: 10000 });
  assert.equal(
    await page.locator("#ep-notes").inputValue(),
    "",
    "the form is clear once the save is confirmed",
  );
  const exported = await (await context.request.get(base + "/api/export")).json();
  assert.ok(
    Object.values(exported).some((d) => d.notes === "Saved while offline, confirmed after reload"),
    "the note reached the server",
  );
  assert.deepEqual(errors, []);
  console.log(
    `PASS: Account lists (${height}px tall when closed): counts, one list per shortcut, values survive collapsing, an error opens its list. History (${historyHeight}px with one day and one episode): calendar, optional sections and Prepare summary keep the search and clear the tab bar. Offline episode save recovered across a reload ends with Saved.`,
  );
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
