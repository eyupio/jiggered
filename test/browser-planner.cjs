// The real application with a private in-memory API fixture; no user data.
const { runBrowser } = require("./support/browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../web");
const defaults = JSON.parse(fs.readFileSync(path.join(root, "defaults.json"), "utf8"));
const date = new Date().toISOString().slice(0, 10);

async function waitForPersistedDraft(page, date) {
  await page.evaluate(async (date) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("jiggered-device");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const key = `jiggered:drafts:1:alex:plan:${date}`;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const value = await new Promise((resolve, reject) => {
          const request = db.transaction("items").objectStore("items").get(key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        if (value) {
          const draft = JSON.parse(value);
          if (draft.value?.a === "Rest after travel" && draft.value?.c === "-2") return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("Planner draft was not persisted before reload");
    } finally {
      db.close();
    }
  }, date);
}

const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
// The fixture saves asynchronously; wait for a condition on it rather than racing a particular response.
const until = async (done, what) => {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(done(), what);
};
runBrowser({ name: "planner", startServer: false }, async (harness) => {
  for (const width of [1440, 375]) {
    const browser = await harness.launchBrowser();
    const docs = {
      settings: {
        rev: 1,
        body: {
          ...defaults,
          onboarding: { dismissed: true },
          profile: { theme: "light", energyTheme: width === 375 ? "spoons" : "points" },
          activities: [
            { id: "focus", a: "Deep focus", c: 7 },
            { id: "rest", a: "Quiet break", c: -2 },
            { id: "walk", a: "Walk (45 min)", c: -1 },
          ],
        },
      },
    };
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      timezoneId: "UTC",
      serviceWorkers: "block",
    });
    const errors = [];
    await context.route("http://localhost:18758/**", async (route) => {
      const request = route.request(),
        url = new URL(request.url()),
        pathname = url.pathname;
      const json = (body) =>
        route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (pathname === "/api/me")
        return json({ id: 1, username: "alex", role: "user", must_change_password: false });
      if (pathname === "/api/defaults") return json(defaults);
      if (pathname === "/api/docs") return json(docs);
      if (pathname.startsWith("/api/docs/") && request.method() === "PUT") {
        const id = decodeURIComponent(pathname.slice("/api/docs/".length));
        docs[id] = { rev: (docs[id]?.rev || 0) + 1, body: request.postDataJSON() };
        return json({ rev: docs[id].rev });
      }
      if (pathname === "/api/me/sessions") return json([]);
      if (pathname === "/api/me/security")
        return json({ two_factor: false, email_available: false });
      if (pathname.startsWith("/api/")) return json({});
      const file = path.join(root, pathname === "/" ? "index.html" : pathname);
      if (!file.startsWith(root) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
      const types = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".svg": "image/svg+xml",
        ".woff2": "font/woff2",
        ".png": "image/png",
      };
      return route.fulfill({
        contentType: types[path.extname(file)] || "application/octet-stream",
        body: fs.readFileSync(file),
      });
    });

    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://localhost:18758/");
    await page.locator("#acts button.act").first().waitFor();
    // Nothing logged or planned yet: zero reads as a plain "0", never "−0" or "+0".
    const emptyToday = await page.locator("#energy-breakdown").textContent();
    assert.match(emptyToday, /Used\s*0/);
    assert.match(emptyToday, /Recovered\s*0/);
    assert.doesNotMatch(emptyToday, /[−+]0(?!\d)/);
    await page.locator("#t-plan").click();
    // Nothing planned: no wall of zero totals, and on a phone the way to start comes first.
    assert.equal((await page.locator("#plan-forecast").textContent()).trim(), "");
    assert.equal(await page.locator("#plan-start").isVisible(), width < 700);
    if (width < 700) {
      const start = await page.locator("#plan-start-add").boundingBox(),
        strip = await page.locator("#plan-days").boundingBox();
      assert.ok(start.y + start.height < strip.y, `start button leads the day strip at ${width}`);
    }
    // A scrolling day strip must leave room for the selected day's ring (the left edge was clipped on phones).
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const strip = await page.evaluate(() => {
      const row = document.getElementById("plan-days"),
        chip = row.querySelector('[aria-pressed="true"]'),
        ring = getComputedStyle(chip);
      return {
        clips: getComputedStyle(row).overflowX !== "visible",
        scrollLeft: row.scrollLeft,
        room:
          chip.getBoundingClientRect().left -
          (parseFloat(ring.outlineWidth) + parseFloat(ring.outlineOffset)) -
          row.getBoundingClientRect().left,
      };
    });
    assert.equal(strip.scrollLeft, 0, "day strip starts unscrolled at " + width);
    assert.ok(!strip.clips || strip.room >= -0.01, `selected day ring clipped at ${width}`);
    if (width < 700) {
      await page.locator("#plan-start-add").click();
      assert.equal(await page.locator("#plan-form").isVisible(), true);
      assert.equal(await page.evaluate(() => document.activeElement.id), "plan-name");
      await page.locator("#plan-cancel").click();
    }
    await page.locator("#plan-add").click();
    await page.locator("#plan-presets").selectOption("0");
    await page.locator("#plan-repeat").fill("3");
    const repeatedPlansSaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        Object.keys(docs).filter((k) => k.startsWith("p-")).length === 3,
    );
    await page.locator("#plan-submit").click();
    await repeatedPlansSaved;
    assert.equal(Object.keys(docs).filter((k) => k.startsWith("p-")).length, 3);
    assert.equal(Object.keys(docs).filter((k) => k.startsWith("d-")).length, 0);
    assert.match(await page.locator("#plan-forecast").textContent(), /Uncommitted\s*3/);
    assert.equal(
      await page.locator("#plan-start").isHidden(),
      true,
      "start card goes once planned",
    );
    await page.locator("#plan-add").click();
    await page.locator("#plan-presets").selectOption("1");
    await page.locator("#plan-submit").click();
    assert.match(await page.locator("#plan-forecast").textContent(), /Projected balance\s*5/);
    await page.locator("#t-today").click();
    assert.match(await page.locator("#left").textContent(), /10/);
    assert.equal(await page.locator("#cells .reserved").count(), 7);
    // Done on Today logs the planned activity in place: no tab change, no form, and Undo takes it back.
    await page.locator("#today-plan [data-plan-action=complete]").first().click();
    assert.equal(await page.locator("#today-panel").isVisible(), true, "Done stays on Today");
    assert.equal(await page.locator("#plan-form").isVisible(), false);
    assert.match(await page.locator("#toastbar").textContent(), /Logged Deep focus/);
    assert.match((await page.locator("#left").textContent()).trim(), /^3\s/);
    assert.equal(await page.locator("#today-plan [data-plan-action=complete]").count(), 1);
    assert.equal(
      await page.evaluate(() => !!document.activeElement.closest("#today-plan")),
      true,
      "focus stays in the plan card",
    );
    await page.locator("#toastbar button").click();
    assert.equal(await page.locator("#today-plan [data-plan-action=complete]").count(), 2);
    assert.match((await page.locator("#left").textContent()).trim(), /^10\s/);
    // Done again, then correct what actually happened from the day's logged activities.
    await page.locator("#today-plan [data-plan-action=complete]").first().click();
    await page.locator("#energy-activity-pills [data-action=edit]").first().click();
    await page.locator("#entry-cost").fill("3");
    await page.locator("#entry-form button[type=submit]").click();
    await until(
      () =>
        docs["d-" + date]?.body.entries.length === 1 && docs["d-" + date].body.entries[0].c === 3,
      "corrected entry saved",
    );
    assert.match(docs["d-" + date].body.entries[0].id, /^planned:/);
    await page.locator("#t-plan").click();
    assert.match(await page.locator("#plan-forecast").textContent(), /Available now\s*7/);
    await page.locator("#t-today").click();
    assert.match(await page.locator("#left").textContent(), /7/);
    assert.match(await page.locator("#energy-breakdown").textContent(), /Used\s*−3/);
    // Plan keeps its own Done, which opens the form so the actual cost or time can be set as it is logged.
    await page.locator("#t-plan").click();
    await page.locator("#plan-list [data-plan-action=complete]").click();
    assert.equal(await page.locator("#plan-form").isVisible(), true);
    await page.locator("#plan-submit").click();
    await page.locator("#t-today").click();
    assert.match(await page.locator("#left").textContent(), /9/);
    await page.locator("#t-history").click();
    await page.locator('[data-matrix-grid] [data-date="' + date + '"]').click();
    assert.match(
      await page.locator(".plan-history").textContent(),
      /2 of 2 planned activities logged/,
    );
    assert.match(await page.locator(".plan-history").textContent(), /1 actually used/);
    await page.locator(".plan-history [data-open-plan]").click();
    assert.equal(await page.locator(".plan-done").count(), 2);
    // Plans and edits survive a reload; future days remain separate from historical totals.
    await page.reload();
    await page.locator("#plan-list .plan-done").first().waitFor();
    assert.equal(await page.locator(".plan-done").count(), 2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false, "no horizontal page overflow at " + width);
    fs.mkdirSync(path.join(__dirname, "artifacts"), { recursive: true });
    await page.mouse.click(5, 5);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(__dirname, "artifacts", `planner-${width}.png`),
      fullPage: true,
    });
    await page.locator("#t-today").click();
    await page.screenshot({
      path: path.join(__dirname, "artifacts", `energy-${width}.png`),
      fullPage: true,
    });
    // A known heavy day exposes a shortfall and offers personal recovery choices.
    await page.locator("#t-plan").click();
    await page.locator("[data-plan-day]").nth(1).click();
    await page.locator("#plan-allowance").fill("4");
    await page.locator("#plan-allowance").dispatchEvent("change");
    await page.locator("[data-plan-recovery]").first().waitFor();
    assert.match(await page.locator("#plan-forecast").textContent(), /3 (points|spoons) recovery/);
    await page.locator("[data-plan-recovery]").first().click();
    assert.equal(await page.locator("#plan-name").inputValue(), "Quiet break");
    await page.locator("#plan-submit").click();
    assert.match(
      await page.locator("#plan-forecast").textContent(),
      /1 (point|spoon) still uncovered/,
    );
    // Unfinished input survives navigation and refresh without becoming actual usage.
    await page.locator("#plan-add").click();
    await page.locator("#plan-name").fill("Rest after travel");
    await page.locator("#plan-cost").fill("-2");
    const selectedDate = await page
      .locator("[data-plan-day][aria-pressed='true']")
      .getAttribute("data-plan-day");
    await waitForPersistedDraft(page, selectedDate);
    await page.reload();
    await page.locator("#plan-form:not([hidden])").waitFor();
    assert.equal(await page.locator("#plan-name").inputValue(), "Rest after travel");
    await page.locator("#plan-cancel").click();
    // A day with only recovery planned has no work: that total reads 0, not "−0".
    await page.locator("[data-plan-day]").nth(3).click();
    await page.locator("#plan-add").click();
    await page.locator("#plan-presets").selectOption("1");
    await page.locator("#plan-submit").click();
    const recoveryOnly = await page.locator("#plan-forecast").textContent();
    assert.match(recoveryOnly, /Work still planned\s*0/);
    assert.match(recoveryOnly, /Planned recovery\s*\+2/);
    assert.doesNotMatch(recoveryOnly, /−0(?!\d)/);
    // A planned activity can have a length: it shows as a range, sorts by start time, and may not pass midnight.
    await page.locator("[data-plan-day]").nth(4).click();
    await page.locator("#plan-add").click();
    await page.locator("#plan-name").fill("Late call");
    await page.locator("#plan-cost").fill("2");
    await page.locator("#plan-time").fill("16:00");
    await page.locator("#plan-dur").fill("90");
    await page.locator("#plan-submit").click();
    await page.locator("#plan-add").click();
    await page.locator("#plan-name").fill("Early walk");
    await page.locator("#plan-cost").fill("-1");
    await page.locator("#plan-time").fill("08:30");
    await page.locator("#plan-submit").click();
    const planned = await page.locator(".plan-activity .plan-activity-info").allTextContents();
    assert.match(
      planned[0],
      /Early walk.*08:30$/,
      "earlier start sorts first, with no length shown",
    );
    assert.match(planned[1], /Late call.*16:00–17:30/);
    await page.locator("#plan-add").click();
    await page.locator("#plan-name").fill("Night shift");
    await page.locator("#plan-time").fill("23:00");
    await page.locator("#plan-dur").fill("120");
    await page.locator("#plan-submit").click();
    assert.match(await page.locator("#plan-form-error").textContent(), /past midnight/);
    // The browser itself refuses a length under 5 minutes, so the form is not even submitted.
    await page.locator("#plan-dur").fill("3");
    await page.locator("#plan-submit").click();
    assert.equal(await page.locator("#plan-dur").evaluate((el) => el.validity.valid), false);
    assert.equal(await page.locator("#plan-form").isVisible(), true);
    await page.locator("#plan-cancel").click();
    // A saved activity suggests the length in its name, but never replaces one that was typed.
    await page.locator("#plan-add").click();
    await page.locator("#plan-presets").selectOption("2");
    assert.equal(await page.locator("#plan-dur").inputValue(), "45");
    await page.locator("#plan-dur").fill("20");
    await page.locator("#plan-presets").selectOption("2");
    assert.equal(await page.locator("#plan-dur").inputValue(), "20");
    await page.locator("#plan-cancel").click();
    // Today's activity form takes a length too, and clearing it leaves just the start.
    await page.locator("#t-today").click();
    await page.locator("#other-activity").click();
    await page.locator("#entry-name").fill("Midmorning walk");
    await page.locator("#entry-cost").fill("1");
    await page.locator("#entry-time").fill("10:00");
    await page.locator("#entry-dur").fill("45");
    await page.locator("#entry-form button[type=submit]").click();
    const walk = page.locator("#energy-activity-pills li", { hasText: "Midmorning walk" });
    assert.match(await walk.textContent(), /10:00–10:45/);
    await walk.locator("[data-action=edit]").click();
    assert.equal(await page.locator("#entry-dur").inputValue(), "45");
    await page.locator("#entry-dur").fill("");
    await page.locator("#entry-form button[type=submit]").click();
    assert.doesNotMatch(await walk.textContent(), /10:00–/);
    await until(
      () => docs["d-" + date].body.entries.find((x) => x.a === "Midmorning walk")?.dur === null,
      "clearing the length is saved as null",
    );
    // On a past day Done keeps the planned time rather than stamping "now".
    docs["p-" + yesterday] = {
      rev: 1,
      body: { entries: [{ id: "late", a: "Quiet break", c: -2, t: "21:30" }] },
    };
    await page.reload();
    await page.locator("#t-today").click();
    await page.locator("#day-prev").click();
    await page.locator("#today-plan [data-plan-action=complete]").click();
    await until(() => docs["d-" + yesterday]?.body.entries.length === 1, "past day logged");
    assert.equal(docs["d-" + yesterday].body.entries[0].a, "Quiet break");
    assert.equal(docs["d-" + yesterday].body.entries[0].t, "21:30");
    assert.deepEqual(errors, []);
    await context.close();
  }
});
