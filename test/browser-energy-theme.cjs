// Real app and Chromium, with an in-memory API fixture. No database or server writes.
const { runBrowser } = require("./support/browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../web");
const defaults = JSON.parse(fs.readFileSync(path.join(root, "defaults.json"), "utf8"));
const date = new Date().toISOString().slice(0, 10);
const docs = {
  settings: {
    rev: 1,
    body: {
      ...defaults,
      profile: { displayName: "Alex", theme: "light" },
      onboarding: { dismissed: true },
      activities: [
        { id: "a", a: "Review points", c: 2 },
        { id: "b", a: "Rest", c: -1 },
      ],
    },
  },
};
for (let i = 0; i < 4; i++) {
  const day = new Date(date + "T12:00:00Z");
  day.setUTCDate(day.getUTCDate() - i);
  const key = day.toISOString().slice(0, 10);
  docs["d-" + key] = {
    rev: 1,
    body: {
      date: key,
      status: "green",
      budget: 10,
      poorSleep: false,
      entries: [{ id: "entry", a: "Review points", c: 2 }],
    },
  };
}
const originalDays = JSON.stringify(
  Object.fromEntries(Object.entries(docs).filter(([id]) => id !== "settings")),
);
runBrowser({ name: "energy-theme", startServer: false }, async (harness) => {
  const browser = await harness.launchBrowser();
  const errors = [];
  async function open(viewport) {
    const context = await browser.newContext({
      viewport,
      timezoneId: "UTC",
      serviceWorkers: "block",
    });
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
    await page.waitForFunction(() => document.querySelector("#sync").dataset.state === "saved");
    return { context, page };
  }
  const { context, page } = await open({ width: 1280, height: 1000 });
  assert.equal(await page.locator("#balance-label").textContent(), "Points left today");
  const balance = await page.locator("#left").textContent();
  await page.locator("#t-account").click();
  assert.equal(await page.locator("input[name=energyTheme][value=points]").isChecked(), true);
  // Native radio arrow keys change the preview without applying an unfinished draft.
  await page.locator("input[name=energyTheme][value=points]").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("input[name=energyTheme][value=spoons]").isChecked(), true);
  assert.equal(await page.locator("#energy-theme-preview").textContent(), "8 spoons left today");
  assert.equal(await page.locator("html").getAttribute("data-energy-theme"), "points");
  await page.reload();
  await page.locator("#profile-save").waitFor();
  assert.equal(
    await page.locator("input[name=energyTheme][value=spoons]").isChecked(),
    true,
    "device draft survives reload",
  );
  const spoonPreferenceSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && docs.settings.body.profile.energyTheme === "spoons",
  );
  await page.locator("#profile-save").click();
  await page.waitForFunction(() => document.documentElement.dataset.energyTheme === "spoons");
  await spoonPreferenceSaved;
  assert.equal(docs.settings.body.profile.energyTheme, "spoons");
  assert.equal(docs.settings.body.profile.theme, "light");
  assert.equal(await page.locator("#set-budget").locator("..").innerText(), "Spoons per day");
  assert.equal(
    await page.locator("#set-acts .order-cost").first().getAttribute("aria-label"),
    "Spoons it costs",
  );
  await page.locator("#t-today").click();
  assert.equal(await page.locator("#left").textContent(), balance);
  assert.equal(await page.locator("#balance-label").textContent(), "Spoons left today");
  assert.equal(await page.locator("#cells svg").count(), 10);
  assert.equal(await page.locator(".energy-spoon").isVisible(), true);
  assert.match(await page.locator("#energy-activity-pills").textContent(), /Review points/);
  await page.locator(".energy-panel").screenshot({ path: "/tmp/jiggered-spoons-today.png" });
  await page.locator("#t-history").click();
  assert.match(await page.locator("#history-charts").textContent(), /Net spoons/);
  assert.equal(
    await page.locator("[data-matrix-mode] option[value=used]").textContent(),
    "Activity spoons used",
  );
  assert.match(await page.locator('[data-chart="combined"]').textContent(), /Net spoons/);
  assert.match(await page.locator(".energy-report").textContent(), /spoons used before recovery/);
  assert.match(await page.locator("#history-charts").textContent(), /One point per day/);
  await page.locator("#history-prepare").click();
  assert.match(await page.locator("#summary-preview").textContent(), /Net spoons used/);
  await page.locator("header [data-help]").click();
  await page.locator("#help-search").fill("spoon");
  assert.ok(await page.locator("#help-spoons").isVisible());
  assert.match(await page.locator("#help-spoons").textContent(), /One spoon represents one point/);
  await page.locator("#help-spoons summary").click();
  await page.locator("#help-spoons [data-settings=profile-panel]").click();
  assert.equal(
    await page
      .locator("input[name=energyTheme][value=points]")
      .evaluate((el) => el === document.activeElement),
    true,
  );
  await page.locator("#profile-theme").selectOption("dark");
  await page.locator("#profile-save").click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await harness.screenshot(page, "energy-desktop.png");
  await page.setViewportSize({ width: 390, height: 900 });
  await harness.screenshot(page, "energy-mobile.png");
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "no horizontal overflow",
  );
  const second = await open({ width: 390, height: 900 });
  assert.equal(
    await second.page.locator("#balance-label").textContent(),
    "Spoons left today",
    "saved preference follows another device",
  );
  await second.page.locator("#t-account").click();
  await second.page.locator("input[name=energyTheme][value=points]").check();
  const pointsPreferenceSaved = second.page.waitForResponse(
    (response) =>
      response.request().method() === "PUT" && docs.settings.body.profile.energyTheme === "points",
  );
  await second.page.locator("#profile-save").click();
  await pointsPreferenceSaved;
  await second.page.waitForFunction(
    () => document.documentElement.dataset.energyTheme === "points",
  );
  await second.page.locator("#t-today").click();
  assert.equal(await second.page.locator("#cells svg").count(), 0);
  assert.equal(await second.page.locator(".energy-spoon").isVisible(), false);
  assert.equal(await second.page.locator("#left").textContent(), balance);
  assert.equal(
    JSON.stringify(Object.fromEntries(Object.entries(docs).filter(([id]) => id !== "settings"))),
    originalDays,
  );
  assert.deepEqual(errors, []);
  await second.context.close();
  await context.close();
  console.log(
    "Energy theme: keyboard preview, draft reload, save, history/print, dark/mobile layout, cross-device and switch-back passed.",
  );
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
