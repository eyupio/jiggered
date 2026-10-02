// Compile once for the suite; each scenario still owns an isolated server/database.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jiggered-browser-suite-"));
try {
  const binary = process.env.JIGGERED_TEST_BINARY
    ? path.resolve(root, process.env.JIGGERED_TEST_BINARY)
    : path.join(dir, "jiggered");
  if (!process.env.JIGGERED_TEST_BINARY)
    execFileSync(process.env.GO_BINARY || "go", ["build", "-o", binary, "."], {
      cwd: root,
      stdio: "inherit",
    });
  for (const script of [
    "browser-today",
    "browser-history",
    "browser-mobile",
    "browser-security",
    "browser-accounts",
    "browser-admin",
    "browser",
  ]) {
    execFileSync(process.execPath, [path.join(root, "test", script + ".cjs")], {
      cwd: root,
      env: { ...process.env, JIGGERED_TEST_BINARY: binary },
      stdio: "inherit",
    });
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
