const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jiggered-public-"));
const binary = process.env.JIGGERED_TEST_BINARY || path.join(dir, "jiggered");
if (!process.env.JIGGERED_TEST_BINARY)
  execFileSync(process.env.GO_BINARY || "go", ["build", "-o", binary, "."]);
const port = process.env.JIGGERED_TEST_PORT || "18796";
const base = "http://127.0.0.1:" + port;
const server = spawn(binary, [], {
  env: {
    ...process.env,
    APP_DB: path.join(dir, "jiggered.db"),
    APP_ADDR: "127.0.0.1:" + port,
    APP_PUBLIC_ORIGIN: base,
    APP_PUBLIC_INDEXING: "true",
    APP_PASSWORD: "",
    APP_PASSWORD_HASH: "",
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let diagnostics = "";
server.stderr.on("data", (chunk) => (diagnostics += chunk.toString()));
process.on("exit", () => server.kill());

(async () => {
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + "/healthz")).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "server did not start: " + diagnostics);
    const sitemap = await (await fetch(base + "/sitemap.xml")).text();
    const routes = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => new URL(match[1]).pathname,
    );
    assert.equal(routes.length, 9);
    browser = await chromium.launch({
      headless: true,
      ...(process.env.JIGGERED_BROWSER_PATH
        ? { executablePath: process.env.JIGGERED_BROWSER_PATH }
        : {}),
      args: JSON.parse(process.env.JIGGERED_BROWSER_ARGS || "[]"),
    });
    const summaries = [];
    for (const javaScriptEnabled of [false, true]) {
      for (const width of [1440, 390, 320]) {
        const context = await browser.newContext({
          javaScriptEnabled,
          viewport: { width, height: 900 },
        });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("console", (msg) => {
          if (msg.type() === "error") errors.push(msg.text());
        });
        for (const route of routes) {
          const response = await page.goto(base + route);
          await page.locator("h1").waitFor();
          if (javaScriptEnabled) await page.evaluate(() => document.fonts.ready);
          assert.equal(response.status(), 200, route);
          assert.equal(response.headers()["x-robots-tag"], "index, follow");
          assert.equal(await page.locator("h1").count(), 1, route);
          assert.equal(
            await page.locator("link[rel=canonical]").getAttribute("href"),
            base + route,
          );
          assert.equal(await page.locator("meta[name=description]").count(), 1);
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
            false,
            `${route} overflows at ${width}px`,
          );
          assert.ok(
            (await page.locator("main").innerText()).length > 700,
            route + " lacks useful initial content",
          );
          assert.ok(await page.locator(".public-nav").isVisible(), "mobile navigation hidden");
          for (const href of await page
            .locator("a[href]")
            .evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
            if (href.startsWith("/"))
              assert.ok(
                routes.includes(href) || ["/login", "/register"].includes(href),
                "unknown internal link: " + href,
              );
          }
          assert.ok(await page.locator('.nav-actions .secondary[href="/login"]').isVisible());
          assert.equal(
            await page.locator('.public-footer a[href="https://eyup.io"]').innerText(),
            "EyUp.io",
          );
          if (route === "/welcome") {
            assert.match(await page.locator(".hero-availability").innerText(), /currently closed/);
            assert.equal(
              await page.locator(".hero-actions [data-register-link]").getAttribute("href"),
              "/login",
            );
          }
          if (route === "/guides/spoon-theory")
            assert.ok(
              await page
                .getByRole("link", { name: /Christine Miserandino's original Spoon Theory essay/ })
                .count(),
            );
          if (
            process.env.JIGGERED_SCREENSHOT_DIR &&
            ["/welcome", "/guides/spoon-theory"].includes(route)
          ) {
            fs.mkdirSync(process.env.JIGGERED_SCREENSHOT_DIR, { recursive: true });
            await page.screenshot({
              path: path.join(
                process.env.JIGGERED_SCREENSHOT_DIR,
                `${route.slice(1).replaceAll("/", "-")}-${width}-${javaScriptEnabled}.png`,
              ),
              fullPage: true,
            });
          }
          summaries.push({ route, width, javaScriptEnabled });
        }
        assert.deepEqual(errors, [], "public page script/resource/CSP errors");
        await context.close();
      }
    }
    // The public pages and the sign-in page follow the visitor's light or dark setting, and print stays light.
    const luminance = (rgb) => {
      const [r, g, b] = rgb
        .match(/\d+(\.\d+)?/g)
        .slice(0, 3)
        .map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    };
    for (const scheme of ["light", "dark"]) {
      const themed = await browser.newContext({
        colorScheme: scheme,
        viewport: { width: 375, height: 800 },
      });
      const themedPage = await themed.newPage();
      for (const route of ["/welcome", "/features/energy-tracking", "/login"]) {
        await themedPage.goto(base + route);
        const { back, ink } = await themedPage.evaluate(() => ({
          back: getComputedStyle(document.body).backgroundColor,
          ink: getComputedStyle(document.querySelector("h1")).color,
        }));
        assert.equal(luminance(back) < 0.4, scheme === "dark", `${route} background in ${scheme}`);
        assert.ok(
          Math.abs(luminance(back) - luminance(ink)) > 0.5,
          `${route} text is readable in ${scheme}`,
        );
        if (route !== "/login") {
          // One compact header on a phone: the logo row and one row of links.
          const header = await themedPage.locator("header.site-header").boundingBox();
          assert.ok(header.height <= 130, `${route} header is ${header.height}px tall`);
        }
        if (scheme === "dark") {
          await themedPage.emulateMedia({ media: "print" });
          const printed = await themedPage.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
          );
          assert.ok(luminance(printed) > 0.9, `${route} prints on a light page`);
          await themedPage.emulateMedia({ media: "screen" });
        }
      }
      await themed.close();
    }
    // Browser enhancement must track changes in availability in either direction.
    const context = await browser.newContext({ viewport: { width: 320, height: 900 } });
    const page = await context.newPage();
    await page.route("**/api/auth/options", (route) =>
      route.fulfill({
        contentType: "application/json",
        body: '{"registration":true,"recovery":false}',
      }),
    );
    await page.goto(base + "/welcome");
    await page
      .locator("#registration-status")
      .filter({ hasText: "OPEN FOR REGISTRATION" })
      .waitFor();
    assert.equal(
      await page.locator(".hero-actions [data-register-link]").getAttribute("href"),
      "/register",
    );
    assert.match(await page.locator(".hero-availability").innerText(), /confirm your address/);
    assert.ok(await page.locator('.nav-actions .secondary[href="/login"]').isVisible());
    assert.ok(await page.locator('.nav-actions a[href="/register"]').isVisible());
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.match(
      await (await fetch(base + "/welcome")).text(),
      /REGISTRATION CLOSED/,
      "mock must not alter server source",
    );
    await context.close();
    console.log(
      `PASS: ${summaries.length} public-page checks with JavaScript on/off, metadata, privacy headers, links, mobile layout and signup enhancement.`,
    );
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
