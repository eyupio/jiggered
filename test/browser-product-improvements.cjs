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
docs["e-1"] = {
  rev: 1,
  body: {
    when: date + "T10:00",
    symptoms: ["Dizzy"],
    before: [],
    duration: "Under 15 min",
    notes: "PRIVATE SECRET",
  },
};
docs["d-" + date].body.entries = Array.from({ length: 8 }, (_, i) => ({
  id: "entry" + i,
  a: "Long activity name number " + i,
  c: i === 7 ? -2 : 1,
  t: "10:05",
}));
runBrowser({ name: "product-improvements", startServer: false }, async (harness) => {
  const browser = await harness.launchBrowser();
  const errors = [];
  async function open(viewport, role = "user") {
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
        return json({ id: 1, username: "alex", role, must_change_password: false });
      if (pathname === "/api/defaults") return json(defaults);
      if (pathname === "/api/docs") return json(docs);
      if (pathname.startsWith("/api/docs/") && request.method() === "PUT") {
        const id = decodeURIComponent(pathname.slice("/api/docs/".length));
        docs[id] = { rev: (docs[id]?.rev || 0) + 1, body: request.postDataJSON() };
        return json({ rev: docs[id].rev });
      }
      if (pathname === "/api/me/usage-consent") return json({ available: false, enabled: false });
      if (pathname === "/api/me/sessions") return json([]);
      if (pathname === "/api/me/security")
        return json({ two_factor: false, email_available: false });
      if (pathname === "/api/admin/users") return json({ users: [], version: "test" });
      if (pathname === "/api/admin/audit") return json([]);
      if (pathname === "/api/admin/settings")
        return json({
          trust_proxy: false,
          proxy_hops: 1,
          seen: { remote_addr: "127.0.0.1", client_ip: "127.0.0.1" },
        });
      if (pathname === "/api/admin/usage") return json({ enabled: false, rows: [] });
      if (pathname === "/api/admin/services")
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"Fixture has no services"}',
        });
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
  for (const width of [320, 375, 768]) {
    const { context, page } = await open({ width, height: 1000 }, "admin");
    await page.locator("#t-admin").click();
    await page.locator("#admin-tab-activity").click();
    await page.locator("#audit-person").waitFor();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `admin audit filters fit at ${width}`,
    );
    await context.close();
  }
  for (const width of [320, 375, 768, 960, 1280]) {
    const { context, page } = await open({ width, height: 1000 });
    await page.locator("#t-account").click();
    const gap = await page.locator(".profile-photo-picker").evaluate((el) => {
      const input = el.querySelector("input[type=file]").getBoundingClientRect(),
        button = el.querySelector("button").getBoundingClientRect();
      return button.top - input.bottom;
    });
    assert.ok(gap >= 11, `profile controls need separated rows at ${width}: ${gap}`);
    await page.locator("#t-history").click();
    if (width < 960) {
      const aligned = await page.locator(".history-overview").evaluate((el) => {
        const a = el.children[0].getBoundingClientRect(),
          b = el.children[1].getBoundingClientRect();
        return b.top >= a.bottom && Math.abs(a.left - b.left) < 2;
      });
      assert.ok(aligned, `history panels stack and align at ${width}`);
    }
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      `no horizontal overflow at ${width}`,
    );
    await page.locator("[data-matrix-all]").click();
    assert.equal(await page.locator(".matrix-activities li").count(), 8);
    const prior = await page.locator("#hist-from").inputValue();
    await page.locator("[data-matrix-share]").click();
    assert.equal(await page.locator("#hist-from").inputValue(), date);
    assert.equal(await page.locator("#hist-to").inputValue(), date);
    await page.locator("#sum-activities").check();
    await page.locator("#sum-notes").uncheck();
    assert.doesNotMatch(await page.locator("#summary-preview").textContent(), /PRIVATE SECRET/);
    assert.match(await page.locator("#summary-preview").textContent(), /Long activity name/);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#csv-eps").click(),
    ]);
    const csv = fs.readFileSync(await download.path(), "utf8");
    assert.doesNotMatch(csv, /PRIVATE SECRET/);
    await page.locator("#sum-notes").check();
    assert.match(await page.locator("#summary-preview").textContent(), /PRIVATE SECRET/);
    await page.locator("#history-return-period").click();
    assert.equal(await page.locator("#hist-from").inputValue(), prior);
    await page.locator("#hist-query").fill("nothing matches this");
    await page.waitForFunction(() => document.querySelector("#csv-days").disabled);
    assert.ok(await page.locator("#csv-eps").isDisabled());
    assert.match(await page.locator("#sharing-counts").textContent(), /No matching records/);
    await page.locator("#t-today").click();
    await page.locator("#other-activity").click();
    await page.locator("#entry-name").fill("A".repeat(61));
    assert.equal(await page.locator("#entry-name").evaluate((el) => el.checkValidity()), false);
    await page.locator("#entry-name").fill("🙂".repeat(60));
    assert.equal(await page.locator("#entry-name").evaluate((el) => el.checkValidity()), true);
    await page.locator("#entry-name").fill("Reusable activity " + width);
    await page.locator("#entry-cost").fill("2");
    await page.locator("#entry-save-choice").check();
    await page.locator("#entry-group").fill("Everyday");
    await page.locator("#entry-form [type=submit]").click();
    await page.waitForFunction(() => document.querySelector("#sync").dataset.state === "saved");
    assert.ok(docs.settings.body.activities.some((x) => x.a === "Reusable activity " + width));
    const controlsContained = await page.locator(".act.on").evaluateAll((cards) =>
      cards.every((card) => {
        const box = card.getBoundingClientRect();
        return [...card.querySelectorAll("button")].every((b) => {
          const r = b.getBoundingClientRect();
          return r.left >= box.left + 8 && r.right <= box.right - 8;
        });
      }),
    );
    assert.ok(controlsContained, `activity controls retain padding at ${width}`);
    await page.screenshot({ path: `/tmp/jiggered-mobile-fix-${width}.png`, fullPage: false });
    await context.close();
    // Reset fixture entries between independent viewports.
    docs["d-" + date].body.entries = docs["d-" + date].body.entries.slice(0, 8);
  }
  assert.deepEqual(errors, []);
  console.log(
    "Mobile alignment, profile row gaps, validation, reusable activity, selected-day return, private sharing and empty exports passed.",
  );
});
