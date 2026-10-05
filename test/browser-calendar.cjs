// The timelines on Plan and Today, driven the way a person drives it: a real mouse, the keyboard, and real touch input.
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
  async function openApp(options, tab = "plan", extra = {}) {
    const docs = { ...seed(), ...extra },
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
    await page.locator("#t-" + tab).click();
    // On a phone Today's timeline starts closed, so wait for it to be drawn, not for it to be seen.
    await page.locator(`#${tab}-board .cal-block`).first().waitFor({ state: "attached" });
    return { page, context, docs, errors };
  }
  const entry = (docs, day, id) => docs["p-" + day]?.body.entries.find((e) => e.id === id);
  const slot = (page, day, minute, scope = "#plan-board") =>
    page.evaluate(
      ([day, minute, scope]) => {
        const board = document.querySelector(scope),
          col = [...board.querySelectorAll("[data-cal-col]")].find((c) => c.dataset.date === day),
          r = col.getBoundingClientRect(),
          hours = Number(
            getComputedStyle(board.querySelector("[data-cal-body]")).getPropertyValue("--hours"),
          ),
          first = Number(board.querySelector(".cal-rail span").textContent.slice(0, 2)) * 60,
          sc = board.querySelector(".cal-scroll").getBoundingClientRect(),
          y = r.top + ((minute - first) / (hours * 60)) * r.height;
        // Stay clear of the scroller's edges: near them a drag deliberately scrolls.
        if (y < sc.top + 90 || y > sc.bottom - 60)
          throw new Error(`${minute} min is not comfortably on screen`);
        return { x: r.left + r.width / 2, y };
      },
      [day, minute, scope],
    );
  const show = (page, scope = "#plan-board") =>
    page.evaluate((scope) => {
      const board = document.querySelector(scope);
      board.scrollIntoView({ block: "center" });
      board.querySelector(".cal-scroll").scrollTop = 56;
    }, scope);
  const block = (page, id, scope = "#plan-board") =>
    page.locator(`${scope} .cal-block[data-id="${id}"]`);
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
    const { page, context, docs, errors } = await openApp({
      viewport: { width: 1440, height: 1000 },
    });
    await show(page);

    // What is drawn: every timed block, the untimed one in "Any time", overlaps side by side, today marked.
    assert.equal(await page.locator("#plan-board [data-cal-col]").count(), 7);
    assert.equal(await page.locator("#plan-board .cal-block").count(), 6, "six timed blocks");
    assert.equal(await page.locator("#plan-board .cal-tray .cal-chip").count(), 1);
    const lanes = await page.evaluate(() =>
      ["p3", "p4"].map((id) => {
        const b = document.querySelector(`#plan-board .cal-block[data-id="${id}"]`);
        return `${b.dataset.lane}/${b.dataset.lanes}`;
      }),
    );
    assert.deepEqual(lanes, ["0/2", "1/2"], "overlapping blocks share the column");
    assert.equal(await page.locator("#plan-board .cal-col.is-today .cal-now").count(), 1);
    assert.match(await block(page, "p3").getAttribute("aria-label"), /09:00–11:00/);
    assert.equal(
      await page.evaluate(() => {
        const chip = document
            .querySelector("#plan-board .cal-tray .cal-chip")
            .getBoundingClientRect(),
          sc = document.querySelector("#plan-board .cal-scroll").getBoundingClientRect();
        return chip.top >= sc.top && chip.bottom <= sc.bottom;
      }),
      true,
      "the Any time row is visible without scrolling",
    );
    await page.evaluate(() => (document.querySelector("#plan-board .cal-scroll").scrollTop = 300));
    assert.equal(await page.locator("#plan-board .cal-tray .cal-chip").isVisible(), true);
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
    assert.equal(entry(docs, d1, "p4").c, 4, "twice as long, twice the points (2 to 4)");
    assert.equal(entry(docs, d1, "p4").t, "10:00");
    b = await box(block(page, "p7"));
    await drag(
      page,
      { x: b.x + b.width / 2, y: b.y + 2 },
      { x: b.x + b.width / 2, y: b.y + 2 - 28 },
    );
    await until(() => entry(docs, d2, "p7")?.t === "09:30", "top edge moves the start");
    assert.equal(entry(docs, d2, "p7").dur, 60);
    assert.equal(entry(docs, d2, "p7").c, 4, "from the top edge too (2 to 4)");

    // Drag a saved activity from the palette: the length in its name is suggested. Undo removes it.
    const chip = await box(page.locator('#plan-palette .cal-preset[data-preset="3"]'));
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
    // Letting go outside the grid changes nothing: a palette item put back, a block dropped off the board.
    const planned = () =>
      Object.entries(docs)
        .filter(([id]) => id.startsWith("p-"))
        .reduce((n, [, doc]) => n + doc.body.entries.length, 0);
    const count = planned();
    const spare = await box(page.locator('#plan-palette .cal-preset[data-preset="3"]'));
    await drag(page, { x: spare.x + 20, y: spare.y + 10 }, { x: spare.x + 60, y: spare.y + 90 });
    await page.waitForTimeout(250);
    assert.equal(planned(), count, "a palette item put back adds nothing, on any day");
    b = await box(block(page, "p5"));
    await drag(page, { x: b.x + 30, y: b.y + 8 }, { x: spare.x + 40, y: spare.y + 130 });
    await page.waitForTimeout(250);
    assert.equal(entry(docs, d1, "p5").t, "14:00", "a block dropped off the board stays put");
    assert.equal(await page.locator("#plan-form").isHidden(), true, "and that is not a click");
    // A plain click on a palette item fills the form instead of placing it.
    await page.locator('#plan-palette .cal-preset[data-preset="3"]').click();
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
      await page.locator("#plan-board [role=status]").textContent(),
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
    await page.evaluate(() => (document.querySelector("#plan-board .cal-scroll").scrollTop = 300));
    await page.waitForTimeout(120);
    await page.locator("#t-today").click();
    await page.locator("#t-plan").click();
    assert.equal(
      await page.evaluate(() => document.querySelector("#plan-board .cal-scroll").scrollTop),
      300,
      "the timeline keeps its place",
    );

    await harness.screenshot(page, "calendar-1440.png");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---------------- phone: one day, a grip to move blocks, and a page that still scrolls ----------------
  {
    const { page, context, docs, errors } = await openApp({
      viewport: { width: 375, height: 812 },
      isMobile: true,
      hasTouch: true,
    });
    assert.equal(
      await page.locator("#plan-board [data-cal-col]").count(),
      1,
      "a phone shows one day",
    );
    assert.equal(await page.locator("#plan-palette").isHidden(), true);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.evaluate(() => (document.querySelector("#plan-board .cal-scroll").scrollTop = 400));
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

  // ---------------- Today: what is logged and what is planned, on one timeline ----------------
  const loggedDay = () => ({
    ["d-" + today]: {
      rev: 1,
      body: {
        date: today,
        status: "green",
        budget: 10,
        sleepPenalty: 3,
        entries: [
          { id: "l1", a: "Meeting or call", c: 2, t: "09:30", dur: 60 },
          { id: "l2", a: "Cooking a meal", c: 1, t: "12:15" },
        ],
      },
    },
  });
  {
    const T = "#today-board";
    const { page, context, docs, errors } = await openApp(
      { viewport: { width: 1440, height: 2600 } },
      "today",
      loggedDay(),
    );
    const logged = () => docs["d-" + today].body.entries,
      find = (id) => logged().find((e) => e.id === id),
      tile = () => page.locator("#acts button.act", { hasText: "Deep focus (2 hours)" }).first();
    assert.equal(await page.locator("#today-timeline-panel").evaluate((d) => d.open), true);
    assert.match(await page.locator("#today-timeline-summary").textContent(), /2 logged · 2 to do/);
    await show(page, T);

    // What is drawn: logged blocks solid, planned ones dashed with a cue, the header says what is left.
    assert.equal(await page.locator(`${T} .cal-logged`).count(), 2);
    assert.equal(await page.locator(`${T} .cal-plan`).count(), 2);
    assert.match(await page.locator(`${T} .cal-day-head`).textContent(), /\d+ left/);
    assert.match(await block(page, "plan:p1", T).textContent(), /tap to finish/);

    // Tapping a planned block finishes it where it is (no form, no tab change); Undo takes it back.
    await block(page, "plan:p2", T).click();
    await until(() => logged().some((e) => e.id === `planned:${today}:p2`), "finished in place");
    const finished = find(`planned:${today}:p2`);
    assert.match(finished.t, /^\d\d:\d\d$/);
    assert.ok(finished.dur >= 5 && finished.dur <= 45, "its planned length comes along");
    assert.match(await page.locator("#toastbar").textContent(), /Logged Quiet break/);
    await undo(page);
    await until(() => !logged().some((e) => e.id === `planned:${today}:p2`), "undo takes it back");

    // Move a logged block (09:30 -> 11:00), then Undo.
    await show(page, T);
    let b = await box(block(page, "log:l1", T));
    const to = await slot(page, today, 11 * 60, T);
    await drag(page, { x: b.x + 30, y: b.y + 8 }, { x: to.x, y: to.y + 8 });
    await until(() => find("l1").t === "11:00", "a logged block moves");
    assert.equal(find("l1").dur, 60);
    await undo(page);
    await until(() => find("l1").t === "09:30", "undo restores 09:30");

    // A logged block with no recorded length is drawn as 30 minutes; dragging its edge gives it a real one.
    b = await box(block(page, "log:l2", T));
    await drag(
      page,
      { x: b.x + b.width / 2, y: b.y + b.height - 2 },
      { x: b.x + b.width / 2, y: b.y + b.height - 2 + 56 },
    );
    await until(() => find("l2").dur >= 75, "resizing records a length");
    assert.equal(find("l2").t, "12:15");

    // Click an empty space to log something at that time (backfilling): 14:20 is in the 14:15 slot.
    await show(page, T);
    const empty = await slot(page, today, 14 * 60 + 20, T);
    await page.mouse.click(empty.x, empty.y);
    assert.equal(await page.locator("#entry-form").isVisible(), true);
    assert.equal(await page.locator("#entry-time").inputValue(), "14:15");
    assert.equal(await page.locator("#entry-dur").inputValue(), "60");
    await page.locator("#entry-name").fill("Walk");
    await page.locator("#entry-cost").fill("1");
    await page.locator("#entry-form button[type=submit]").click();
    await until(() => logged().some((e) => e.a === "Walk"), "backfilled activity saved");
    assert.deepEqual(
      [find(logged().find((e) => e.a === "Walk").id).t, logged().find((e) => e.a === "Walk").dur],
      ["14:15", 60],
    );

    // Drag an activity from the list onto the timeline: logged at that time, with the length from its name.
    await show(page, T);
    let from = await box(tile());
    const drop = await slot(page, today, 10 * 60 + 45, T);
    await drag(page, { x: from.x + 30, y: from.y + 10 }, { x: drop.x, y: drop.y + 4 });
    await until(
      () => logged().some((e) => e.a === "Deep focus (2 hours)"),
      "dropped activity logged",
    );
    const dropped = logged().find((e) => e.a === "Deep focus (2 hours)");
    assert.deepEqual([dropped.t, dropped.dur], ["10:45", 120]);
    await undo(page);
    await until(() => !logged().some((e) => e.a === "Deep focus (2 hours)"), "undo removes it");

    // Putting an activity back where it came from logs nothing, and is not mistaken for a tap.
    const count = logged().length;
    from = await box(tile());
    await drag(page, { x: from.x + 30, y: from.y + 10 }, { x: from.x + 60, y: from.y + 60 });
    await page.waitForTimeout(250);
    assert.equal(logged().length, count, "an activity put back is not logged");
    // A plain tap on it still records it now, with no length.
    await tile().click();
    await until(() => logged().length === count + 1, "a tap still logs it");
    assert.equal(logged().at(-1).dur, undefined);

    // The keyboard works on logged blocks too, with one Undo for the run.
    await show(page, T);
    await block(page, "log:l1", T).focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await until(() => find("l1").t === "10:00", "arrows move a logged block");
    await undo(page);
    await until(() => find("l1").t === "09:30", "one Undo for the run");

    await harness.screenshot(page, "calendar-today-1440.png");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---------------- Today: placing activities, and points that follow the time they take ----------------
  {
    const T = "#today-board";
    const { page, context, docs, errors } = await openApp(
      { viewport: { width: 1440, height: 1000 } },
      "today",
      loggedDay(),
    );
    const logged = () => docs["d-" + today].body.entries,
      find = (id) => logged().find((e) => e.id === id),
      chip = (name) => page.locator("#today-palette .cal-preset", { hasText: name }),
      meta = (id) => block(page, id, T).locator(".cal-meta");
    const reveal = () =>
      page.evaluate(() => {
        document.querySelector("#today-timeline-panel").scrollIntoView({ block: "start" });
        document.querySelector("#today-board .cal-scroll").scrollTop = 56;
      });
    await reveal();

    // The activities and the timeline are on screen together, so there is something to drag from and to.
    assert.equal(
      await page.evaluate(() => {
        const from = document.querySelector("#today-palette .cal-preset").getBoundingClientRect(),
          to = document.querySelector("#today-board .cal-scroll").getBoundingClientRect();
        return (
          from.top >= 0 && from.bottom <= innerHeight && to.top >= 0 && to.top + 400 <= innerHeight
        );
      }),
      true,
    );
    assert.match(
      await page.locator("#today-timeline-help").textContent(),
      /Drag an activity onto the timeline/,
    );

    // Drag an activity onto a time: logged there, with the length in its name, and Undo takes it back.
    let from = await box(chip("Deep focus (2 hours)"));
    const drop = await slot(page, today, 10 * 60 + 45, T);
    await page.mouse.move(from.x + 20, from.y + 10);
    await page.mouse.down();
    await page.mouse.move(drop.x, drop.y + 4, { steps: 12 });
    assert.match(
      await page.locator(`${T} .cal-drop`).textContent(),
      /10:45–12:45 · Deep focus/,
      "the preview names what is held",
    );
    await page.mouse.up();
    await until(
      () => logged().some((e) => e.a === "Deep focus (2 hours)"),
      "dropped from the list above",
    );
    const dropped = logged().find((e) => e.a === "Deep focus (2 hours)");
    assert.deepEqual([dropped.t, dropped.dur], ["10:45", 120]);
    await undo(page);
    await until(() => !logged().some((e) => e.a === "Deep focus (2 hours)"), "undo removes it");

    // Stretching a block gives the points that go with the longer time, shown as it is dragged. 60 to 120 minutes: 2 to 4.
    await reveal();
    let b = await box(block(page, "log:l1", T));
    const edge = { x: b.x + b.width / 2, y: b.y + b.height - 2 };
    await page.mouse.move(edge.x, edge.y);
    await page.mouse.down();
    await page.mouse.move(edge.x, edge.y + 56, { steps: 10 });
    assert.match(
      await meta("log:l1").textContent(),
      /09:30–11:30 · −4/,
      "the points change as the block does",
    );
    await page.mouse.up();
    await until(() => find("l1").dur === 120, "stretched");
    assert.equal(find("l1").c, 4);
    assert.match(
      await page.locator("#toastbar").textContent(),
      /Meeting or call now 09:30–11:30, −2 to −4 points/,
    );
    await undo(page);
    await until(() => find("l1").dur === 60, "undo gives the length back");
    assert.equal(find("l1").c, 2, "and the points");
    // Shortening from the top edge halves them.
    await reveal();
    b = await box(block(page, "log:l1", T));
    await drag(
      page,
      { x: b.x + b.width / 2, y: b.y + 2 },
      { x: b.x + b.width / 2, y: b.y + 2 + 28 },
    );
    await until(() => find("l1").dur === 30, "shortened");
    assert.deepEqual([find("l1").t, find("l1").c], ["10:00", 1]);
    await undo(page);
    await until(() => find("l1").dur === 60 && find("l1").c === 2, "back to an hour");
    // An activity logged with no length is drawn as half an hour; stretching it to an hour and a half triples its points.
    await reveal();
    b = await box(block(page, "log:l2", T));
    await drag(
      page,
      { x: b.x + b.width / 2, y: b.y + b.height - 2 },
      { x: b.x + b.width / 2, y: b.y + b.height - 2 + 56 },
    );
    await until(() => find("l2").dur === 90, "given a length");
    assert.equal(find("l2").c, 3);
    await undo(page);
    await until(
      () => [undefined, null].includes(find("l2").dur) && find("l2").c === 1,
      "and undone",
    );

    // The keyboard does the same, and a run of presses is worked out from where it began (2 points at 60 minutes).
    await block(page, "log:l1", T).focus();
    await page.keyboard.press("Shift+ArrowDown");
    await until(() => find("l1").dur === 75, "Shift+Down adds a quarter of an hour");
    assert.equal(find("l1").c, 3);
    assert.match(
      await page.locator("#today-board [role=status]").textContent(),
      /Meeting or call.*09:30 to 10:45, −3 points/,
      "said aloud as well",
    );
    await page.keyboard.press("Shift+ArrowDown");
    await until(() => find("l1").dur === 90, "and again");
    assert.equal(find("l1").c, 3, "not 4: each step is not rounded on its own");
    await undo(page);
    await until(() => find("l1").dur === 60 && find("l1").c === 2, "one Undo for the run");

    // In the form, the points follow the Duration field until they are typed over.
    await reveal();
    await block(page, "log:l1", T).click();
    assert.equal(await page.locator("#entry-cost").inputValue(), "2");
    await page.locator("#entry-dur").fill("120");
    await page.locator("#entry-dur").press("Tab");
    assert.equal(await page.locator("#entry-cost").inputValue(), "4");
    assert.match(
      await page.locator("#entry-length-hint").textContent(),
      /−2 for 1 h, so −4 for 2 h/,
    );
    await page.locator("#entry-cost").fill("5");
    await page.locator("#entry-dur").fill("90");
    await page.locator("#entry-dur").press("Tab");
    assert.equal(
      await page.locator("#entry-cost").inputValue(),
      "5",
      "typed points are left alone",
    );
    await page.locator("#entry-cancel").click();
    assert.equal(find("l1").c, 2, "cancelling saves nothing");

    // Pick an activity, then a time: the other way to place one, which needs no dragging.
    await reveal();
    await chip("Quiet break").click();
    assert.equal(await page.locator("#today-placing").isVisible(), true);
    assert.equal(await chip("Quiet break").getAttribute("aria-pressed"), "true");
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#today-placing").isVisible(), false, "Escape lets go of it");
    await chip("Quiet break").click();
    const free = await slot(page, today, 14 * 60 + 20, T);
    await page.mouse.click(free.x, free.y);
    await until(
      () => logged().some((e) => e.a === "Quiet break" && e.t === "14:15"),
      "placed at the time chosen",
    );
    assert.equal(await page.locator("#today-placing").isVisible(), false);
    await undo(page);
    await until(() => !logged().some((e) => e.a === "Quiet break"), "undone");
    // Or log it now instead.
    await chip("Quiet break").click();
    await page.locator("#today-placing-now").click();
    await until(() => logged().some((e) => e.a === "Quiet break"), "logged now");
    assert.match(logged().find((e) => e.a === "Quiet break").t, /^\d\d:\d\d$/);
    await undo(page);

    // Logging something at a time through the form returns you to the timeline when you are done.
    await reveal();
    const y0 = await page.evaluate(() => scrollY);
    const gap = await slot(page, today, 14 * 60 + 20, T);
    await page.mouse.click(gap.x, gap.y);
    assert.equal(await page.locator("#entry-form").isVisible(), true);
    assert.ok(
      Math.abs((await page.evaluate(() => scrollY)) - y0) > 50,
      "the form is lower down the page",
    );
    await page.locator("#entry-cancel").click();
    assert.ok(
      Math.abs((await page.evaluate(() => scrollY)) - y0) <= 3,
      "and cancelling comes back",
    );

    // Carrying an activity up from the list further down the page scrolls the page towards the timeline.
    await page.setViewportSize({ width: 1440, height: 700 });
    await page
      .locator("#acts button.act")
      .first()
      .evaluate((e) => e.scrollIntoView({ block: "center" }));
    const startY = await page.evaluate(() => scrollY);
    // Count the grid's own scrolling of the page, apart from anything the browser does by itself during a drag.
    await page.evaluate(() => {
      const scrollBy = window.scrollBy.bind(window);
      window.__pageScrolls = 0;
      window.scrollBy = (...args) => {
        window.__pageScrolls++;
        return scrollBy(...args);
      };
    });
    const tile = await box(page.locator("#acts button.act").first());
    const count = logged().length;
    await page.mouse.move(tile.x + 30, tile.y + 10);
    await page.mouse.down();
    await page.mouse.move(tile.x + 30, 8, { steps: 10 });
    await page.waitForTimeout(700);
    assert.ok(
      startY - (await page.evaluate(() => scrollY)) > 150,
      "the page scrolled while it was carried",
    );
    assert.ok(
      (await page.evaluate(() => window.__pageScrolls)) > 5,
      "the grid scrolled it, not only the browser",
    );
    await page.mouse.up();
    await page.waitForTimeout(250);
    assert.equal(logged().length, count, "letting go off the timeline logs nothing");
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---------------- Today on a phone ----------------
  {
    const T = "#today-board";
    const { page, context, docs, errors } = await openApp(
      { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
      "today",
      loggedDay(),
    );
    // Open to begin with, with what it needs to place something: the activities, and a short window onto the day.
    assert.equal(await page.locator("#today-timeline-panel").evaluate((d) => d.open), true);
    assert.match(
      await page.locator("#today-timeline-help").textContent(),
      /Tap an activity, then a time/,
    );
    assert.ok(
      (await page.locator("#today-palette .cal-preset").count()) > 5,
      "the activities are listed",
    );
    assert.ok(
      (await box(page.locator(`${T} .cal-scroll`))).height <= 430,
      "a window, not the whole day",
    );
    assert.equal(await page.locator(`${T} [data-cal-col]`).count(), 1);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const place = () =>
      page.evaluate(() => {
        document.querySelector("#today-board .cal-scroll").scrollTop = 56;
        const b = document.querySelector('#today-board .cal-block[data-id="log:l1"]');
        window.scrollBy(0, b.getBoundingClientRect().top - 250);
      });
    await place();
    // Tapping an empty space opens the form for that time.
    const empty = await slot(page, today, 9 * 60 + 20, T);
    await page.touchscreen.tap(empty.x, empty.y);
    assert.equal(await page.locator("#entry-form").isVisible(), true);
    assert.equal(await page.locator("#entry-time").inputValue(), "09:15");
    await page.locator("#entry-cancel").click();
    // The grip moves a logged block: 72px is an hour at the touch scale.
    await place();
    const cdp = await context.newCDPSession(page);
    const touch = (type, x, y) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const grip = await box(page.locator(`${T} .cal-block[data-id="log:l1"] .cal-grip`));
    await touch("touchStart", grip.x + grip.width / 2, grip.y + grip.height / 2);
    for (let i = 1; i <= 10; i++)
      await touch("touchMove", grip.x + grip.width / 2, grip.y + grip.height / 2 + (72 * i) / 10);
    await touch("touchEnd");
    await until(
      () => docs["d-" + today].body.entries.find((e) => e.id === "l1").t === "10:30",
      "the grip moves it an hour",
    );
    // Tap an activity, then tap a time: it is logged there with the length its name gives. (A click straight after a
    // drag is ignored for a moment, so the tap waits for the drag to be over, as a person would.)
    await page.waitForTimeout(300);
    await page.locator("#today-palette .cal-preset", { hasText: "Deep focus (2 hours)" }).tap();
    assert.equal(await page.locator("#today-placing").isVisible(), true);
    await place();
    const spot = await slot(page, today, 9 * 60 + 20, T);
    await page.touchscreen.tap(spot.x, spot.y);
    await until(
      () => docs["d-" + today].body.entries.some((e) => e.a === "Deep focus (2 hours)"),
      "tap an activity, then a time",
    );
    const placed = docs["d-" + today].body.entries.find((e) => e.a === "Deep focus (2 hours)");
    assert.deepEqual([placed.t, placed.dur], ["09:15", 120]);
    assert.equal(
      await page.locator("#today-placing").isVisible(),
      false,
      "one placement at a time",
    );
    // Dragging the bottom handle changes how long it took, and the points follow: an hour more is twice the points.
    await place();
    const handle = await box(
      page.locator(`${T} .cal-block[data-id="log:l1"] .cal-resize[data-edge="bottom"]`),
    );
    await touch("touchStart", handle.x + handle.width / 2, handle.y + handle.height / 2);
    for (let i = 1; i <= 10; i++)
      await touch(
        "touchMove",
        handle.x + handle.width / 2,
        handle.y + handle.height / 2 + (72 * i) / 10,
      );
    await touch("touchEnd");
    await until(
      () => docs["d-" + today].body.entries.find((e) => e.id === "l1").dur === 120,
      "the handle lengthens it",
    );
    assert.equal(docs["d-" + today].body.entries.find((e) => e.id === "l1").c, 4);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---------------- History: the week on a timeline, read-only ----------------
  const monday = add(today, -((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7)),
    past = add(monday, -3), // the Friday before this week
    later = add(monday, 9); // the Wednesday after it
  const historyDocs = () => ({
    ...loggedDay(),
    ["e-1001"]: {
      rev: 1,
      body: {
        when: today + "T07:00",
        symptoms: ["Headache", "Nausea"],
        duration: "1–4 hours",
        before: [],
        notes: "",
      },
    },
    ["e-1002"]: {
      rev: 1,
      body: {
        when: add(today, -1) + "T22:00",
        symptoms: ["Fatigue"],
        duration: "Still going",
        before: [],
        notes: "",
      },
    },
    ["d-" + past]: {
      rev: 1,
      body: {
        date: past,
        status: "amber",
        poorSleep: false,
        entries: [{ id: "h1", a: "Housework", c: 2, t: "10:00", dur: 90 }],
      },
    },
    ["p-" + past]: plan({ id: "h2", a: "Shopping trip", c: 2, t: "14:00", dur: 60 }),
    ["p-" + later]: plan({ id: "h3", a: "Dentist", c: 2, t: "11:00", dur: 60 }),
  });
  {
    const H = "#history-board";
    const { page, context, docs, errors } = await openApp(
      { viewport: { width: 1440, height: 1400 } },
      "history",
      historyDocs(),
    );
    const dates = () =>
      page.locator(`${H} [data-cal-col]`).evaluateAll((cols) => cols.map((c) => c.dataset.date));
    // This week, Monday to Sunday, with today marked and what happened on it.
    assert.deepEqual(
      await dates(),
      Array.from({ length: 7 }, (_, i) => add(monday, i)),
    );
    assert.equal(await page.locator(`${H} .cal-col.is-today .cal-now`).count(), 1);
    // It opens at the day's activities, not at midnight because an episode began the night before.
    assert.equal(
      await page.evaluate(() => {
        const scroller = document
            .querySelector("#history-board .cal-scroll")
            .getBoundingClientRect(),
          logged = document
            .querySelector('#history-board .cal-block[data-id="log:l1"]')
            .getBoundingClientRect();
        return logged.top >= scroller.top && logged.bottom <= scroller.bottom;
      }),
      true,
    );
    assert.equal(await page.locator(`${H} .cal-logged`).count(), 2, "what was logged, solid");
    assert.equal(
      (await page.locator(`${H} .cal-plan`).count()) >= 2,
      true,
      "what is still planned, dashed",
    );
    assert.equal(await page.locator(`${H} .cal-side`).count(), 2, "both episodes");
    assert.match(
      await block(page, "ep:e-1001", H).getAttribute("aria-label"),
      /Headache, Nausea, 07:00–09:30.*approximate/,
    );
    assert.match(
      await block(page, "ep:e-1002", H).getAttribute("aria-label"),
      /Fatigue, 00:00.*began the day before.*still going/,
    );
    // Episodes keep to a strip at the right of the day, clear of the activities.
    const clear = await page.evaluate(() => {
      const col = document.querySelector("#history-board .cal-col.is-today"),
        edge = col.getBoundingClientRect().right,
        side = [...col.querySelectorAll(".cal-side")].map((b) => b.getBoundingClientRect()),
        main = [...col.querySelectorAll(".cal-block:not(.cal-side)")].map((b) =>
          b.getBoundingClientRect(),
        );
      return {
        sideInStrip: side.every((r) => r.left >= edge - 20 && r.right <= edge),
        mainClear: main.every((r) => side.every((q) => r.right <= q.left + 1)),
      };
    });
    assert.deepEqual(clear, { sideInStrip: true, mainClear: true });
    // Read-only: nothing to grab, and a drag or a click on empty space changes nothing.
    assert.equal(
      await page.locator(`${H} .is-editable, ${H} .cal-grip, ${H} .cal-resize`).count(),
      0,
    );
    const rev = docs["d-" + today].rev;
    await block(page, "log:l1", H).scrollIntoViewIfNeeded();
    const b = await box(block(page, "log:l1", H));
    await drag(page, { x: b.x + 30, y: b.y + 10 }, { x: b.x + 30, y: b.y - 40 });
    const col = await box(page.locator(`${H} .cal-col.is-today`));
    await page.mouse.click(col.x + col.width / 3, b.y + b.height + 30);
    await page.waitForTimeout(300);
    assert.equal(docs["d-" + today].rev, rev, "nothing was saved");
    assert.equal(await page.locator("#history-panel").isVisible(), true, "and nothing opened");

    // Selecting a block opens it where it can be changed.
    await block(page, "log:l1", H).click();
    assert.equal(await page.locator("#today-panel").isVisible(), true);
    await page.locator("#t-history").click();
    await block(page, "plan:p1", H).scrollIntoViewIfNeeded();
    await block(page, "plan:p1", H).click();
    assert.equal(await page.locator("#plan-panel").isVisible(), true);
    assert.equal(
      await page.locator(`#plan-board .cal-day-head.is-selected`).getAttribute("data-cal-day"),
      today,
    );
    await page.locator("#t-history").click();
    await block(page, "ep:e-1001", H).scrollIntoViewIfNeeded();
    await block(page, "ep:e-1001", H).click();
    assert.equal(await page.locator("#episode-panel").isVisible(), true);
    assert.equal(await page.locator("#ep-when").inputValue(), today + "T07:00");
    await page.locator("#t-history").click();

    // Last week: what was logged, and what was planned and not done says so.
    await page.locator("[data-week-prev]").click();
    assert.deepEqual((await dates())[0], add(monday, -7));
    assert.equal(await page.locator(`${H} .cal-now`).count(), 0);
    assert.equal(await page.locator(`${H} .cal-logged`).count(), 1);
    assert.match(
      await block(page, "log:h1", H).getAttribute("aria-label"),
      /Housework, 10:00–11:30/,
    );
    assert.match(await block(page, "plan:h2", H).getAttribute("aria-label"), /planned, not logged/);
    assert.equal(await page.locator("[data-week-today]").isEnabled(), true);
    // Next week: a plan that has not happened yet carries no such note.
    await page.locator("[data-week-today]").click();
    assert.equal(await page.locator("[data-week-today]").isEnabled(), false);
    await page.locator("[data-week-next]").click();
    assert.deepEqual((await dates())[0], add(monday, 7));
    assert.doesNotMatch(await block(page, "plan:h3", H).getAttribute("aria-label"), /not logged/);
    // The month overview drills into a week: pick a day there, then "See in the week view".
    await page.locator("[data-week-today]").click();
    await page.locator(`[data-matrix-grid] [data-date="${past}"]`).click();
    await page.locator("[data-matrix-week]").click();
    assert.equal((await dates())[0], add(monday, -7));
    assert.equal(await page.evaluate(() => document.activeElement?.id), "week-title");
    assert.equal(
      await page
        .locator(`${H} .cal-col.is-selected, ${H} .cal-day-head.is-selected`)
        .getAttribute("data-cal-day"),
      past,
    );
    const cell = await box(page.locator(".matrix-cell").first());
    assert.ok(
      cell.width >= 40 && cell.height >= 40,
      `month cells use the panel (${cell.width}x${cell.height})`,
    );
    await page.locator("[data-week-today]").click();
    await page.locator("[data-week-next]").click();
    // A week with nothing in it says so.
    for (let i = 0; i < 3; i++) await page.locator("[data-week-next]").click();
    assert.equal(await page.locator("[data-week-empty]").isVisible(), true);
    assert.equal(await page.locator(`${H} .cal-block`).count(), 0);
    assert.deepEqual(errors, []);
    await context.close();
  }

  // ---------------- History on a phone: one day ----------------
  {
    const H = "#history-board";
    const { page, context, errors } = await openApp(
      { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true },
      "history",
      historyDocs(),
    );
    assert.equal(await page.locator(`${H} [data-cal-col]`).count(), 1);
    assert.equal(await page.locator(`${H} .cal-col.has-side`).count(), 1);
    const cell = await box(page.locator(".matrix-cell").first());
    assert.ok(
      cell.width >= 44 && cell.height >= 44,
      `month cells are touch-sized (${cell.width}x${cell.height})`,
    );
    assert.equal(await page.locator("[data-week-prev]").getAttribute("aria-label"), "Previous day");
    assert.equal(
      await page
        .locator(`${H} .cal-day-head`)
        .textContent()
        .then((t) => t.includes("Today")),
      true,
    );
    await page.locator("[data-week-prev]").click();
    assert.equal(
      await page.locator(`${H} [data-cal-col]`).getAttribute("data-date"),
      add(today, -1),
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    assert.deepEqual(errors, []);
    await context.close();
  }
});
