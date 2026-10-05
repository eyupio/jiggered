import test from "node:test";
import assert from "node:assert/strict";
import {
  DAY,
  toMinutes,
  fromMinutes,
  validDur,
  spanOf,
  slotText,
  formatDur,
  byTime,
  snap,
  moveTo,
  resizeEnd,
  resizeStart,
  layoutDay,
  hourWindow,
  suggestDuration,
} from "../web/calendar-model.js";

test("times convert both ways and reject anything that is not a clock time", () => {
  assert.equal(toMinutes("00:00"), 0);
  assert.equal(toMinutes("09:30"), 570);
  assert.equal(toMinutes("23:59"), 1439);
  for (const bad of ["", "9:30", "24:00", "12:60", "12:5", "ab:cd", null, undefined, 930])
    assert.equal(toMinutes(bad), null, String(bad));
  assert.equal(fromMinutes(570), "09:30");
  assert.equal(fromMinutes(0), "00:00");
  assert.equal(fromMinutes(DAY), "24:00");
});

test("a duration is a whole number of minutes from 5 to 1440", () => {
  for (const ok of [5, 15, 90, 1440]) assert.equal(validDur(ok), true, String(ok));
  for (const bad of [0, 4, 1441, 1.5, "60", null, undefined, NaN])
    assert.equal(validDur(bad), false, String(bad));
});

test("an entry's span uses its recorded length, a default otherwise, and never runs past midnight", () => {
  assert.equal(spanOf({ a: "x", c: 1 }), null);
  assert.equal(spanOf({ t: "" }), null);
  assert.deepEqual(spanOf({ t: "09:00", dur: 90 }), { start: 540, dur: 90, end: 630, set: true });
  assert.deepEqual(spanOf({ t: "09:00" }), { start: 540, dur: 30, end: 570, set: false });
  assert.deepEqual(spanOf({ t: "09:00", dur: 3 }), { start: 540, dur: 30, end: 570, set: false });
  // 23:50 + 30 would pass midnight, so it is drawn to the end of the day instead.
  assert.deepEqual(spanOf({ t: "23:50" }), { start: 1430, dur: 10, end: 1440, set: false });
});

test("a slot reads as a range, a start, a length or nothing", () => {
  assert.equal(slotText({ t: "09:30", dur: 90 }), "09:30–11:00");
  assert.equal(slotText({ t: "09:30" }), "09:30");
  assert.equal(slotText({ dur: 45 }), "45 min");
  assert.equal(slotText({}), "");
  assert.equal(slotText({ t: "23:00", dur: 60 }), "23:00–24:00");
  assert.equal(formatDur(30), "30 min");
  assert.equal(formatDur(60), "1 h");
  assert.equal(formatDur(150), "2 h 30 min");
});

test("timed entries sort by start time and untimed ones go last, keeping their order", () => {
  const rows = [
    { id: "a", t: "" },
    { id: "b", t: "15:00" },
    { id: "c" },
    { id: "d", t: "09:00" },
    { id: "e", t: "15:00" },
  ];
  assert.deepEqual(
    [...rows].sort(byTime).map((r) => r.id),
    ["d", "b", "e", "a", "c"],
  );
});

test("moving snaps to a quarter hour and stays inside the day", () => {
  assert.equal(snap(547), 540);
  assert.equal(snap(548), 555);
  assert.deepEqual(moveTo({ start: 540, dur: 60 }, 612), { start: 615, dur: 60 });
  assert.deepEqual(moveTo({ start: 540, dur: 60 }, -50), { start: 0, dur: 60 });
  assert.deepEqual(moveTo({ start: 540, dur: 120 }, 1400), { start: DAY - 120, dur: 120 });
});

test("resizing keeps a minimum length, the other edge fixed, and the day's bounds", () => {
  const block = { start: 540, dur: 60 };
  assert.deepEqual(resizeEnd(block, 690), { start: 540, dur: 150 });
  assert.deepEqual(resizeEnd(block, 545), { start: 540, dur: 15 });
  assert.deepEqual(resizeEnd(block, 9999), { start: 540, dur: DAY - 540 });
  assert.deepEqual(resizeStart(block, 510), { start: 510, dur: 90 });
  assert.deepEqual(resizeStart(block, 595), { start: 585, dur: 15 });
  assert.deepEqual(resizeStart(block, -100), { start: 0, dur: 600 });
});

test("overlapping blocks share the width; blocks that only touch do not", () => {
  const block = (id, start, end) => ({ id, start, end });
  const lane = (blocks) =>
    Object.fromEntries(layoutDay(blocks).map((b) => [b.id, `${b.lane}/${b.lanes}`]));
  assert.deepEqual(lane([block("a", 0, 60), block("b", 60, 120)]), { a: "0/1", b: "0/1" });
  assert.deepEqual(lane([block("a", 0, 60), block("b", 30, 90)]), { a: "0/2", b: "1/2" });
  // A block that only touches a two-lane group starts a new group, so it keeps the full width.
  assert.deepEqual(lane([block("a", 0, 60), block("x", 10, 50), block("b", 60, 120)]), {
    a: "0/2",
    x: "1/2",
    b: "0/1",
  });
  // A chain: c starts as a ends, so it reuses a's lane, but the whole group is still two lanes wide.
  assert.deepEqual(lane([block("a", 0, 60), block("b", 30, 90), block("c", 60, 120)]), {
    a: "0/2",
    b: "1/2",
    c: "0/2",
  });
  assert.deepEqual(lane([block("a", 0, 120), block("b", 10, 20), block("c", 30, 40)]), {
    a: "0/2",
    b: "1/2",
    c: "1/2",
  });
  assert.deepEqual(layoutDay([]), []);
});

test("the visible hours widen to whole hours that hold every block", () => {
  assert.deepEqual(hourWindow([]), [360, 1320]);
  assert.deepEqual(hourWindow([{ start: 400, end: 500 }]), [360, 1320]);
  assert.deepEqual(hourWindow([{ start: 290, end: 500 }]), [240, 1320]);
  assert.deepEqual(hourWindow([{ start: 1300, end: 1440 }]), [360, 1440]);
});

test("a length is suggested from a name only when it clearly states one", () => {
  assert.equal(suggestDuration("Deep focus (2 hours)"), 120);
  assert.equal(suggestDuration("Screen-heavy work (1 hour)"), 60);
  assert.equal(suggestDuration("Driving (30 min or more)"), 30);
  assert.equal(suggestDuration("Walk (1.5 hours)"), 90);
  assert.equal(suggestDuration("Nap (20 mins)"), 20);
  assert.equal(suggestDuration("Housework"), null);
  assert.equal(suggestDuration("Team standup (5 meetings)"), null);
  assert.equal(suggestDuration("Marathon (500 hours)"), null);
  assert.equal(suggestDuration(undefined), null);
});
