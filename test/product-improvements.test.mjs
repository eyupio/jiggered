import test from "node:test";
import assert from "node:assert/strict";
import { episodesCsv, activitiesCsv } from "../web/model.js";
import { normaliseProfile } from "../web/profile.js";

test("sharing omits private notes on request, retaining CSV escaping", () => {
  const docs = {
    "e-1": {
      when: "2026-10-02T10:00",
      notes: 'private, "quoted"\nline',
      symptoms: ["Dizzy"],
      before: [],
      duration: "Under 15 min",
    },
  };
  assert.doesNotMatch(episodesCsv(docs, { includeNotes: false }), /private|quoted/);
  assert.match(episodesCsv(docs, { includeNotes: true }), /private, ""quoted""/);
});
test("activity CSV preserves repeated entries, recovery and historical costs", () => {
  const docs = {
    "d-2026-10-02": {
      date: "2026-10-02",
      entries: [
        { id: "a", a: "Work, travel", c: 3, t: "10:05" },
        { id: "b", a: "Rest", c: -2, t: "11:00" },
        { id: "c", a: "Work, travel", c: 4, t: "12:00" },
      ],
    },
  };
  const csv = activitiesCsv(docs);
  assert.match(csv, /"Work, travel",3/);
  assert.match(csv, /Rest,-2/);
  assert.match(csv, /"Work, travel",4/);
  assert.match(csv, /2026-10-02,a,10:05/);
  assert.equal(csv.trim().split("\n").length, 4);
});
test("weekly review is opt-in and sanitises dismissal metadata", () => {
  assert.equal(normaliseProfile().weeklyReview, false);
  assert.equal(normaliseProfile({ weeklyReview: "true" }).weeklyReview, false);
  assert.equal(
    normaliseProfile({ weeklyReview: true, reviewDismissedWeek: "2026-09-28" }).reviewDismissedWeek,
    "2026-09-28",
  );
  assert.equal(normaliseProfile({ reviewDismissedWeek: "injected" }).reviewDismissedWeek, "");
});
