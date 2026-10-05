// Real-browser check of History search on a large account: typing a word updates the view once (after a short pause),
// says so while it waits, ends with the right results, and the other filters still react at once.
// Needs Playwright (see the README); run with `node test/browser-history.cjs`. It builds a temporary binary and database.
const assert = require("node:assert/strict");
const { runBrowser } = require("./support/browser.cjs");
const DAYS = 600; // every day has a check-in; even-numbered days also log "Walk"
const EPISODES = 900;

runBrowser({ name: "history", portEnv: "JIGGERED_HISTORY_PORT" }, async (harness) => {
  const browser = await harness.launchBrowser();
  const { base } = harness;
  const page = await (
    await browser.newContext({ viewport: { width: 1100, height: 900 } })
  ).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base + "/login");
  await page.locator("#username").fill("tester");
  await page.locator("#password").fill("local-preview-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("#t-history").waitFor();

  // Seed through the real API, then reload so the page loads the whole account as a snapshot.
  const seeded = await page.evaluate(
    async ([days, episodes]) => {
      const headers = {
        "Content-Type": "application/json",
        "X-Requested-With": "jiggered",
        "If-None-Match": "*",
      };
      const jobs = [];
      for (let i = 0; i < days; i++) {
        const date = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
        jobs.push([
          "d-" + date,
          {
            date,
            status: ["green", "amber", "red"][i % 3],
            poorSleep: i % 4 === 0,
            entries:
              i % 2 === 0
                ? [
                    { id: "w" + i, a: "Walk", c: -2, t: "09:00" },
                    { id: "k" + i, a: "Work", c: 3, t: "11:00" },
                  ]
                : [{ id: "k" + i, a: "Work", c: 3, t: "11:00" }],
          },
        ]);
      }
      for (let i = 0; i < episodes; i++) {
        const date = new Date(Date.UTC(2024, 0, 1) + (i % days) * 86400000)
          .toISOString()
          .slice(0, 10);
        jobs.push([
          "e-" + (1700000000000 + i * 1000),
          {
            when: date + "T09:00",
            symptoms: ["Headache"],
            before: ["Poor sleep"],
            notes: "n".repeat(1500),
          },
        ]);
      }
      const assertSeed = (status, id) => {
        if (status !== 200) throw new Error(`Seed ${id} failed: HTTP ${status}`);
      };
      let ok = 0;
      for (let i = 0; i < jobs.length; i += 25) {
        const results = await Promise.all(
          jobs.slice(i, i + 25).map(async ([id, body]) => {
            const response = await fetch("/api/docs/" + id, {
              method: "PUT",
              headers,
              body: JSON.stringify(body),
            });
            await response.arrayBuffer();
            assertSeed(response.status, id);
            return response.status;
          }),
        );
        ok += results.filter((status) => status === 200).length;
      }
      return ok;
    },
    [DAYS, EPISODES],
  );
  assert.equal(seeded, DAYS + EPISODES, "every seeded document was accepted");
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");

  await page.locator("#t-history").click();
  await page.setViewportSize({ width: 390, height: 900 });
  for (const range of [7, 30, 90, 180, 365]) {
    await page.locator("#history-range").selectOption(String(range));
    for (const mode of ["checkin", "used", "points", "sleep", "episodes"]) {
      await page.locator("[data-matrix-mode]").selectOption(mode);
      assert.equal(
        await page.locator("[data-matrix-grid] button").count(),
        range,
        "the whole chosen range is visible on mobile",
      );
      const sizes = await page.locator(".matrix-calendar").evaluate((el) => ({
        width: el.getBoundingClientRect().width,
        parent: el.closest(".matrix-overview").getBoundingClientRect().width,
        slots: el.querySelector("[data-matrix-grid]").children.length,
      }));
      assert.ok(sizes.width <= sizes.parent + 1, "calendar stays within its panel");
      assert.equal(sizes.slots % 7, 0, "both partial weeks have complete rows");
    }
  }
  await page.setViewportSize({ width: 1100, height: 900 });
  // On a desktop the days fill their card, whatever the period, rather than a small grid in a wide panel; the card
  // sits level with the selected day beside it; and a closed section is only its heading.
  for (const [range, layout] of [
    [7, "list"],
    [30, "calendar"],
    [90, "heatmap"],
    [180, "heatmap"],
    [365, "heatmap"],
  ]) {
    await page.locator("#history-range").selectOption(String(range));
    const fit = await page.evaluate(() => {
      const card = document.querySelector(".matrix-overview").getBoundingClientRect(),
        reading = document.querySelector(".matrix-reading").getBoundingClientRect(),
        grid = document.querySelector("[data-matrix-grid]").getBoundingClientRect();
      return {
        layout: document.querySelector("[data-matrix-calendar]").dataset.layout,
        share: grid.width / card.width,
        height: Math.abs(card.height - reading.height),
        top: Math.abs(card.top - reading.top),
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.equal(fit.layout, layout, `${range} days are laid out as a ${layout}`);
    assert.ok(fit.share > 0.8, `${range} days fill their card (${Math.round(fit.share * 100)}%)`);
    assert.ok(
      fit.height <= 1 && fit.top <= 1,
      `the calendar and the day are level at ${range} days`,
    );
    assert.ok(fit.overflow <= 0, `no sideways scrolling at ${range} days`);
  }
  assert.ok(
    (await page.locator("#history-share").boundingBox()).height < 70,
    "a closed section is only its heading",
  );
  // Arrow keys follow what is on screen: down a list, along a calendar's row, down a heatmap's column.
  for (const [range, keys] of [
    [7, { ArrowDown: 1, ArrowUp: -1 }],
    [30, { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }],
    [90, { ArrowDown: 1, ArrowUp: -1, ArrowRight: 7, ArrowLeft: -7 }],
  ]) {
    await page.locator("#history-range").selectOption(String(range));
    const middle = page.locator(`[data-matrix-grid] [data-cell="${Math.floor(range / 2)}"]`);
    for (const [key, step] of Object.entries(keys)) {
      await middle.click();
      await middle.press(key);
      assert.equal(
        await page.evaluate(() => Number(document.activeElement.dataset.cell)),
        Math.floor(range / 2) + step,
        `${key} moves ${step} in the ${range}-day view`,
      );
    }
  }
  await page.locator("#history-range").selectOption("all");
  await page.locator("#history-explore > summary").click();
  await page.waitForFunction(
    ([d, e]) =>
      new RegExp(`${d} days? and ${e} episodes?`).test(
        document.getElementById("history-count").textContent,
      ),
    [DAYS, EPISODES],
  );

  assert.equal(await page.locator('[data-chart="combined"] svg').count(), 1);
  assert.match(
    await page.locator(".energy-report").textContent(),
    /1800 points used before recovery.*600 recovered.*1200 net/,
  );
  await page.locator("#chart-combined-select").selectOption("0");
  assert.match(
    await page.locator('[data-chart="combined"] [data-detail]').textContent(),
    /Used points 3/,
  );
  for (const width of [800, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    for (const selector of [
      ".label-row",
      ".history-chart",
      ".chart-legend",
      ".chart-inspector",
      ".chart-data",
    ]) {
      const positions = await page.evaluate(
        (selector) =>
          ["energy", "episodes"].map(
            (kind) =>
              document.querySelector(`[data-chart="${kind}"] ${selector}`).getBoundingClientRect()
                .top,
          ),
        selector,
      );
      assert.ok(Math.abs(positions[0] - positions[1]) < 1, `${selector} aligns at ${width}px`);
    }
  }
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('[data-chart="combined"] .chart-data').evaluate((el) => {
      el.open = true;
    });
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `no horizontal overflow at ${width}px`,
    );
  }
  await page.setViewportSize({ width: 800, height: 900 });
  await page.locator('[data-chart="combined"] .chart-data').evaluate((el) => {
    el.open = false;
  });
  if (process.env.JIGGERED_HISTORY_SCREENSHOT)
    await page
      .locator("#history-graphs")
      .screenshot({ path: process.env.JIGGERED_HISTORY_SCREENSHOT });
  await page.setViewportSize({ width: 1100, height: 900 });

  // One word, typed quickly, is one update: count how many times the charts are rebuilt while it is typed.
  await page.evaluate(() => {
    window.__rebuilds = 0;
    new MutationObserver(() => {
      window.__rebuilds++;
    }).observe(document.getElementById("history-charts"), { childList: true });
  });
  await page.evaluate(() => {
    document.getElementById("history-filter-panel").open = true;
  });
  await page.locator("#hist-query").click();
  await page.keyboard.type("walk", { delay: 40 });
  assert.equal(
    (await page.locator("#history-count").textContent()).trim(),
    "Updating…",
    "it says it is working while it waits for a pause",
  );
  const expectedDays = Math.ceil(DAYS / 2);
  await page.waitForFunction(
    (n) =>
      new RegExp(`^${n} days? and 0 episodes?`).test(
        document.getElementById("history-count").textContent.trim(),
      ),
    expectedDays,
  );
  const rebuilds = await page.evaluate(() => window.__rebuilds);
  assert.ok(
    rebuilds >= 1 && rebuilds <= 2,
    `typing "walk" rebuilt the charts ${rebuilds} times; once (at most twice for the markup swap) is expected, not once per letter`,
  );
  assert.equal((await page.locator("#days li").count()) > 0, true, "matching days are listed");
  assert.match(await page.locator("#days").first().textContent(), /\d/, "the list shows days");

  // Enter does not wait for the pause.
  await page.locator("#hist-query").fill("");
  await page.waitForFunction(
    ([d, e]) =>
      new RegExp(`^${d} days? and ${e} episodes?`).test(
        document.getElementById("history-count").textContent.trim(),
      ),
    [DAYS, EPISODES],
  );
  await page.locator("#hist-query").pressSequentially("headache");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    (n) =>
      new RegExp(`^0 days and ${n} episodes?`).test(
        document.getElementById("history-count").textContent.trim(),
      ),
    EPISODES,
  );

  // Other filters react at once, and the search still applies on top of them.
  await page.locator("#hist-query").fill("");
  await page.waitForFunction(
    ([d, e]) =>
      new RegExp(`^${d} days? and ${e} episodes?`).test(
        document.getElementById("history-count").textContent.trim(),
      ),
    [DAYS, EPISODES],
  );
  // Changing the select and reading the count in the same tick: only a synchronous update can have changed it.
  const right = await page.evaluate(() => {
    const select = document.getElementById("hist-status");
    select.value = "red";
    select.dispatchEvent(new Event("input", { bubbles: true }));
    return document.getElementById("history-count").textContent.trim();
  });
  assert.match(
    right,
    new RegExp(`^${Math.floor(DAYS / 3)} days? and`),
    "a select changes the view at once, without the search pause",
  );

  assert.deepEqual(errors, []);
  console.log(
    `PASS: History search on ${DAYS} days and ${EPISODES} episodes: one update per typed word with "Updating…" shown, correct results, Enter and selects immediate`,
  );
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
