// Optional real-browser regression walkthrough. Requires Playwright; no production build step.
const assert = require("node:assert/strict");
const { runBrowser } = require("./support/browser.cjs");
// Activity groups start closed, so open one first; later taps use whatever activity is still a plain button.
const tapActivity = async (p) => {
  const closed = p.locator("#acts details.act-group:not([open]) summary");
  if (await closed.count()) await closed.first().click();
  await p.locator("#acts button.act").first().click();
};
// The list editors are collapsible sections that start closed; open one before using its rows.
const openSection = async (p, prefix, key) => {
  const d = p.locator("#" + prefix + "-" + key).locator("xpath=ancestor::details[1]");
  if (!(await d.evaluate((e) => e.open))) await d.locator("summary").first().click();
};
runBrowser({ name: "walkthrough", username: "auditadmin" }, async (harness) => {
  const { base, screenshot } = harness;
  let browser = await harness.launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  let page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/login");
  await page.locator("#username").fill("auditadmin");
  await page.locator("#password").fill("local-preview-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("#t-admin").waitFor();
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  // Help is searchable, contextual and role aware; tooltips support hover/focus/Escape.
  await page.locator("#other-activity").hover();
  await page.locator("#jiggered-tooltip").waitFor();
  assert.match(await page.locator("#jiggered-tooltip").textContent(), /one-off activity/);
  await page.locator("#other-activity").focus();
  assert.equal(
    await page.locator("#other-activity").getAttribute("aria-describedby"),
    "jiggered-tooltip",
  );
  await page.keyboard.press("Escape");
  assert.ok(await page.locator("#jiggered-tooltip").isHidden());
  assert.equal(await page.locator("#other-activity").getAttribute("aria-describedby"), null);
  assert.equal(await page.locator("#t-help").count(), 0, "Help is not a tab");
  await page.locator("header [data-help]").click();
  assert.ok(await page.locator("#help-panel").isVisible());
  assert.equal(await page.locator("#help-admin").count(), 1);
  await page.locator("#help-search").fill("reorder");
  assert.ok((await page.locator("#help-topics details:visible").count()) > 0);
  await page.locator("#help-search").fill("no-matching-topic-xyz");
  await page.locator("#help-empty").waitFor();
  await page.locator("#help-clear").click();
  assert.equal(await page.locator("#help-topics details:visible").count(), 13);
  assert.equal(await page.locator("#help-security").count(), 1);
  await page.locator("#help-panel [data-help=points]").click();
  assert.equal(await page.locator("#help-points").getAttribute("open"), "");
  assert.equal(
    await page.locator("#help-points summary").evaluate((el) => el === document.activeElement),
    true,
  );
  await screenshot(page, "help-desktop.png");
  await page.locator("#t-today").click();
  // Correct a logged item, add a custom zero-cost item and restore a removed entry in place.
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  await page.waitForTimeout(500);
  const tops = await page.evaluate(
    () =>
      new Promise((res) => {
        const t = document.querySelector("#tabs"),
          seen = new Set(),
          end = performance.now() + 1500;
        document.querySelector("#checkin button[data-s=amber]").click();
        (function f() {
          seen.add(Math.round(t.getBoundingClientRect().top));
          performance.now() < end ? requestAnimationFrame(f) : res([...seen]);
        })();
      }),
  );
  assert.equal(tops.length, 1, "tabs and content never shift while a check-in saves: " + tops);
  await tapActivity(page);
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  await page.locator("#activity-log summary").click();
  await page.locator("#entries [data-action=edit]").first().click();
  await page.locator("#entry-name").fill("Corrected activity");
  await page.locator("#entry-cost").fill("0");
  await page.locator("#entry-time").fill("");
  await page.locator("#entry-form [type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  assert.match(await page.locator("#entries").textContent(), /Corrected activity/);
  await page.locator("#other-activity").click();
  await page.locator("#entry-name").fill("Custom recovery");
  await page.locator("#entry-cost").fill("-2");
  await page.locator("#entry-form [type=submit]").click();
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  await page.locator("#entries [data-action=remove]").first().click();
  await page.locator("#toastbar button").click();
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  assert.match(await page.locator("#entries li").first().textContent(), /Corrected activity/);
  // A second tab follows the acknowledged device cache and cannot write it.
  const reader = await context.newPage();
  reader.on("pageerror", (e) => errors.push(e.message));
  await reader.goto(base);
  await reader.locator("#tab-reload").waitFor();
  const previous = await page.locator("#entries li").count();
  await tapActivity(reader);
  assert.equal(await reader.locator("#entries li").count(), previous);
  await page.route("**/api/docs/*", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
  );
  await tapActivity(page);
  await reader.waitForFunction(
    (n) => document.querySelectorAll("#entries li").length === n,
    previous + 1,
  );
  await page.close();
  page = reader;
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  assert.equal(
    await page.locator("#tab-reload").count(),
    0,
    "closing writer lets another tab recover and send its outbox",
  );
  assert.equal(await page.locator("#entries li").count(), previous + 1);
  await page.locator("#t-account").click();
  await openSection(page, "set", "acts");
  await page.locator("#set-acts [data-row]").first().waitFor();
  const first = await page
    .locator("#set-acts [data-row] input[type=text]:not(.order-group)")
    .first()
    .inputValue();
  await page
    .locator("#set-acts [data-row]")
    .first()
    .evaluate((el) => el.scrollIntoView({ block: "center" }));
  const handle = await page.locator("#set-acts .drag-handle").first().boundingBox();
  const target = await page.locator("#set-acts [data-row]").nth(2).boundingBox();
  await page.mouse.move(handle.x + 22, handle.y + 22);
  await page.mouse.down();
  await page.mouse.move(handle.x + 22, target.y + target.height / 2, { steps: 15 });
  await page.mouse.up();
  assert.equal(
    await page
      .locator("#set-acts [data-row] input[type=text]:not(.order-group)")
      .nth(2)
      .inputValue(),
    first,
    "desktop drag puts first activity third",
  );
  await page.locator("#setform [type=submit]").click();
  await page.locator("#set-msg").filter({ hasText: "Saved." }).waitFor();
  await page.reload();
  await page.locator("#t-account").click();
  await openSection(page, "set", "acts");
  assert.equal(
    await page
      .locator("#set-acts [data-row] input[type=text]:not(.order-group)")
      .nth(2)
      .inputValue(),
    first,
    "order survives reload/IndexedDB/server",
  );
  await screenshot(page, "settings-desktop.png");
  // Preview is read-only, stale confirmation rejects, and commit downloads a backup first.
  const exported = await (await context.request.get(base + "/api/export")).json();
  const restoreData = { ...exported, "e-998": { notes: "Legacy restored note" } };
  await page.locator("#import-file").setInputFiles({
    name: "restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(restoreData)),
  });
  await page.locator("#importform [type=submit]").click();
  await page.locator("#import-msg").filter({ hasText: "Preview ready." }).waitFor();
  assert.match(await page.locator("#import-preview").textContent(), /1 new records/);
  const beforeDocs = await (await context.request.get(base + "/api/export")).json();
  assert.equal(beforeDocs["e-998"], undefined, "preview did not write");
  await context.request.put(base + "/api/docs/e-997", {
    headers: { "X-Requested-With": "jiggered", "If-None-Match": "*" },
    data: { notes: "Changed after preview" },
  });
  const staleDownload = page.waitForEvent("download");
  await page.locator("#import-confirm").click();
  await staleDownload;
  await page.locator("#import-msg").filter({ hasText: "Preview again." }).waitFor();
  assert.equal(await page.locator("#import-confirm").count(), 0, "stale preview invalidated");
  await page.locator("#importform [type=submit]").click();
  await page.locator("#import-msg").filter({ hasText: "Preview ready." }).waitFor();
  await screenshot(page, "restore-preview.png");
  const backupDownload = page.waitForEvent("download");
  await page.locator("#import-confirm").click();
  const backup = await backupDownload;
  assert.match(backup.suggestedFilename(), /^jiggered-before-restore-/);
  await page.locator("#import-msg").filter({ hasText: "Restored 1 records;" }).waitFor();
  const afterDocs = await (await context.request.get(base + "/api/export")).json();
  assert.equal(afterDocs["e-998"].notes, "Legacy restored note");
  assert.equal(afterDocs["e-997"].notes, "Changed after preview");
  await page.locator("#import-file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ "d-2026-10-01": { entries: "broken" } })),
  });
  await page.locator("#importform [type=submit]").click();
  await page.locator("#import-msg").filter({ hasText: "entries must be a list" }).waitFor();
  assert.equal(await page.locator("#import-confirm").count(), 0);

  await page.locator("#t-admin").click();
  await page.locator("#admin-tab-defaults").click();
  await page.locator("#def-msg").filter({ hasText: "Latest shared defaults loaded." }).waitFor();
  await openSection(page, "def", "sym");
  await page
    .locator("#def-sym [data-row] input[type=text]:not(.order-group)")
    .first()
    .fill("Custom default symptom");
  await page.locator("#admin-confirm-pw").fill("local-preview-password");
  await page.locator("#defaults-form [type=submit]").click();
  await page.locator("#def-msg").filter({ hasText: "Shared defaults saved." }).waitFor();
  await page.locator("#admin-tab-people").click();
  await page.locator("#new-name").fill("previewuser");
  await page.locator("#admin-confirm-pw").fill("local-preview-password");
  await page.locator("#adduser [type=submit]").click();
  await page.locator("#adduser-msg").filter({ hasText: "Created previewuser." }).waitFor();
  const temp = (await page.locator("#reveal-pw").textContent()).match(
    /Temporary password: (.*)/,
  )[1];
  await browser.close();
  browser = await harness.launchBrowser();
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(base + "/login");
  await phone.locator("#username").fill("previewuser");
  await phone.locator("#password").fill(temp);
  await phone.getByRole("button", { name: "Sign in", exact: true }).click();
  await phone.locator("#banner").filter({ hasText: "Choose a new password" }).waitFor();
  await phone.locator("#pw-cur").fill(temp);
  await phone.locator("#pw-new").fill("new-preview-password");
  await phone.locator("#pw-new2").fill("new-preview-password");
  await phone.locator("#pwform [type=submit]").click();
  await phone.locator("#t-episode").waitFor();
  await phone.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
  await phone.locator("header [data-help]").click();
  assert.equal(
    await phone.locator("#help-admin").count(),
    0,
    "admin help absent for regular users",
  );
  await phone.locator("#help-tabs summary").click();
  await screenshot(phone, "help-mobile.png");
  assert.equal(
    await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await phone.locator("#t-today").click();
  await phone.locator("#today-panel .help-tip").first().tap();
  await phone.locator("#jiggered-tooltip").waitFor();
  const tipBox = await phone.locator("#jiggered-tooltip").boundingBox();
  assert.ok(tipBox.x >= 0 && tipBox.x + tipBox.width <= 390, "touch tooltip stays within viewport");
  await phone
    .locator("#jiggered-tooltip")
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  await screenshot(phone, "tooltip-mobile.png");
  await phone.locator("#today-panel .help-tip").first().tap();
  assert.ok(await phone.locator("#jiggered-tooltip").isHidden());
  await phone.locator("#t-episode").click();
  assert.equal(
    await phone.locator("#ep-sym .chip").first().textContent(),
    "Custom default symptom",
  );
  assert.equal(await phone.locator("#t-admin").count(), 0, "regular user has no admin interface");
  await phone.locator("#t-account").click();
  await openSection(phone, "set", "sym");
  // Scroll the list into view before sending actual touch input.
  await phone.locator("#set-sym").evaluate((el) => {
    el.scrollIntoView({ block: "start" });
    window.scrollBy(0, -90);
  }); // list at the top, below the sticky tabs, so the drop target is on screen
  const h2 = await phone.locator("#set-sym .drag-handle").first().boundingBox();
  const t2 = await phone.locator("#set-sym [data-row]").nth(2).boundingBox();
  const session = await phoneContext.newCDPSession(phone);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: h2.x + 20, y: h2.y + 20 }],
  });
  for (let i = 1; i <= 12; i++) {
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: h2.x + 20, y: h2.y + 20 + ((t2.y + t2.height / 2 - h2.y - 20) * i) / 12 }],
    });
    await new Promise((r) => setTimeout(r, 20));
  }
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.equal(
    await phone
      .locator("#set-sym [data-row] input[type=text]:not(.order-group)")
      .nth(2)
      .inputValue(),
    "Custom default symptom",
    "real touch drag ordering",
  );
  await phone.locator("#setform [type=submit]").click();
  await phone.locator("#set-msg").filter({ hasText: "Saved." }).waitFor();
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false, "mobile has no horizontal overflow");
  await screenshot(phone, "settings-mobile.png");
  await phone.locator("#t-episode").click();
  await phone.locator("#ep-sym input").first().check();
  await phone.locator("#ep-notes").fill("Browser episode capture");
  await phone.locator("#ep-save").click();
  await phone.locator("#eptoast").filter({ hasText: "Saved." }).waitFor();
  await phone.locator("#t-today").click();
  await phone.locator("#today-ongoing button").click();
  await phone.locator("#ep-dur").selectOption("Ended (duration unknown)");
  await phone.locator("#ep-save").click();
  await phone.locator("#eptoast").filter({ hasText: "Saved." }).waitFor();
  await phone.locator("#t-history").click();
  await phone.evaluate(() => {
    document.getElementById("history-filter-panel").open = true;
  });
  await phone.locator("#hist-query").fill("Browser episode");
  assert.equal(await phone.locator("#eps .ep").count(), 1);
  await phone.locator("#sum-preview").click();
  assert.ok(await phone.locator("#summary-preview").isVisible());
  await screenshot(phone, "history-mobile.png");
  const idb = await phone.evaluate(async () => {
    const names = await indexedDB.databases();
    return names.some((d) => d.name === "jiggered-device");
  });
  assert.ok(idb, "IndexedDB database in use");
  // Exercise actual IndexedDB transaction durability, large accounts and legacy migration.
  const storageProbe = await phone.evaluate(async () => {
    const moduleURL = document
      .querySelector("script[type=module]")
      .src.replace("app.js", "device.js");
    const { openDeviceStorage } = await import(moduleURL);
    const storage = await openDeviceStorage({ legacy: localStorage });
    const value = "x".repeat(10 * 1024 * 1024);
    await storage.setItem("browser-large-account-probe", value);
    storage.close();
    const reloaded = await openDeviceStorage({ legacy: localStorage });
    const length = reloaded.getItem("browser-large-account-probe").length;
    await reloaded.removeItem("browser-large-account-probe");
    const key = "jiggered:v1:999:migration-fixture";
    localStorage.setItem(
      key,
      JSON.stringify({
        v: 1,
        pending: [{ id: "e-1", n: 1, type: "replace", arg: { notes: "legacy" } }],
      }),
    );
    reloaded.close();
    const migrated = await openDeviceStorage({ legacy: localStorage });
    const oldRemoved = localStorage.getItem(key) === null;
    const restored = JSON.parse(migrated.getItem(key)).pending[0].arg.notes;
    await migrated.removeItem(key);
    migrated.close();
    return { length, oldRemoved, restored };
  });
  assert.equal(storageProbe.length, 10 * 1024 * 1024);
  assert.equal(storageProbe.oldRemoved, true);
  assert.equal(storageProbe.restored, "legacy");
  // An offline save and reload must keep the capture without claiming a server acknowledgement.
  await phone.evaluate(() => navigator.serviceWorker.ready);
  await phone.reload();
  await phone.locator("#t-episode").click();
  await phone.locator("#ep-notes").fill("Offline survives reload");
  await phoneContext.setOffline(true);
  await phone.locator("#ep-save").click();
  await phone.locator("#eptoast").filter({ hasText: "queued on this device" }).waitFor();
  await phone.reload();
  await phone.locator("#t-episode").click();
  assert.equal(await phone.locator("#ep-notes").inputValue(), "Offline survives reload");
  assert.ok(!(await phone.locator("#eptoast").textContent()).includes("Saved."));
  await phoneContext.setOffline(false);
  await phone.evaluate(() => window.dispatchEvent(new Event("online")));
  await phone.locator("#eptoast").filter({ hasText: "Saved." }).waitFor();
  // A refused capture is still recoverable after reload, and retry clears it only when saved.
  await phone.route("**/api/docs/*", (route) =>
    route.fulfill({
      status: 413,
      contentType: "application/json",
      body: JSON.stringify({ error: "Test quota refusal" }),
    }),
  );
  await phone.locator("#ep-notes").fill("Retained refusal");
  await phone.locator("#ep-save").click();
  await phone.locator("#recovery").filter({ hasText: "Test quota refusal" }).waitFor();
  await phone.reload();
  await phone.locator("#t-episode").click();
  assert.equal(await phone.locator("#ep-notes").inputValue(), "Retained refusal");
  await phone.unroute("**/api/docs/*");
  await phone.locator("#recovery [data-action=retry]").click();
  await phone.locator("#eptoast").filter({ hasText: "Saved." }).waitFor();
  assert.ok(!(await phone.locator("#recovery").isVisible()));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: searchable/contextual/role-aware Help, hover/focus/Escape/touch tooltips, activity correction/custom/undo, live read-only tab and queued handover, restore preview/stale/backup/validation, desktop drag, server/reload order, shared defaults, new-user adoption, role gating, real touch drag, mobile overflow, capture/finish/history/preview, IndexedDB/10MB/migration, offline reload and refusal recovery",
  );
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
