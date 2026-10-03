import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// The browser runner lists its scenarios by hand: a new test/browser-*.cjs that is forgotten there silently
// never runs, and nothing else fails. browser-public.cjs is the one deliberate exception (CI runs it on its own
// against the same fixture, outside the private-app scenarios).
test("every browser scenario is listed in the runner", () => {
  const runner = readFileSync(path.join(import.meta.dirname, "support", "run-browser.cjs"), "utf8");
  const listed = [...runner.matchAll(/"(browser-[a-z-]+)"/g)].map((m) => m[1]).sort();
  const onDisk = readdirSync(import.meta.dirname)
    .filter((f) => /^browser-.*\.cjs$/.test(f) && f !== "browser-public.cjs")
    .map((f) => f.replace(/\.cjs$/, ""))
    .sort();
  assert.ok(onDisk.length > 0, "no browser scenarios found");
  assert.deepEqual(
    listed,
    onDisk,
    "test/support/run-browser.cjs and the test/browser-*.cjs files disagree; keep the scenario list in step",
  );
});
