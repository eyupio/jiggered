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
  const docs = {
    "d-2026-10-01": { status: "red", entries: [{ a: "Rest", c: -4 }], budget: 10 },
    "d-2026-09-30": { status: "green", entries: [], budget: 10 },
  };
  const s = summary(docs, DEFAULTS, "30", "2026-10-01");
  assert.equal(s.avgUsed, -4);
  assert.equal(
    historyInsights(docs, DEFAULTS, "2026-10-01", { from: "2026-09-30" }).metrics.avgUsed,
    -4,
  );
  const none = { "d-2026-10-01": { status: "green", entries: [], budget: 10 } };
  assert.equal(summary(none, DEFAULTS, "30", "2026-10-01").avgUsed, null);
  assert.equal(
    historyInsights(none, DEFAULTS, "2026-10-01", { from: "2026-10-01" }).metrics.avgUsed,
    null,
  );
});

test("a summary uses History's exact dates and day/episode filters", () => {
  const docs = {
    "d-2026-09-20": { status: "red", entries: [{ a: "Work", c: 20 }], budget: 10 },
    "d-2026-09-29": { status: "red", entries: [{ a: "Work", c: 4 }], budget: 10 },
    "d-2026-09-30": { status: "green", entries: [{ a: "Rest", c: -2 }], budget: 10 },
    "d-2026-10-01": { status: "red", entries: [], budget: 10, poorSleep: true },
    "e-1": {
      when: "2026-09-29T09:00",
      symptoms: ["Headache", "Headache"],
      duration: "Still going",
      notes: "Work",
    },
    "e-2": {
      when: "2026-09-30T09:00",
      symptoms: ["Headache"],
      duration: "10 minutes",
      notes: "Work",
    },
    "e-3": {
      when: "2026-10-01T09:00",
      symptoms: ["Fatigue"],
      duration: "Still going",
      notes: "Work",
    },
  };
  for (const filters of [
    { from: "2026-09-25", to: "2026-10-01" },
    {
      from: "2026-09-29",
      to: "2026-09-30",
      status: "red",
      symptom: "Headache",
      ongoing: true,
      query: "work",
    },
    { from: "2026-09-29", to: "2026-10-01", query: "no match" },
  ]) {
    const h = historyInsights(docs, DEFAULTS, "2026-10-01", filters);
    const s = summary(docs, DEFAULTS, filters, "2026-10-01");
    assert.equal(s.from, h.from);
    assert.equal(s.to, h.to);
    assert.deepEqual(s.days, h.days);
    assert.deepEqual(
      s.episodes,
      h.episodes.map(([, e]) => e),
    );
    assert.equal(s.avgUsed, h.metrics.avgUsed);
    assert.equal(s.activityDays, h.metrics.logged);
    assert.equal(s.poorSleepDays, h.metrics.poorSleep);
    assert.deepEqual(s.topSymptoms, h.topSymptoms);
    assert.deepEqual(s.topTriggers, h.topTriggers);
  }
});
