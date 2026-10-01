import test from "node:test";
import assert from "node:assert/strict";
import { historyRange, historyInsights, validDate } from "../web/history-model.js";
import { chartMarkup, bucketDescription } from "../web/history-charts.js";
import { DEFAULTS, addDays, applyOp, operationConflicts } from "../web/model.js";
import { normaliseProfile, profileInitials } from "../web/profile.js";
import { calendarWindow, calendarPaint, describeCalendarDay } from "../web/history-matrix.js";
const day = (status, entries = [], extra = {}) => ({ status, entries, budget: 10, ...extra });
const activity = (a, c) => ({ a, c });
const episode = (when, symptoms = [], before = []) => ({ when, symptoms, before, duration: "Under 15 min" });

test("history keeps unlogged gaps, recovery below zero and stamped historical allowances", () => {
  const docs = { "d-2026-09-28": day("amber", [activity("Work", 8), activity("Rest", -2)], { budget: 12, poorSleep: true, sleepPenalty: 2, statusPenalty: 3 }),
    "d-2026-09-29": day("green"), "d-2026-10-01": day("red", [activity("Rest", -4)]), "e-1": episode("2026-09-30T23:50", ["Fatigue"]) };
  const d = historyInsights(docs, { ...DEFAULTS, budget: 30 }, "2026-10-01", { from: "2026-09-28" });
  assert.equal(d.metrics.avgUsed, 1); assert.equal(d.metrics.avgAllowance, 8.5);
  assert.equal(d.metrics.spent, 8); assert.equal(d.metrics.recovery, 6); assert.equal(d.metrics.checked, 3);
  assert.deepEqual(d.buckets.map(b => b.avgUsed), [6, null, null, -4]);
  assert.equal(d.buckets[0].avgAllowance, 7); assert.equal(d.buckets[2].episodes, 1);
  assert.equal(d.metrics.overBudget, 0); assert.match(bucketDescription(d.buckets[1], "en-GB"), /No activity points recorded/);
});

test("one filtered interval drives metrics, rankings, episode counts and comparison", () => {
  const docs = { "d-2026-10-01": day("red", [activity("Work", 3)]), "d-2026-09-30": day("green", [activity("Walk", -1)]),
    "d-2026-09-29": day("red", [activity("Work", 6)]),
    "e-1": episode("2026-10-01T09:00", ["Fatigue", "Fatigue"], ["Poor sleep", "Poor sleep"]), "e-2": episode("2026-09-30T10:00", ["Headache"]),
    "e-3": episode("2026-10-02T10:00", ["Fatigue"]) };
  const untouched = structuredClone(docs);
  const d = historyInsights(docs, DEFAULTS, "2026-10-01", { from: "2026-09-30", to: "2026-10-01", status: "red", symptom: "Fatigue" });
  assert.equal(d.metrics.checked, 1); assert.equal(d.metrics.episodes, 1); assert.equal(d.prior.checked, 1); assert.equal(d.prior.avgUsed, 6);
  assert.deepEqual(d.topSymptoms, [["Fatigue", 1]]); assert.deepEqual(d.topTriggers, [["Poor sleep", 1]]);
  assert.deepEqual(d.activities.map(a => a.name), ["Work"]); assert.deepEqual(docs, untouched);
});

test("large histories have at most 60 buckets and preserve counts and averages", () => {
  const docs = {};
  for (let i = 0; i < 10000; i++) { const date = addDays("1999-01-01", i); docs["d-" + date] = day(i % 2 ? "red" : "green", [activity("Work", i % 3)]); docs["e-" + i] = episode(date + "T08:00", ["Fatigue"]) }
  const d = historyInsights(docs, DEFAULTS, "2026-10-01");
  assert.ok(d.buckets.length <= 60); assert.equal(d.metrics.checked, 10000); assert.equal(d.metrics.episodes, 10000);
  assert.equal(d.buckets.reduce((n, b) => n + b.checked, 0), 10000); assert.equal(d.buckets.reduce((n, b) => n + b.episodes, 0), 10000);
  assert.ok(d.buckets.every(b => b.avgUsed === null || Number.isFinite(b.avgUsed)));
});

test("empty and episode-only accounts give useful ranges without fabricated activity days", () => {
  assert.deepEqual(historyRange({}, "2026-10-01", "all"), { from: "2026-10-01", to: "2026-10-01" });
  const docs = { "e-1": episode("2026-01-01T09:00"), "e-2": episode("2027-01-01T09:00") };
  const d = historyInsights(docs, DEFAULTS, "2026-10-01");
  assert.equal(d.from, "2026-01-01"); assert.equal(d.metrics.logged, 0); assert.equal(d.metrics.avgUsed, null); assert.equal(d.metrics.episodes, 1);
  assert.deepEqual(historyRange({}, "2026-03-30", "7"), { from: "2026-03-24", to: "2026-03-30" });
});

test("invalid or reversed dates are rejected and valid calendars span DST correctly", () => {
  assert.equal(validDate("2026-02-30"), false); assert.equal(validDate("2024-02-29"), true); assert.equal(validDate("0000-01-01"), false);
  for (const filters of [{ from: "2026-10-02" }, { from: "2026-09-31" }, { to: "2026-10-02" }, { from: "invalid" }]) assert.ok(historyInsights({}, DEFAULTS, "2026-10-01", filters).error);
  assert.equal(historyInsights({}, DEFAULTS, "2026-03-31", { from: "2026-03-27" }).span, 5);
});

test("sleep samples only use checked-in days and describe the unmarked group separately", () => {
  const docs = { "d-2026-09-28": day("red", [], { poorSleep: true }), "d-2026-09-29": day(null, [], { poorSleep: true }),
    "d-2026-09-30": day("green"), "d-2026-10-01": day("amber") };
  const d = historyInsights(docs, DEFAULTS, "2026-10-01");
  assert.deepEqual(d.sleep, { poor: { n: 1, bad: 1, percent: 100 }, other: { n: 2, bad: 1, percent: 50 } });
});

test("SVG charts provide exact accessible alternatives and sensible empty states", () => {
  const d = historyInsights({ "d-2026-10-01": day("green", [activity('<img onerror="x">', 2)]) }, DEFAULTS, "2026-10-01");
  const energy = chartMarkup(d, "energy", "en-GB").s, episodes = chartMarkup(d, "episodes", "en-GB").s;
  assert.match(energy, /<title/); assert.match(energy, /<caption/); assert.match(energy, /data-inspect/); assert.match(energy, /View graph data/);
  assert.match(episodes, /No episodes recorded/); assert.ok(!energy.includes("NaN")); assert.ok(!energy.includes("undefined"));
});

test("calendar windows stay bounded, align Monday rows and retain gaps and episode-only days", () => {
  const d = historyInsights({ "d-2026-09-28": day("green", [activity("Rest", -2)]),
    "d-2026-09-29": day("amber"), "e-1": episode("2026-09-30T08:00") }, DEFAULTS, "2026-10-01", { from: "2020-01-01" });
  const win = calendarWindow(d, DEFAULTS);
  assert.equal(win.cells.length, 366); assert.ok(win.weeks <= 54); assert.equal(win.from, "2025-10-01");
  const short = calendarWindow({ ...d, from: "2026-09-28" }, DEFAULTS);
  assert.equal(short.offset, 0); assert.equal(short.weeks, 1); assert.equal(short.cells[0].net, -2);
  assert.equal(short.cells[1].net, null); assert.equal(short.cells[2].logged, false); assert.equal(short.cells[2].episodes, 1);
  assert.match(describeCalendarDay(short.cells[2], "en-GB"), /No matching check-in.*No activities logged.*1 matching episode/);
  const older = calendarWindow(d, DEFAULTS, addDays(win.from, -1));
  assert.equal(older.to, "2025-09-30"); assert.equal(older.cells.length, 366);
  const first = calendarWindow(d, DEFAULTS, d.from);
  assert.equal(first.cells.length, 1); assert.equal(first.from, d.from);
  const phone = calendarWindow(d, DEFAULTS, d.to, 91);
  assert.equal(phone.cells.length, 91); assert.ok(phone.weeks <= 14); assert.equal(phone.to, d.to);
});

test("calendar colour modes distinguish unlogged, zero-point, recovery and episode records", () => {
  const c = { status: "red", net: null, poorSleep: false, episodes: 0 };
  assert.deepEqual(calendarPaint(c, "checkin"), ["red", "R"]);
  assert.deepEqual(calendarPaint(c, "points"), ["empty", "–"]);
  assert.deepEqual(calendarPaint({ ...c, net: 0 }, "points"), ["level-1", 0]);
  assert.deepEqual(calendarPaint({ ...c, net: -3 }, "points"), ["recovery", "−"]);
  assert.deepEqual(calendarPaint({ ...c, net: 200 }, "points"), ["level-4", 200]);
  assert.deepEqual(calendarPaint(c, "sleep"), ["empty", "–"]);
  assert.deepEqual(calendarPaint({ ...c, poorSleep: true }, "sleep"), ["amber", "!"]);
  assert.deepEqual(calendarPaint({ ...c, episodes: 12 }, "episodes"), ["level-4", 12]);
});

test("profile preferences normalise defensively and retain Unicode names", () => {
  assert.deepEqual(normaliseProfile(), { displayName: "", focus: "", theme: "system", historyRange: "30" });
  const p = normaliseProfile({ displayName: "  Paul Jennings  ", focus: "🙂".repeat(170), theme: "injected", historyRange: "7" });
  assert.equal(p.displayName, "Paul Jennings"); assert.equal([...p.focus].length, 160); assert.equal(p.theme, "system"); assert.equal(p.historyRange, "7");
  assert.equal(profileInitials("Paul Jennings"), "PJ"); assert.equal(profileInitials("🙂 Person"), "🙂P");
});

test("profile saves preserve unrelated settings; competing profile changes surface conflicts", () => {
  const original = { ...DEFAULTS, profile: normaliseProfile() }, profile = normaliseProfile({ displayName: "Paul", theme: "dark" });
  const op = { type: "settingsPatch", arg: { profile }, before: { profile: original.profile } };
  const other = { ...original, budget: 15, activities: [activity("Custom", 0)] };
  assert.deepEqual(operationConflicts(op, other), []);
  assert.deepEqual(applyOp(op, other), { ...other, profile });
  assert.deepEqual(operationConflicts(op, { ...other, profile: { ...profile, theme: "light" } }), ["profile"]);
  assert.deepEqual(operationConflicts(op, DEFAULTS), []);
});
