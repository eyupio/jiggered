// The planning timeline on Plan, driven the way a person drives it: a real mouse, the keyboard, and real touch input.
// The real application with a private in-memory API fixture; no user data.
const { runBrowser } = require("./support/browser.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../web");
const defaults = JSON.parse(fs.readFileSync(path.join(root, "defaults.json"), "utf8"));
const add = (day, n) =>
  new Date(Date.parse(day + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10),
  d1 = add(today, 1),
  d2 = add(today, 2);
const until = async (done, what) => {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(done(), what);
};

// The grid repaints when a save is acknowledged, replacing its elements; measure again if that lands mid-measurement.
const box = async (locator) => {
  for (let i = 0; i < 40; i++) {
    const found = await locator.boundingBox().catch(() => null);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("element never settled");
};
runBrowser({ name: "calendar", startServer: false }, async (harness) => {
  const browser = await harness.launchBrowser();
  const plan = (...entries) => ({ rev: 1, body: { entries } });
  const seed = () => ({
    settings: {
      rev: 1,
      body: { ...defaults, onboarding: { dismissed: true }, profile: { theme: "light" } },
    },
    ["p-" + today]: plan(
      { id: "p1", a: "Presentation or deadline", c: 3, t: "15:00", dur: 90 },
      { id: "p2", a: "Quiet break", c: -2, t: "17:00", dur: 45 },
    ),
    ["p-" + d1]: plan(
      { id: "p3", a: "Deep focus (2 hours)", c: 1, t: "09:00", dur: 120 },
      { id: "p4", a: "Shopping trip", c: 2, t: "10:00", dur: 60 },
      { id: "p5", a: "Hard conversation", c: 3, t: "14:00", dur: 60 },
      { id: "p6", a: "Admin or paperwork", c: 1 },
    ),
    ["p-" + d2]: plan({ id: "p7", a: "Meeting or call", c: 2, t: "10:00", dur: 30 }),
  });
  async function openPlan(options) {
    const docs = seed(),
      errors = [];
    const context = await browser.newContext({
      timezoneId: "UTC",
      serviceWorkers: "block",
      ...options,
    });
    await context.route("http://localhost:18759/**", async (route) => {
      const request = route.request(),
        pathname = new URL(request.url()).pathname;
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
    await page.goto("http://localhost:18759/");
    await page.locator("#acts .act, #acts button.act").first().waitFor();
    await page.locator("#t-plan").click();
    await page.locator(".cal-block").first().waitFor();
    return { page, context, docs, errors };
  }
  const entry = (docs, day, id) => docs["p-" + day]?.body.entries.find((e) => e.id === id);
  const slot = (page, day, minute) =>
    page.evaluate(
      ([day, minute]) => {
        const col = [...document.querySelectorAll("[data-cal-col]")].find(
            (c) => c.dataset.date === day,
          ),
          r = col.getBoundingClientRect(),
          hours = Number(
            getComputedStyle(document.querySelector("[data-cal-body]")).getPropertyValue("--hours"),
          ),
          first = Number(document.querySelector(".cal-rail span").textContent.slice(0, 2)) * 60,
          sc = document.querySelector(".cal-scroll").getBoundingClientRect(),
          y = r.top + ((minute - first) / (hours * 60)) * r.height;
        // Stay clear of the scroller's edges: near them a drag deliberately scrolls.
        if (y < sc.top + 90 || y > sc.bottom - 60)
          throw new Error(`${minute} min is not comfortably on screen`);
        return { x: r.left + r.width / 2, y };
      },
      [day, minute],
    );
  const show = (page) =>
    page.evaluate(() => {
      document.getElementById("plan-board").scrollIntoView({ block: "center" });
      document.querySelector(".cal-scroll").scrollTop = 56;
    });
  const block = (page, id) => page.locator(`.cal-block[data-id="${id}"]`);
  async function drag(page, from, to) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }
  const undo = (page) => page.locator("#toastbar button").click();

  // ---------------- desktop: a mouse, the keyboard, and the palette ----------------
  {
    const { page, context, docs, errors } = await openPlan({
      viewport: { width: 1440, height: 1000 },
    });
    await show(page);

    // What is drawn: every timed block, the untimed one in "Any time", overlaps side by side, today marked.
    assert.equal(await page.locator("[data-cal-col]").count(), 7);
    assert.equal(await page.locator(".cal-block").count(), 6, "six timed blocks");
    assert.equal(await page.locator(".cal-tray .cal-chip").count(), 1);
    const lanes = await page.evaluate(() =>
      ["p3", "p4"].map((id) => {
        const b = document.querySelector(`.cal-block[data-id="${id}"]`);
        return `${b.dataset.lane}/${b.dataset.lanes}`;
      }),
    );
    assert.deepEqual(lanes, ["0/2", "1/2"], "overlapping blocks share the column");
    assert.equal(await page.locator(".cal-col.is-today .cal-now").count(), 1);
    assert.match(await block(page, "p3").getAttribute("aria-label"), /09:00–11:00/);
    assert.equal(
      await page.evaluate(() => {
        const chip = document.querySelector(".cal-tray .cal-chip").getBoundingClientRect(),
          sc = document.querySelector(".cal-scroll").getBoundingClientRect();
        return chip.top >= sc.top && chip.bottom <= sc.bottom;
      }),
      true,
      "the Any time row is visible without scrolling",
    );
    await page.evaluate(() => (document.querySelector(".cal-scroll").scrollTop = 300));
    assert.equal(await page.locator(".cal-tray .cal-chip").isVisible(), true);
    await show(page);

    // Move within a day: 14:00 -> 12:00. Undo puts it back.
    let b = await box(block(page, "p5"));
    await drag(
      page,
      { x: b.x + 30, y: b.y + 8 },
      { ...(await slot(page, d1, 12 * 60)), y: (await slot(page, d1, 12 * 60)).y + 8 },
    );
    await until(() => entry(docs, d1, "p5")?.t === "12:00", "moved to 12:00");
    assert.equal(entry(docs, d1, "p5").dur, 60);
    assert.match(
      await page.locator("#toastbar").textContent(),
      /Moved Hard conversation to .*12:00–13:00/,
    );
    await undo(page);
    await until(() => entry(docs, d1, "p5")?.t === "14:00", "undo restores 14:00");

    // Escape cancels a drag: nothing changes and nothing is announced.
    await page.locator("#toastbar").evaluate((el) => (el.hidden = true));
    b = await box(block(page, "p5"));
    const away = await slot(page, d1, 12 * 60);
    await page.mouse.move(b.x + 30, b.y + 8);
    await page.mouse.down();
    await page.mouse.move(away.x, away.y, { steps: 10 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.equal(entry(docs, d1, "p5").t, "14:00", "Escape cancels the drag");
    assert.equal(
      await page.locator("#plan-form").isHidden(),
      true,
      "letting go after Escape is not a click",
    );
    assert.equal(await page.locator("#toastbar").isHidden(), true);

    // Move to another day: it leaves the first day and arrives on the second at 13:00, with one Undo.
    b = await box(block(page, "p5"));
    const there = await slot(page, d2, 13 * 60);
    await drag(page, { x: b.x + 30, y: b.y + 8 }, { x: there.x, y: there.y + 8 });
    await until(() => entry(docs, d2, "p5")?.t === "13:00", "arrived on the second day");
    await until(() => !entry(docs, d1, "p5"), "left the first day");
    await undo(page);
    await until(
      () => entry(docs, d1, "p5")?.t === "14:00" && !entry(docs, d2, "p5"),
      "undo moves it back",
    );

    // Resize from the bottom edge (60 -> 120 minutes) and from the top edge (10:00-10:30 -> 09:30-10:30).
    b = await box(block(page, "p4"));
    await drag(
      page,
      { x: b.x + b.width / 2, y: b.y + b.height - 2 },
      { x: b.x + b.width / 2, y: b.y + b.height - 2 + 56 },
    );
    await until(() => entry(docs, d1, "p4")?.dur === 120, "bottom edge lengthens it");
    assert.equal(entry(docs, d1, "p4").t, "10:00");
    b = await box(block(page, "p7"));
    await drag(
      page,
      { x: b.x + b.width / 2, y: b.y + 2 },
      { x: b.x + b.width / 2, y: b.y + 2 - 28 },
    );
    await until(() => entry(docs, d2, "p7")?.t === "09:30", "top edge moves the start");
    assert.equal(entry(docs, d2, "p7").dur, 60);

    // Drag a saved activity from the palette: the length in its name is suggested. Undo removes it.
    const chip = await box(page.locator('.cal-preset[data-preset="3"]'));
    const drop = await slot(page, d2, 12 * 60);
    await drag(page, { x: chip.x + 20, y: chip.y + 10 }, { x: drop.x, y: drop.y + 4 });
    await until(() => docs["p-" + d2].body.entries.length === 2, "palette drop added an entry");
    const dropped = docs["p-" + d2].body.entries.find((e) => e.a === "Deep focus (2 hours)");
    assert.deepEqual([dropped.t, dropped.dur, dropped.c], ["12:00", 120, 1]);
    await undo(page);
    await until(
      () => !docs["p-" + d2].body.entries.some((e) => e.a === "Deep focus (2 hours)"),
      "undo removes it",
    );
    // A plain click on a palette item fills the form instead of placing it.
    await page.locator('.cal-preset[data-preset="3"]').click();
    assert.equal(await page.locator("#plan-form").isVisible(), true);
    assert.equal(await page.locator("#plan-name").inputValue(), "Deep focus (2 hours)");
    assert.equal(await page.locator("#plan-dur").inputValue(), "120");
    await page.locator("#plan-cancel").click();

    // Click an empty space: the form opens for that day and time (11:20 is in the 11:15 slot).
    await show(page);
    const empty = await slot(page, d1, 11 * 60 + 20);
    await page.mouse.click(empty.x, empty.y);
    assert.equal(await page.locator("#plan-form").isVisible(), true);
    assert.equal(await page.locator("#plan-time").inputValue(), "11:15");
    assert.equal(await page.locator("#plan-dur").inputValue(), "60");
    assert.match(
      await page.locator("#plan-date-label").textContent(),
      new RegExp(`\\b${Number(d1.slice(8))}\\b`),
    );
    await page.locator("#plan-cancel").click();
    // Clicking a block opens it for editing.
    await show(page);
    await block(page, "p3").click();
    assert.equal(await page.locator("#plan-name").inputValue(), "Deep focus (2 hours)");
    assert.equal(await page.locator("#plan-time").inputValue(), "09:00");
    assert.equal(await page.locator("#plan-dur").inputValue(), "120");
    await page.locator("#plan-cancel").click();

    // The keyboard: arrows move a focused block, Shift changes its length, Right/Left change day. One Undo undoes the run.
    await show(page);
    await block(page, "p3").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await until(() => entry(docs, d1, "p3")?.t === "09:30", "two Down presses move it 30 minutes");
    assert.equal(
      await page.evaluate(() => document.activeElement.dataset.key),
      `${d1}|p3`,
      "focus stays on the block after it is repainted",
    );
    await page.keyboard.press("Shift+ArrowDown");
    await until(() => entry(docs, d1, "p3")?.dur === 135, "Shift+Down lengthens it");
    await page.keyboard.press("ArrowRight");
    await until(
      () => entry(docs, d2, "p3")?.t === "09:30" && !entry(docs, d1, "p3"),
      "Right moves it a day",
    );
    assert.equal(await page.evaluate(() => document.activeElement.dataset.key), `${d2}|p3`);
    assert.match(
      await page.locator(".cal [role=status]").textContent(),
      /Deep focus.*09:30 to 11:45/,
    );
    await undo(page);
    await until(
      () =>
        entry(docs, d1, "p3")?.t === "09:00" &&
        entry(docs, d1, "p3").dur === 120 &&
        !entry(docs, d2, "p3"),
      "one Undo restores where it began",
    );

    // The hours keep their place when you visit another tab and come back.
    await page.evaluate(() => (document.querySelector(".cal-scroll").scrollTop = 300));
    await page.waitForTimeout(120);
    await page.locator("#t-today").click();
    await page.locator("#t-plan").click();
    assert.equal(
      await page.evaluate(() => document.querySelector(".cal-scroll").scrollTop),
      300,
      "the timeline keeps its place",
    );

    await harness.screenshot(page, "calendar-1440.png");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---------------- phone: one day, a grip to move blocks, and a page that still scrolls ----------------
  {
    const { page, context, docs, errors } = await openPlan({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    assert.equal(await page.locator("[data-cal-col]").count(), 1, "a phone shows one day");
    assert.equal(await page.locator("#plan-palette").isHidden(), true);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.evaluate(() => (document.querySelector(".cal-scroll").scrollTop = 400));
    await page.evaluate(() => {
      const b = document.querySelector('.cal-block[data-id="p1"]');
      window.scrollBy(0, b.getBoundingClientRect().top - 250);
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    async function swipe(from, dy) {
      await touch("touchStart", from.x, from.y);
      for (let i = 1; i <= 10; i++) await touch("touchMove", from.x, from.y + (dy * i) / 10);
      await touch("touchEnd");
      await page.waitForTimeout(250);
    }
    // A finger on the body of a block scrolls; it does not move the block.
    const body = await box(page.locator('.cal-block[data-id="p1"] .cal-title'));
    await swipe({ x: body.x + 20, y: body.y + 40 }, 80);
    assert.deepEqual([entry(docs, today, "p1").t, entry(docs, today, "p1").dur], ["15:00", 90]);
    // The grip moves it: 72px is one hour at the touch scale.
    await page.evaluate(() => {
      const b = document.querySelector('.cal-block[data-id="p1"]');
      window.scrollBy(0, b.getBoundingClientRect().top - 250);
    });
    const grip = await box(page.locator('.cal-block[data-id="p1"] .cal-grip'));
    assert.ok(grip.width >= 36 && grip.height >= 36, "the grip is big enough to hold");
    await swipe({ x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }, 72);
    await until(() => entry(docs, today, "p1")?.t === "16:00", "the grip moves the block an hour");
    assert.equal(entry(docs, today, "p1").dur, 90);
    // A tap opens it for editing.
    await page.locator('.cal-block[data-id="p1"]').tap();
    assert.equal(await page.locator("#plan-form").isVisible(), true);
    assert.equal(await page.locator("#plan-time").inputValue(), "16:00");
    await harness.screenshot(page, "calendar-375.png");
    assert.deepEqual(errors, []);
    await context.close();
  }
});
