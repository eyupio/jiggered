// Real app, slow initial responses and disposable per-person API documents.
const { runBrowser } = require("./support/browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const root = path.resolve(__dirname, "../web");
const defaults = JSON.parse(fs.readFileSync(path.join(root, "defaults.json"), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const dayAt = (i) => {
  const d = new Date(today + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - i);
  return d.toISOString().slice(0, 10);
};
const docs = {
  settings: {
    rev: 1,
    body: {
      ...defaults,
      profile: { displayName: "Alex", theme: "light", historyRange: "30" },
      onboarding: { dismissed: true },
    },
  },
};
function addDays(count) {
  for (let i = 0; i < count; i++)
    docs["d-" + dayAt(i)] = {
      rev: 1,
      body: {
        date: dayAt(i),
        status: ["green", "amber", "red"][i % 3],
        budget: 10,
        poorSleep: false,
        entries: [{ id: "activity", a: "Review day", c: 2 }],
      },
    };
}
addDays(4);
let slow = false,
  person = { id: 1, username: "alex", role: "admin", must_change_password: false };
runBrowser({ name: "view-state", startServer: false }, async (harness) => {
  const browser = await harness.launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    timezoneId: "UTC",
    serviceWorkers: "block",
  });
  const errors = [];
  await context.addInitScript(() => {
    window.historyPaints = [];
    let frames = 0;
    function sample() {
      const panel = document.querySelector("#history-panel");
      if (panel && !panel.hidden && !document.body.classList.contains("app-loading")) {
        window.historyPaints.push({
          period: document.querySelector("#history-range")?.value,
          count: document.querySelector("#history-count").textContent,
        });
      }
      if (++frames < 600) requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
  const fixture = async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      pathname = url.pathname;
    const json = (body, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (pathname === "/api/me") return json(person);
    if (pathname === "/api/defaults") {
      if (slow) await delay(450);
      return json(defaults);
    }
    if (pathname === "/api/docs") {
      if (slow) await delay(350);
      return json(person.id === 1 ? docs : {});
    }
    if (pathname.startsWith("/api/docs/") && request.method() === "PUT") {
      const id = decodeURIComponent(pathname.slice("/api/docs/".length));
      docs[id] = { rev: (docs[id]?.rev || 0) + 1, body: request.postDataJSON() };
      return json({ rev: docs[id].rev });
    }
    if (pathname === "/api/me/sessions") return json([]);
    if (pathname === "/api/me/security") return json({ two_factor: false, email_available: false });
    if (pathname === "/api/admin/users") return json({ users: [], version: "fixture" });
    if (pathname === "/api/admin/audit") {
      const before = Number(url.searchParams.get("before")) || 100;
      return json(
        Array.from({ length: Number(url.searchParams.get("limit")) || 30 }, (_, i) => ({
          id: before - i - 1,
          at: new Date().toISOString(),
          actor: "alex",
          action: "login",
          target: "alex",
          detail: "",
        })),
      );
    }
    if (pathname.startsWith("/api/")) return json({ error: "Fixture has no configuration." }, 400);
    if (pathname === "/login")
      return route.fulfill({ contentType: "text/html", body: "<h1>Sign in</h1>" });
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
  };
  await context.route("http://localhost:18759/**", fixture);
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  async function ready() {
    await page.waitForFunction(() => !document.body.classList.contains("app-loading"));
  }
  async function reload() {
    await page.reload();
    await ready();
  }
  await page.goto("http://localhost:18759/#history");
  await ready();
  await page.locator("#history-range").selectOption("7");
  assert.match(await page.locator("#history-count").textContent(), /^4 days/);
  addDays(7);
  slow = true;
  await reload();
  await page.waitForFunction(() => window.historyPaints.length > 0);
  const paints = await page.evaluate(() => window.historyPaints);
  assert.ok(
    paints.every((p) => p.period === "7" && /^7 days/.test(p.count)),
    "first visible frame uses saved 7-day period and final records, never 30 days or cached 4 days",
  );
  slow = false;
  // Calm keeps the calendar and day visible, with optional detail closed until requested.
  for (const id of ["history-share", "history-records", "history-explore"])
    assert.equal(await page.locator("#" + id).getAttribute("open"), null);
  Object.assign(docs["d-" + today].body, {
    status: "amber",
    statusPenalty: 3,
    entries: [
      { id: "conversation", a: "Hard conversation", c: 3, t: "09:56" },
      { id: "driving", a: "Driving (30 min)", c: 2, t: "12:30" },
    ],
  });
  docs["d-" + dayAt(1)].body.entries = [{ id: "rest", a: "Rest", c: -2 }];
  docs["d-" + dayAt(1)].body.status = "green";
  docs["d-" + dayAt(2)].body.entries = [];
  delete docs["d-" + dayAt(4)];
  docs["e-900"] = {
    rev: 1,
    body: {
      when: dayAt(4) + "T09:00",
      symptoms: ["Headache"],
      before: [],
      notes: "Private note for clinician",
      duration: "10 minutes",
      onset: "Gradual",
    },
  };
  await reload();
  assert.equal(await page.locator(".matrix-balance > b").textContent(), "2");
  assert.match(
    await page.locator(".matrix-activities").textContent(),
    /Hard conversation.*09:56.*−3.*Driving.*12:30.*−2/,
  );
  const latestCell = page.locator('[data-matrix-grid] [data-date="' + today + '"]');
  await latestCell.focus();
  await latestCell.press("ArrowUp");
  assert.equal(await page.locator('[data-matrix-grid] button[tabindex="0"]').count(), 1);
  await page.locator('[data-matrix-grid] button[tabindex="0"]').press("Enter");
  assert.equal(
    await page.locator('[data-date="' + dayAt(1) + '"]').getAttribute("aria-pressed"),
    "true",
  );
  await page.locator('[data-matrix-grid] button[tabindex="0"]').press("Escape");
  assert.equal(await page.locator('[data-matrix-grid] [aria-pressed="true"]').count(), 0);
  await latestCell.click();
  await page.locator("[data-matrix-mode]").selectOption("remaining");
  await page.locator("[data-matrix-prev]").click();
  assert.equal(
    await page.locator(".matrix-balance > b").textContent(),
    "12",
    "recovery retains negative net usage",
  );
  await page.locator("[data-matrix-prev]").click();
  assert.equal(
    await page.locator(".matrix-balance > b").textContent(),
    "—",
    "a check-in alone does not invent an activity balance",
  );
  await page.locator('[data-matrix-grid] [data-date="' + dayAt(4) + '"]').click();
  assert.match(
    await page.locator("[data-matrix-reading]").textContent(),
    /Nothing logged for this day.*Headache/s,
  );
  await page.locator("[data-matrix-edit]").click();
  assert.equal(await page.locator("#ep-title").textContent(), "Edit episode");
  // An edit that began in History ends there: the back button says so and goes there.
  assert.equal((await page.locator("#ep-cancel").textContent()).trim(), "Back to History");
  await page.locator("#ep-cancel").click();
  await page.locator("#history-panel:not([hidden])").waitFor();
  await page.locator("#t-history").click();
  await page.locator('[data-matrix-grid] [data-date="' + today + '"]').click();
  await page.locator("[data-matrix-mode]").selectOption("checkin");
  if (process.env.JIGGERED_SCREENSHOT_DIR) {
    fs.mkdirSync(process.env.JIGGERED_SCREENSHOT_DIR, { recursive: true });
    await page.evaluate(() => {
      document.activeElement.blur();
      scrollTo(0, 0);
    });
    await page.setViewportSize({
      width: 1280,
      height: await page.evaluate(() => document.documentElement.scrollHeight),
    });
    await page.mouse.move(1000, 5);
    await page.screenshot({
      path: path.join(process.env.JIGGERED_SCREENSHOT_DIR, "calm-history-desktop.png"),
    });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "Calm fits phone widths",
    );
    if (width === 390 && process.env.JIGGERED_SCREENSHOT_DIR) {
      await page.evaluate(() => {
        document.activeElement.blur();
        scrollTo(0, 0);
      });
      await page.setViewportSize({
        width,
        height: await page.evaluate(() => document.documentElement.scrollHeight),
      });
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: path.join(process.env.JIGGERED_SCREENSHOT_DIR, "calm-history-phone.png"),
      });
      await page.setViewportSize({ width, height: 900 });
    }
    for (const range of ["7", "30", "90", "180", "365"]) {
      await page.locator("#history-range").selectOption(range);
      assert.equal(
        await page.locator("[data-matrix-grid] button").count(),
        Math.min(Number(range), 35),
        "a phone shows five weeks of the chosen range at a time",
      );
      assert.equal(
        await page.locator("[data-matrix-grid]").evaluate((el) => el.children.length % 7),
        0,
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#history-range").selectOption("7");
  await page.locator("#history-prepare").click();
  assert.equal(await page.locator("#sum-notes").isChecked(), false);
  assert.match(await page.locator("#summary-preview").textContent(), /7 days:.*Episodes \(1\)/s);
  assert.doesNotMatch(
    await page.locator("#summary-preview").textContent(),
    /Private note for clinician/,
  );
  await page.locator("#sum-notes").check();
  assert.match(await page.locator("#summary-preview").textContent(), /Private note for clinician/);
  await reload();
  assert.equal(
    await page.locator("#sum-notes").isChecked(),
    true,
    "explicit note choice is sticky",
  );
  await page.locator("#sum-notes").uncheck();
  await page.locator("#history-filter-panel summary").click();
  await page.locator("#hist-from").fill(dayAt(1));
  await page.locator("#hist-to").fill(today);
  await page.locator("#hist-query").fill("driving");
  await page.waitForFunction(() =>
    document.querySelector("#history-count").textContent.startsWith("1 day and 0 episodes"),
  );
  assert.equal(await page.locator("#history-range").inputValue(), "custom");
  assert.match(
    await page.locator("#summary-preview").textContent(),
    /Custom dates:.*Filters:.*driving.*Episodes \(0\)/s,
  );
  assert.doesNotMatch(
    await page.locator("#summary-preview").textContent(),
    /Private note for clinician|Rest/,
  );
  const csvDownload = page.waitForEvent("download");
  await page.locator("#csv-days").click();
  const csv = fs.readFileSync(await (await csvDownload).path(), "utf8");
  assert.ok(csv.includes(today));
  assert.ok(!csv.includes(dayAt(1)), "CSV and summary share the filtered selection");
  // Export immediately after typing: the pending search must complete before a file is produced.
  await page.locator("#hist-query").fill("rest");
  const latestDownload = page.waitForEvent("download");
  await page.locator("#csv-days").click();
  const latestCsv = fs.readFileSync(await (await latestDownload).path(), "utf8");
  assert.ok(latestCsv.includes(dayAt(1)) && !latestCsv.includes(today));
  await page.locator("#hist-query").fill("driving");
  await page.locator("#hist-query").press("Enter");
  await page.evaluate(() => {
    window.print = () => {
      window.printedSummary = document.querySelector("#print-view").innerHTML;
      window.dispatchEvent(new Event("afterprint"));
    };
  });
  await page.locator("#sum-print").click();
  assert.equal(
    await page.evaluate(() => window.printedSummary),
    await page.locator("#summary-preview").innerHTML(),
  );
  await page.locator('#history-filters [type="reset"]').click();
  assert.equal(
    await page.locator("#hist-from").inputValue(),
    dayAt(1),
    "clearing search retains custom dates",
  );
  await page.locator("#hist-to").fill(dayAt(2));
  for (const id of ["history-prepare", "sum-print", "csv-days", "csv-eps"])
    assert.equal(
      await page.locator("#" + id).isDisabled(),
      true,
      "invalid dates cannot export a stale selection",
    );
  assert.match(await page.locator("#summary-preview").textContent(), /Choose valid dates/);
  await page.locator("#history-range").selectOption("7");
  await page.locator("#sum-preview").click();
  await page.locator("#history-share > summary").click();
  await page.locator("#history-filter-panel > summary").click();
  delete docs["e-900"];
  addDays(70);

  for (let i = 0; i < 42; i++)
    docs["e-" + (1000 + i)] = {
      rev: 1,
      body: {
        when: dayAt(i) + "T09:00",
        symptoms: [i % 2 ? "Headache" : "Tingling"],
        before: [],
        notes: "review",
        duration: "10 minutes",
        onset: "Gradual",
      },
    };
  await reload();
  await page.locator("#history-range").selectOption("90");
  await page.locator("#history-records summary").click();
  await page.locator("#history-explore > summary").click();
  await page.locator("#history-share summary").click();
  await page.locator("#more-days").click();
  await page.locator("#more-eps").click();
  await page.locator("[data-matrix-mode]").selectOption("episodes");
  await page.locator('[data-matrix-grid] [data-date="' + dayAt(5) + '"]').click();
  await page.locator("#chart-energy-select").selectOption("2");
  await page.locator("#chart-energy-data summary").click();
  await page.locator("#sum-notes").uncheck();
  await page.locator("#sum-preview").click();
  await page.evaluate(() => scrollTo(0, 700));
  await page.waitForFunction(
    () =>
      JSON.parse(sessionStorage.getItem("jiggered:view:1:alex")).views.nav.scrolls.history === 700,
  );
  await reload();
  assert.equal(await page.locator("#days li").count(), 60);
  assert.equal(await page.locator("#eps .ep").count(), 42);
  assert.equal(await page.locator("[data-matrix-mode]").inputValue(), "episodes");
  assert.equal(
    await page.locator('[data-date="' + dayAt(5) + '"]').getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(await page.locator("#chart-energy-select").inputValue(), "2");
  assert.equal(await page.locator("#chart-energy-data").getAttribute("open"), "");
  assert.equal(await page.locator("#history-range").inputValue(), "90");
  for (const id of ["history-records", "history-explore", "history-share"])
    assert.equal(
      await page.locator("#" + id).getAttribute("open"),
      "",
      "open section survives refresh",
    );
  assert.match(await page.locator("#summary-preview").textContent(), /90 days:/);
  assert.equal(await page.locator("#sum-notes").isChecked(), false);
  assert.equal(await page.locator("#summary-preview").isVisible(), true);
  assert.equal(await page.evaluate(() => scrollY), 700);
  await page.setViewportSize({ width: 320, height: 900 });
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
    "open records, charts and preview fit a small phone",
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#history-filter-panel summary").click();
  await page.locator("#hist-symptom").selectOption("Tingling");
  await page.locator("#hist-status").selectOption("amber");
  await page.locator("#hist-query").fill("review");
  await page.waitForFunction(() =>
    document.querySelector("#history-count").textContent.startsWith("23 days and 21 episodes"),
  );
  await reload();
  assert.equal(await page.locator("#hist-symptom").inputValue(), "Tingling");
  assert.equal(await page.locator("#hist-status").inputValue(), "amber");
  assert.equal(await page.locator("#hist-query").inputValue(), "review");
  assert.match(await page.locator("#history-count").textContent(), /^23 days and 21 episodes/);
  await page.locator("#days [data-day]").first().click();
  const openedDate = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("jiggered:view:1:alex")).views.today.day,
  );
  await page.locator("#act-search").fill("coffee");
  await reload();
  assert.equal(await page.locator("#act-search").inputValue(), "coffee");
  assert.equal(
    await page.evaluate(
      () => JSON.parse(sessionStorage.getItem("jiggered:view:1:alex")).views.today.day,
    ),
    openedDate,
  );
  await page.locator("#t-history").click();
  await page.locator("#eps .edit").first().click();
  await page.locator("#ep-notes").fill("unfinished edit");
  await reload();
  assert.equal(await page.locator("#ep-notes").inputValue(), "unfinished edit");
  assert.equal(await page.locator("#ep-title").textContent(), "Edit episode");
  await page.locator("#t-history").click();
  await page.locator("header [data-help]").click();
  await page.locator("#help-search").fill("privacy");
  await reload();
  assert.equal(await page.locator("#help-search").inputValue(), "privacy");
  await page.locator("#help-back").click();
  assert.equal(await page.locator("#history-panel").isVisible(), true);
  await page.locator("#t-admin").click();
  await page.locator('[data-admin-section="activity"]').click();
  await page.locator("#audit-more").click();
  await page.waitForFunction(() => document.querySelector("#audit").children.length === 60);
  await reload();
  assert.equal(
    await page.locator('[data-admin-section="activity"]').getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator("#audit li").count(), 60);

  // Photo remains a draft until saved; invalid files preserve it; both identity surfaces reload it.
  await page.locator("#t-account").click();
  await page.locator("#account-tab-profile").click();
  const photo = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 200;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#207970";
    ctx.fillRect(0, 0, 300, 200);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#profile-photo").setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(photo, "base64"),
  });
  await page.waitForFunction(() =>
    document.querySelector("#profile-photo-msg").textContent.includes("Photo ready"),
  );
  assert.equal(await page.locator("#acc-avatar img").count(), 0);
  await page.locator("#profile-region").selectOption("AU");
  await reload();
  assert.equal(await page.locator("#profile-photo-preview img").count(), 1);
  assert.equal(await page.locator("#profile-region").inputValue(), "AU");
  assert.equal(
    await page.locator("#episode-panel [data-emergency-call]").textContent(),
    "Call your local emergency number",
  );
  await page.locator("#profile-photo").setInputFiles({
    name: "bad.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg></svg>"),
  });
  await page.waitForFunction(() =>
    document.querySelector("#profile-photo-msg").textContent.includes("Choose a JPEG"),
  );
  assert.equal(await page.locator("#profile-photo-preview img").count(), 1);
  await page.locator("#profile-save").click();
  await page.waitForFunction(() =>
    document.querySelector("#profile-msg").textContent.includes("Saved"),
  );
  assert.ok(docs.settings.body.profile.avatar.length < 32768);
  await reload();
  assert.equal(await page.locator("#acc-avatar img").count(), 1);
  assert.equal(await page.locator("#who-initials img").count(), 1);
  assert.equal(await page.locator("#acc-avatar img").evaluate((img) => img.naturalWidth), 192);
  for (const [region, expected] of [
    ["AU", "000"],
    ["GB", "999 or 112"],
    ["US", "911"],
    ["EU", "112"],
    ["NZ", "111"],
    ["CA", "911"],
    ["other", "your local emergency number"],
  ]) {
    await page.locator("#profile-region").selectOption(region);
    await page.locator("#profile-save").click();
    await page.waitForFunction(
      (text) => document.querySelector("#episode-panel [data-emergency-call]").textContent === text,
      "Call " + expected,
    );
    await page.waitForFunction(() =>
      document.querySelector("#profile-msg").textContent.includes("Saved"),
    );
    await page.locator("header [data-help]").click();
    await page.locator("#help-search").fill("");
    assert.equal(
      await page.locator("#help-episodes [data-emergency-call]").textContent(),
      "Call " + expected,
    );
    await page.locator("#help-back").click();
  }
  await page.setViewportSize({ width: 390, height: 900 });
  await harness.screenshot(page, "profile-mobile.png");
  if (process.env.JIGGERED_SCREENSHOT_DIR)
    await page.locator("#profile-panel").screenshot({
      path: path.join(process.env.JIGGERED_SCREENSHOT_DIR, "profile-panel-mobile.png"),
    });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator("#profile-photo-remove").click();
  await page.locator("#profile-save").click();
  await page.waitForFunction(() => document.querySelector("#acc-avatar img") === null);
  await reload();
  assert.equal(await page.locator("#acc-avatar img").count(), 0);
  // Different signed-in person gets no prior view state, photo, region or form draft.
  person = { id: 2, username: "sam", role: "user", must_change_password: false };
  await reload();
  assert.equal(await page.locator("#profile-region").inputValue(), "");
  assert.equal(await page.locator("#profile-photo-preview img").count(), 0);
  assert.equal(await page.evaluate(() => sessionStorage.getItem("jiggered:view:1:alex")), null);
  assert.equal(await page.locator("#t-admin").count(), 0);
  await page.locator("#t-history").click();
  assert.equal(await page.locator("[data-matrix-grid]").isVisible(), true);
  assert.match(
    await page.locator("[data-matrix-reading]").textContent(),
    /No check-in for this day.*Nothing logged for this day/,
  );
  assert.equal(
    await page.locator(".matrix-facts").textContent(),
    "0Check-ins0Episodes0Poor-sleep days",
  );
  // A first-time account is told what the calendar becomes, and an empty day offers logging, not sharing.
  assert.match(await page.locator("[data-matrix-hint]").textContent(), /Nothing logged yet/);
  assert.equal(await page.locator("[data-matrix-share]").count(), 0);
  assert.equal(await page.locator("[data-matrix-open].primary").textContent(), "Log today");
  await page.locator("[data-matrix-open]").click();
  assert.equal(await page.locator("#today-panel").isVisible(), true);
  await page.locator("#t-account").click();
  // Broken hashes and blocked presentation storage cannot prevent the app from opening.
  await page.goto("http://localhost:18759/#%");
  await ready();
  assert.equal(await page.locator("#account-panel").isVisible(), true);
  const blocked = await browser.newContext({ serviceWorkers: "block" });
  await blocked.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });
  });
  await blocked.route("http://localhost:18759/**", fixture);
  const blockedPage = await blocked.newPage();
  blockedPage.on("pageerror", (error) => errors.push(error.message));
  await blockedPage.goto("http://localhost:18759/#today");
  await blockedPage.waitForFunction(() => !document.body.classList.contains("app-loading"));
  assert.equal(await blockedPage.locator("#today-panel").isVisible(), true);
  await blockedPage.reload();
  await blockedPage.waitForFunction(() => !document.body.classList.contains("app-loading"));
  assert.equal(await blockedPage.locator("#today-panel").isVisible(), true);
  await blocked.close();
  await context.route("http://localhost:18759/api/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Signed out"}' }),
  );
  await page.reload();
  await page.waitForURL("http://localhost:18759/login?e=expired");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("jiggered:view:2:sam")), null);
  assert.deepEqual(errors, []);
  await context.close();
  console.log(
    "Calm History and view state: shared period/filters/exports, private-note opt-in, missing/recovery days, responsive calendar, first visible range/count, paging, graph, summary, scroll, day/edit drafts, Help, Admin, photos and regional warnings passed.",
  );
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
