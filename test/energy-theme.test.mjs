import test from "node:test";
import assert from "node:assert/strict";
import { energyTheme, energyAmount, energyCopy } from "../web/energy-theme.js";
import { normaliseProfile } from "../web/profile.js";
import { DEFAULTS, applyOp, operationConflicts, capOf, used, daysCsv } from "../web/model.js";
import { historyInsights } from "../web/history-model.js";
import { chartMarkup, bucketDescription } from "../web/history-charts.js";
import { describeCalendarDay } from "../web/history-matrix.js";

test("existing and malformed preferences default to points; spoon language handles signed amounts", () => {
  for (const value of [undefined, null, {}, { energyTheme: "invalid" }, { energyTheme: true }]) {
    assert.equal(energyTheme(value), "points"); assert.equal(normaliseProfile(value).energyTheme, "points");
  }
  assert.equal(normaliseProfile({ energyTheme: "spoons", theme: "dark" }).energyTheme, "spoons");
  assert.equal(energyAmount(1, "spoons"), "1 spoon"); assert.equal(energyAmount(-1, "spoons"), "-1 spoon");
  assert.equal(energyAmount(0, "spoons"), "0 spoons"); assert.equal(energyAmount(2.5, "points"), "2.5 points");
  assert.equal(energyCopy("Points left; recovery adds points.", "spoons"), "Spoons left; recovery adds spoons.");
});

test("changing energy language preserves budgets, costs, names, historical metrics and CSV contracts", () => {
  const day = { date: "2026-10-01", status: "green", entries: [{ id: "a", a: "Review points", c: 2 }], budget: 12, sleepPenalty: 3 };
  const settings = { ...DEFAULTS, profile: normaliseProfile({ theme: "dark" }) };
  const op = { type: "settingsPatch", arg: { profile: { ...settings.profile, energyTheme: "spoons" } }, before: { profile: settings.profile } };
  const changed = applyOp(op, { ...settings, budget: 15 });
  assert.equal(changed.budget, 15); assert.deepEqual(changed.activities, settings.activities);
  assert.equal(changed.profile.theme, "dark"); assert.equal(capOf(day, changed) - used(day), 10);
  assert.deepEqual(operationConflicts(op, { ...settings, budget: 15 }), []);
  assert.deepEqual(operationConflicts(op, { ...settings, profile: { ...settings.profile, focus: "New focus" } }), ["profile"]);
  const docs = { "d-2026-10-01": day };
  assert.equal(daysCsv(docs, settings), daysCsv(docs, changed));
  assert.deepEqual(historyInsights(docs, settings, day.date), historyInsights(docs, changed, day.date));
  assert.equal(day.entries[0].a, "Review points");
});

test("history uses spoon units in accessible descriptions while chart points retain their meaning", () => {
  const data = historyInsights({ "d-2026-10-01": { status: "green", entries: [{ a: "Rest", c: -1 }], budget: 10 } }, DEFAULTS, "2026-10-01", { from: "2026-10-01" });
  const markup = chartMarkup(data, "energy", "en-GB", "spoons").s;
  assert.match(markup, /Net spoons/); assert.match(markup, /-1 spoon/); assert.match(markup, /One point per day/);
  assert.doesNotMatch(markup, /Net points/);
  assert.match(bucketDescription(data.buckets[0], "en-GB", "spoons"), /Net spoons -1; allowance 10/);
  assert.match(describeCalendarDay({ date: "2026-10-01", net: 2, allowance: 10, episodes: 0 }, "en-GB", "spoons"), /2 net spoons used/);
});
