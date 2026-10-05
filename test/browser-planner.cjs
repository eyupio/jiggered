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
    await page.locator("#t-plan").click();
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
    await page.locator("#plan-add").click();
    await page.locator("#plan-presets").selectOption("1");
    await page.locator("#plan-submit").click();
    assert.match(await page.locator("#plan-forecast").textContent(), /Projected balance\s*5/);
    await page.locator("#t-today").click();
    assert.match(await page.locator("#left").textContent(), /10/);
    assert.equal(await page.locator("#cells .reserved").count(), 7);
    await page.locator("#today-plan [data-plan-action=complete]").first().click();
    await page.locator("#plan-cost").fill("3");
    const loggedEntrySaved = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" && docs["d-" + date]?.body.entries.length === 1,
    );
    await page.locator("#plan-submit").click();
    await loggedEntrySaved;
    assert.equal(docs["d-" + date].body.entries.length, 1);
    assert.equal(docs["d-" + date].body.entries[0].c, 3);
    assert.match(await page.locator("#plan-forecast").textContent(), /Available now\s*7/);
    await page.locator("#t-today").click();
    assert.match(await page.locator("#left").textContent(), /7/);
    assert.match(await page.locator("#energy-breakdown").textContent(), /Used\s*−3/);
    await page.locator("#today-plan [data-plan-action=complete]").click();
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
    await waitForPersistedDraft(page, date);
    await page.reload();
    await page.locator("#plan-form:not([hidden])").waitFor();
    assert.equal(await page.locator("#plan-name").inputValue(), "Rest after travel");
    await page.locator("#plan-cancel").click();
    assert.deepEqual(errors, []);
    await context.close();
  }
});
