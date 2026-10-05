import test from "node:test";
import assert from "node:assert/strict";
import { mondayOf, weekDays, episodeSpan, episodeBlocks } from "../web/week-model.js";

const ep = (when, extra = {}) => ({ when, symptoms: ["Headache"], duration: "", ...extra });
const NOW = "2026-10-07T14:30";

test("a week runs Monday to Sunday, whichever day it is reached from", () => {
  assert.equal(mondayOf("2026-10-05"), "2026-10-05"); // a Monday
  assert.equal(mondayOf("2026-10-11"), "2026-10-05"); // the Sunday after it
  assert.equal(mondayOf("2026-10-12"), "2026-10-12");
  assert.deepEqual(weekDays("2026-10-08"), [
    "2026-10-05",
    "2026-10-06",
    "2026-10-07",
    "2026-10-08",
    "2026-10-09",
    "2026-10-10",
    "2026-10-11",
  ]);
  // Across a month and a year end.
  assert.equal(mondayOf("2027-01-01"), "2026-12-28");
  assert.equal(weekDays("2027-01-01")[6], "2027-01-03");
});

test("an episode ends where it was recorded to end, runs to now while it is going, or is drawn at the middle of its range", () => {
  const exact = episodeSpan(ep("2026-10-07T09:00", { endedAt: "2026-10-07T10:30" }), NOW);
  assert.deepEqual([exact.end - exact.start, exact.how], [90, "exact"]);
  const going = episodeSpan(ep("2026-10-07T12:00", { duration: "Still going" }), NOW);
  assert.equal(going.how, "going");
  assert.equal(going.end - going.start, 150);
  const about = episodeSpan(ep("2026-10-07T09:00", { duration: "1–4 hours" }), NOW);
  assert.equal(about.how, "about");
  assert.equal(about.end - about.start, 150);
  // Nothing usable: a marker of fifteen minutes, never an empty or negative span.
  assert.equal(
    episodeSpan(ep("2026-10-07T09:00"), NOW).end - episodeSpan(ep("2026-10-07T09:00"), NOW).start,
    15,
  );
  assert.equal(
    episodeSpan(
      ep("2026-10-07T09:00", { endedAt: "2026-10-07T08:00", duration: "Under 15 min" }),
      NOW,
    ).how,
    "about",
    "an end before the start is ignored",
  );
  // Still going but recorded in the future of the clock: still a marker.
  const early = episodeSpan(ep("2026-10-07T18:00", { duration: "Still going" }), NOW);
  assert.equal(early.end - early.start, 15);
  assert.equal(episodeSpan({ when: "yesterday" }, NOW), null);
  assert.equal(episodeSpan({}, NOW), null);
});

test("an episode shows on each day it covers, cut at midnight", () => {
  const records = [
    [
      "e-1",
      ep("2026-10-06T22:00", { endedAt: "2026-10-07T02:00", symptoms: ["Nausea", "Fatigue"] }),
    ],
  ];
  const before = episodeBlocks(records, "2026-10-05", NOW),
    first = episodeBlocks(records, "2026-10-06", NOW),
    second = episodeBlocks(records, "2026-10-07", NOW),
    after = episodeBlocks(records, "2026-10-08", NOW);
  assert.deepEqual([before.length, after.length], [0, 0]);
  assert.deepEqual(
    [first[0].t, first[0].dur, first[0].hint],
    ["22:00", 120, "carries on the next day"],
  );
  assert.deepEqual(
    [second[0].t, second[0].dur, second[0].hint],
    ["00:00", 120, "began the day before"],
  );
  assert.equal(first[0].title, "Nausea, Fatigue");
  assert.equal(first[0].id, "ep:e-1");
  assert.equal(first[0].side, true);
  assert.equal(first[0].kind, "episode");
});

test("an episode that is still going fills every day since it began, up to now", () => {
  const records = [["e-2", ep("2026-10-05T20:00", { duration: "Still going", symptoms: [] })]];
  const days = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"].map((d) =>
    episodeBlocks(records, d, NOW),
  );
  assert.deepEqual(
    days.map((d) => d.map((b) => [b.t, b.dur])),
    [[["20:00", 240]], [["00:00", 1440]], [["00:00", 870]], []],
  );
  assert.equal(days[0][0].title, "Episode");
  assert.match(days[2][0].hint, /still going/);
  assert.match(days[2][0].hint, /began the day before/);
});

test("an episode with only a range for its length says it is approximate", () => {
  const [block] = episodeBlocks(
    [["e-3", ep("2026-10-07T09:00", { duration: "15–60 min" })]],
    "2026-10-07",
    NOW,
  );
  assert.equal(block.dur, 40);
  assert.equal(block.hint, "length is approximate");
  // The last minutes of a day: too short to be a stored length, so the grid draws it at its default, clipped.
  const [late] = episodeBlocks(
    [["e-4", ep("2026-10-07T23:57", { duration: "Under 15 min" })]],
    "2026-10-07",
    NOW,
  );
  assert.deepEqual([late.t, late.dur], ["23:57", undefined]);
});
