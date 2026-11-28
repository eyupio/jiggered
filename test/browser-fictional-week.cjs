const assert = require("node:assert/strict");
const { runBrowser } = require("./support/browser.cjs");
const fixture = require("./fixtures/energy-and-symptom-week.json");

const { baseline, expected } = fixture;
const loaded = (page) => page.locator("body:not(.app-loading) #t-today").waitFor();
const saved = (page) =>
  page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
const exportAccount = async (page) => {
  const response = await page.request.get("/api/export");
  assert.ok(response.ok(), "Account export succeeds");
  return response.json();
};

runBrowser({ name: "fictional-week" }, async (harness) => {
  const browser = await harness.launchBrowser();
  const errors = [];
  const pages = [];
  for (const [name, width, colorScheme] of [
    ["desktop", 1440, "light"],
    ["phone", 390, "dark"],
  ]) {
    const phone = name === "phone";
    const context = await browser.newContext({
      baseURL: harness.base,
      viewport: { width, height: phone ? 844 : 1000 },
      isMobile: phone,
      hasTouch: phone,
      timezoneId: fixture.timeZone,
      colorScheme,
    });
    await context.clock.install({ time: new Date(fixture.clock) });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/login");
    await page.locator("#username").fill("tester");
    await page.locator("#password").fill("local-preview-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await loaded(page);
    await saved(page);

    const open = async (tab) => {
      const trigger = page.locator(`#t-${tab}`);
      if (phone) await trigger.tap();
      else {
        await trigger.focus();
        await trigger.press("Enter");
      }
      await page.locator(`#${tab}-panel`).waitFor();
    };
    pages.push({ name, page, open });
    for (const [tab, marker] of [
      ["today", "#onboarding"],
      ["plan", "#plan-start-add"],
      ["episode", "#ep-when"],
      ["history", "#history-range"],
    ]) {
      await open(tab);
      await page.locator(marker).waitFor();
      await harness.screenshot(page, `week-fresh-${name}-${tab}.png`);
    }
    assert.deepEqual(
      Object.keys(await exportAccount(page)),
      ["settings"],
      "the fresh Account has only automatically seeded settings",
    );
  }

  const desktop = pages[0].page;
  // Each viewport has its own browser context and device copy.
  await pages[0].open("account");
  await desktop.locator("#account-tab-data").click();
  const fresh = await exportAccount(desktop);
  await desktop.locator('[name="import-mode"][value="overwrite"]').check();
  await desktop.locator("#import-file").setInputFiles({
    name: "fictional-week.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(baseline)),
  });
  await desktop.locator("#importform [type=submit]").click();
  await desktop.locator("#import-confirm").waitFor();
  assert.deepEqual(await exportAccount(desktop), fresh, "Restore preview is read-only");
  const backup = desktop.waitForEvent("download");
  await desktop.locator("#import-confirm").click();
  await backup;
  await desktop.locator("#import-msg").filter({ hasText: "Restored 5 records" }).waitFor();
  assert.deepEqual(
    await exportAccount(desktop),
    baseline,
    "Restore and JSON Export preserve the week",
  );

  await pages[1].page.reload();
  await loaded(pages[1].page);
  for (const { name, page, open } of pages) {
    for (const [tab, marker, content] of [
      ["today", "#today-ongoing", /Light sensitivity/],
      ["plan", "#plan-list", /Work call[\s\S]*Food shop/],
      ["episode", "#episode-ongoing", /Light sensitivity/],
      ["history", "#history-record-count", /1 day.*1 episode/i],
    ]) {
      await open(tab);
      const visible = page.locator(marker).filter({ hasText: content });
      await visible.waitFor();
      await harness.screenshot(page, `week-planner-${name}-${tab}.png`);
    }
    const browse = page.locator("#history-records summary");
    if (name === "phone") await browse.tap();
    else await browse.press("Enter");
    await page.locator("#eps .ep").filter({ hasText: "Light sensitivity" }).waitFor();
    const edit = page.locator(`#eps [data-id="${expected.ongoingEpisode}"].edit`);
    if (name === "phone") await edit.tap();
    else await edit.press("Enter");
    assert.equal(
      await page.locator("#ep-when").inputValue(),
      baseline[expected.ongoingEpisode].when,
    );
    const back = page.locator("#ep-cancel");
    if (name === "phone") await back.tap();
    else await back.press("Enter");
    await page.locator("#history-panel").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `${name} History fits the viewport`,
    );
  }

  await pages[0].open("plan");
  await desktop.locator("#plan-span").selectOption("3");
  const { entry, from, to } = expected.shopMove;
  const moved = desktop.locator(`#plan-board [data-key="${from}|${entry}"]`);
  await moved.focus();
  await moved.press("ArrowRight");
  await desktop.locator(`#plan-board [data-key="${to}|${entry}"]`).waitFor();
  await saved(desktop);
  const exported = await exportAccount(desktop);
  assert.deepEqual(
    exported[`p-${from}`].entries,
    baseline[`p-${from}`].entries.filter(({ id }) => id === expected.keepCall.entry),
    "the shop releases its reservation while the call stays",
  );
  assert.deepEqual(
    exported[`p-${to}`].entries,
    [...baseline[`p-${to}`].entries, baseline[`p-${from}`].entries.find(({ id }) => id === entry)],
    "one shop reservation appears on the destination date",
  );
  assert.deepEqual(exported[`d-${from}`], baseline[`d-${from}`], "actual usage is unchanged");
  assert.deepEqual(exported[expected.ongoingEpisode], baseline[expected.ongoingEpisode]);
  assert.deepEqual(errors, []);
  console.log(
    "Fictional week: fresh and planner walkthroughs, Restore preview, JSON Export, keyboard move",
  );
});
