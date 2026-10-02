// Lifecycle shared by the real-browser scenarios; all data is disposable.
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "../..");

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForHealth(base, server, getError, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getError()) throw getError();
    if (server.exitCode !== null || server.signalCode !== null) {
      throw new Error(
        `Server exited before becoming healthy (${server.exitCode ?? server.signalCode})`,
      );
    }
    try {
      const response = await fetch(base + "/healthz", { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.ok) return;
    } catch {
      /* a live process may still be initializing */
    }
    await delay(100);
  }
  throw new Error(`Server did not become healthy at ${base} within ${timeoutMs}ms`);
}

async function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timer);
  }
}

async function runBrowser(
  { name, username = "tester", password = "local-preview-password", portEnv, startServer = true },
  scenario,
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `jiggered-${name}-`));
  const browsers = new Set(),
    disposers = [];
  let server,
    logs = "",
    startupError,
    cleaned = false;
  const onExit = () => server?.kill("SIGKILL");
  const artifactDir = process.env.JIGGERED_ARTIFACT_DIR
    ? path.resolve(process.env.JIGGERED_ARTIFACT_DIR, name)
    : null;

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;
    process.removeListener("exit", onExit);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    // Attempt every cleanup even if one resource's disposal fails.
    const results = await Promise.allSettled([
      ...[...browsers].map((browser) => browser.close()),
      ...disposers.map((dispose) => Promise.resolve().then(dispose)),
      stopProcess(server),
    ]);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const result of results)
      if (result.status === "rejected") console.error("Browser cleanup:", result.reason);
  }
  const onInterrupt = () => {
    cleanup().finally(() => process.exit(130));
  };
  const onTerminate = () => {
    cleanup().finally(() => process.exit(143));
  };

  try {
    process.once("exit", onExit);
    process.once("SIGINT", onInterrupt);
    process.once("SIGTERM", onTerminate);
    let base;
    if (startServer) {
      const binary = process.env.JIGGERED_TEST_BINARY
        ? path.resolve(root, process.env.JIGGERED_TEST_BINARY)
        : path.join(dir, "jiggered");
      if (!process.env.JIGGERED_TEST_BINARY) {
        execFileSync(process.env.GO_BINARY || "go", ["build", "-o", binary, "."], {
          cwd: root,
          stdio: "inherit",
        });
      }
      const selectedPort =
        (portEnv && process.env[portEnv]) || process.env.JIGGERED_TEST_PORT || (await freePort());
      base = `http://127.0.0.1:${selectedPort}`;
      server = spawn(binary, [], {
        cwd: root,
        env: {
          ...process.env,
          APP_ADDR: new URL(base).host,
          APP_DB: path.join(dir, "test.db"),
          APP_USERNAME: username,
          APP_PASSWORD: password,
          APP_PASSWORD_HASH: "",
          APP_SECURE_COOKIE: "false",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.on("error", (error) => {
        startupError = error;
      });
      for (const stream of [server.stdout, server.stderr])
        stream.on("data", (chunk) => {
          logs = (logs + chunk).slice(-100000);
        });
      await waitForHealth(base, server, () => startupError);
    }

    await scenario({
      base,
      async launchBrowser() {
        const browser = await chromium.launch({
          headless: true,
          ...(process.env.JIGGERED_BROWSER_PATH
            ? { executablePath: process.env.JIGGERED_BROWSER_PATH }
            : {}),
          args: JSON.parse(process.env.JIGGERED_BROWSER_ARGS || "[]"),
        });
        browsers.add(browser);
        return browser;
      },
      trackServer(listener) {
        const sockets = new Set();
        listener.on("connection", (socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
        });
        disposers.push(
          () =>
            new Promise((resolve) => {
              for (const socket of sockets) socket.destroy();
              if (listener.listening) listener.close(resolve);
              else resolve();
            }),
        );
        return listener;
      },
      async screenshot(page, filename) {
        if (!process.env.JIGGERED_SCREENSHOT_DIR) return;
        fs.mkdirSync(process.env.JIGGERED_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({
          path: path.join(process.env.JIGGERED_SCREENSHOT_DIR, filename),
          fullPage: true,
        });
      },
    });
  } catch (error) {
    if (logs) console.error(`[${name}] server output:\n${logs}`);
    if (artifactDir) {
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.writeFileSync(path.join(artifactDir, "server.log"), logs);
      let index = 0;
      for (const browser of browsers)
        for (const context of browser.contexts())
          for (const page of context.pages()) {
            try {
              await page.screenshot({
                path: path.join(artifactDir, `failure-${index++}.png`),
                timeout: 3000,
              });
            } catch {
              /* a failed or closed page must not hide the scenario error */
            }
          }
    }
    throw error;
  } finally {
    await cleanup();
  }
}

module.exports = { runBrowser, waitForHealth };
