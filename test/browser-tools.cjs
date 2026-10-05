// Real-browser check of the Tools tab and Fretboard: open the tool, add a card by double-clicking and typing, drag
// it across the midline with a real mouse, use the right-click menu for its status and today's three, undo, marquee
// select several cards, and come back after a reload to the same board (it is a document, saved like any other).
// Needs Playwright (see the README); run with `node test/browser-tools.cjs`.
const assert = require("node:assert/strict");
const { runBrowser } = require("./support/browser.cjs");
const saved = (page) =>
  page.waitForFunction(() => document.querySelector("#sync")?.dataset.state === "saved");
const cardBox = async (page, text) => page.locator(".fb-item", { hasText: text }).boundingBox();

runBrowser({ name: "tools", portEnv: "JIGGERED_TOOLS_PORT" }, async (harness) => {
  const { base } = harness;
  const browser = await harness.launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1500 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(base + "/login");
  await page.locator("#username").fill("tester");
  await page.locator("#password").fill("local-preview-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator("#acts details.act-group").first().waitFor();
  await saved(page);

  // The Tools tab lists Fretboard; opening it shows an empty board with its hint.
  await page.getByRole("tab", { name: "Tools" }).click();
  await page.locator('#tool-grid [data-tool="fretboard"]').click();
  await page.locator("#fb-canvas").waitFor();
  assert.ok(await page.locator("#fb-empty").isVisible(), "an empty board explains itself");
  assert.match(await page.locator("#tool-title").textContent(), /Fretboard/);
  await harness.screenshot(page, "tools-empty.png");

  // Double-click adds a card where the mouse is and starts typing straight away.
  await page.locator("#fb-canvas").scrollIntoViewIfNeeded();
  const canvas = await page.locator("#fb-canvas").boundingBox();
  await page.mouse.dblclick(canvas.x + canvas.width * 0.2, canvas.y + canvas.height * 0.3);
  await page.locator("textarea.fb-edit").waitFor();
  await page.keyboard.type("Sleep");
  await page.keyboard.press("Enter");
  await saved(page);
  const sleep = page.locator(".fb-item", { hasText: "Sleep" });
  await sleep.waitFor();
  assert.equal(await page.locator("#fb-empty").isVisible(), false);
  assert.match(await sleep.getAttribute("aria-label"), /Out of your hands, matters most/);

  // A card left empty is not kept.
  await page.mouse.dblclick(canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.7);
  await page.locator("textarea.fb-edit").waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".fb-item").length === 1);

  // Dragging with a real mouse moves it across the midline, and the saved position follows.
  let box = await cardBox(page, "Sleep");
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 20 + canvas.width * 0.5, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await saved(page);
  box = await cardBox(page, "Sleep");
  assert.ok(box.x > canvas.x + canvas.width * 0.5, "the card is now right of the midline");
  assert.match(await sleep.getAttribute("aria-label"), /In your hands, matters most/);
  const stored = await page.evaluate(async () => {
    const r = await fetch("/api/docs", { credentials: "same-origin" });
    return (await r.json())["t-fretboard"]?.body;
  });
  const [, item] = Object.entries(stored.items)[0];
  assert.ok(item.x > 0.5 && item.t === "Sleep", "the server copy holds the moved card");

  // Right-click: status from the menu, then add it to today's three.
  await sleep.click({ button: "right" });
  await page.locator("#fb-menu").waitFor();
  await page.locator("#fb-menu button", { hasText: "In progress" }).click();
  await saved(page);
  assert.ok(await sleep.evaluate((el) => el.classList.contains("fb-s-doing")));
  await sleep.click({ button: "right" });
  await page.locator("#fb-menu button", { hasText: "Add to today's three" }).click();
  await saved(page);
  assert.equal(await page.locator("#fb-three li").count(), 1);
  assert.match(await page.locator("#fb-three li").textContent(), /Sleep/);
  await page.locator("#fb-three li input[type=checkbox]").check();
  await saved(page);
  assert.ok(await page.locator("#fb-three li.is-done").count(), "a ticked thing shows as done");

  // A typed thing joins the list and gets its own card in the top right; typing it again reuses that card.
  await page.locator("#fb-three-input").fill("Ten minutes outside");
  await page.locator("#fb-three-form button").click();
  await saved(page);
  assert.equal(await page.locator("#fb-three li").count(), 2);
  const outside = page.locator(".fb-item", { hasText: "Ten minutes outside" });
  assert.equal(await outside.count(), 1, "the typed thing is placed on the board");
  assert.match(await outside.getAttribute("aria-label"), /In your hands, matters most/);
  assert.equal(await page.locator("#fb-three [data-three-card]").count(), 2);
  await page.locator("#fb-three-input").fill("ten minutes outside");
  await page.locator("#fb-three-form button").click();
  await saved(page);
  assert.equal(await outside.count(), 1, "no second card for the same words");
  await page.locator("#fb-three li").nth(2).locator("[data-three-remove]").click();
  await saved(page);
  assert.equal(await page.locator("#fb-three li").count(), 2);

  // Choosing a status again clears it: "Not my problem" is a toggle, from the menu and from the keyboard.
  await sleep.click({ button: "right" });
  await page.locator("#fb-menu button", { hasText: "Not my problem" }).click();
  await saved(page);
  assert.ok(await sleep.evaluate((el) => el.classList.contains("fb-s-external")));
  await sleep.click({ button: "right" });
  assert.match(
    await page.locator("#fb-menu button", { hasText: "Not my problem" }).textContent(),
    /✓/,
  );
  await page.locator("#fb-menu button", { hasText: "Not my problem" }).click();
  await saved(page);
  assert.ok(
    await sleep.evaluate((el) => el.classList.contains("fb-s-todo")),
    "chosen again, it clears",
  );
  await sleep.click();
  await page.keyboard.press("4");
  await saved(page);
  assert.ok(await sleep.evaluate((el) => el.classList.contains("fb-s-external")));
  await page.keyboard.press("4");
  await saved(page);
  assert.ok(await sleep.evaluate((el) => el.classList.contains("fb-s-todo")), "4 again clears it");

  // The keyboard sets status and deletes, and Undo brings the card back.
  await sleep.click();
  await page.keyboard.press("3");
  await saved(page);
  assert.ok(await sleep.evaluate((el) => el.classList.contains("fb-s-done")));
  await page.keyboard.press("Delete");
  await saved(page);
  assert.equal(await page.locator(".fb-item").count(), 1);
  await page.locator("#toastbar button", { hasText: "Undo" }).click();
  await saved(page);
  assert.equal(await page.locator(".fb-item").count(), 2, "Undo restores the deleted card");

  // Toolbar buttons add more; a marquee over empty space selects everything it touches and arrows nudge them together.
  for (const name of ["Decking", "Weight"]) {
    await page.locator('[data-fb="add-card"]').click();
    await page.locator("textarea.fb-edit").waitFor();
    await page.keyboard.type(name);
    await page.keyboard.press("Enter");
    await saved(page);
  }
  assert.equal(await page.locator(".fb-item").count(), 4);
  await page.mouse.move(canvas.x + 4, canvas.y + 4);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width - 4, canvas.y + canvas.height - 4, { steps: 8 });
  await page.mouse.up();
  assert.equal(
    await page.locator(".fb-item.is-selected").count(),
    4,
    "the marquee selected every card",
  );
  const before = await page.locator(".fb-item").evaluateAll((els) => els.map((e) => e.offsetTop));
  await page.keyboard.press("Shift+ArrowDown");
  await saved(page);
  const after = await page.locator(".fb-item").evaluateAll((els) => els.map((e) => e.offsetTop));
  assert.ok(
    after.every((t, i) => t > before[i]),
    "every selected card moved down together",
  );
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".fb-item.is-selected").count(), 0);

  // Renaming an axis end is an inline edit; the legend hides a status without deleting anything.
  await page.locator('[data-axis="right"]').click();
  await page.locator(".fb-axis-input").fill("Controlled");
  await page.keyboard.press("Enter");
  await saved(page);
  assert.equal(await page.locator('[data-axis="right"]').textContent(), "Controlled");
  await page.locator('#fb-legend [data-status="todo"]').click();
  assert.equal(await page.locator(".fb-item.is-dimmed").count(), 3);
  await page.locator('#fb-legend [data-status="todo"]').click();
  await harness.screenshot(page, "tools-board.png");

  // After a reload the same board, three things and tool come back.
  await page.reload();
  await page.locator("#fb-canvas").waitFor();
  await saved(page);
  assert.equal(await page.locator(".fb-item").count(), 4);
  assert.equal(await page.locator("#fb-three li").count(), 2);
  assert.equal(await page.locator('[data-axis="right"]').textContent(), "Controlled");
  assert.match(await page.locator("#fb-summary").textContent(), /4 cards/);

  // Back to the launcher, and the phone layout stacks the tray under the board.
  await page.locator("#tool-back").click();
  assert.ok(await page.locator("#tool-launcher").isVisible());
  await page.setViewportSize({ width: 390, height: 900 });
  await page.locator('#tool-grid [data-tool="fretboard"]').click();
  await page.locator("#fb-canvas").waitFor();
  const tray = await page.locator(".fb-tray").boundingBox();
  const board = await page.locator("#fb-canvas").boundingBox();
  assert.ok(tray.y > board.y + board.height - 1, "the tray sits under the board on a phone");
  assert.ok(board.width <= 390, "the board fits a phone");
  await harness.screenshot(page, "tools-phone.png");

  assert.deepEqual(errors, [], "no page errors");
  await browser.close();
  console.log("browser-tools: ok");
});
