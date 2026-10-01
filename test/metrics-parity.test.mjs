import test from "node:test";
import assert from "node:assert/strict";
import { historyInsights } from "../web/history-model.js";
import { DEFAULTS, summary } from "../web/model.js";

test("summary and history agree on the average over days with activities", () => {
  const docs = {
    "d-2026-09-30": { status: "green", entries: [], budget: 10 },
    "d-2026-10-01": { status: "amber", entries: [{ a: "Work", c: 10 }], budget: 10 },
  };
  const today = "2026-10-01";
  const s = summary(docs, DEFAULTS, "30", today);
  const h = historyInsights(docs, DEFAULTS, today, { from: "2026-09-30" });
  assert.equal(s.avgUsed, 10);
  assert.equal(h.metrics.avgUsed, 10);
  assert.equal(s.activityDays, h.metrics.logged);
});

test("check-in-only, recovery-only and empty ranges use the same rule in both views", () => {
  const docs = { "d-2026-10-01": { status: "red", entries: [{ a: "Rest", c: -4 }], budget: 10 }, "d-2026-09-30": { status: "green", entries: [], budget: 10 } };
  const s = summary(docs, DEFAULTS, "30", "2026-10-01");
  assert.equal(s.avgUsed, -4);
  assert.equal(historyInsights(docs, DEFAULTS, "2026-10-01", { from: "2026-09-30" }).metrics.avgUsed, -4);
  const none = { "d-2026-10-01": { status: "green", entries: [], budget: 10 } };
  assert.equal(summary(none, DEFAULTS, "30", "2026-10-01").avgUsed, null);
  assert.equal(historyInsights(none, DEFAULTS, "2026-10-01", { from: "2026-10-01" }).metrics.avgUsed, null);
});
