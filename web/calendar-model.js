// Time blocks for the planning calendar, shared by Plan, Today and History. A block starts at a local "HH:MM" (`t`)
// and lasts `dur` whole minutes. Nothing here touches the DOM, so all of it is unit tested.

export const DAY = 1440; // minutes in a day; a block may not run past midnight
export const STEP = 15; // dragging snaps to a quarter of an hour
const MIN_DUR = 5; // the shortest length stored; the server enforces the same range
const DEFAULT_DUR = 30; // how long a timed activity with no recorded length is drawn
export const NEW_DUR = 60; // the length given to an activity dropped onto the calendar
const MAX_COST = 10; // a cost is -10..10 points, as everywhere else; the same bound as LIMITS.cost

const pad = (n) => String(n).padStart(2, "0");

// "09:30" -> 570. Anything else (empty, malformed, 24:00) is null.
export function toMinutes(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(typeof t === "string" ? t : "");
  if (!m) return null;
  const h = Number(m[1]),
    min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}
// 570 -> "09:30". 1440 gives "24:00", which only ever labels the end of a block that finishes at midnight.
export const fromMinutes = (n) => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;

export const validDur = (d) => Number.isInteger(d) && d >= MIN_DUR && d <= DAY;

// Where an entry sits on the day, or null when it has no start time. `set` says whether its length was recorded.
export function spanOf(entry) {
  const start = toMinutes(entry?.t);
  if (start === null) return null;
  const set = validDur(entry.dur),
    dur = Math.min(set ? entry.dur : DEFAULT_DUR, DAY - start);
  return { start, dur, end: start + dur, set };
}

export function formatDur(d) {
  return d < 60 ? `${d} min` : d % 60 ? `${Math.floor(d / 60)} h ${d % 60} min` : `${d / 60} h`;
}
// "09:30–11:00" with a length, "09:30" with only a start, "1 h" with only a length, "" with neither.
export function slotText(entry) {
  const start = toMinutes(entry?.t),
    dur = validDur(entry?.dur) ? entry.dur : null;
  if (start === null) return dur ? formatDur(dur) : "";
  return dur
    ? `${fromMinutes(start)}–${fromMinutes(Math.min(start + dur, DAY))}`
    : fromMinutes(start);
}

// Timed entries first by start time, untimed ones last. Equal keys keep their order (sort is stable).
export function byTime(a, b) {
  const x = toMinutes(a?.t),
    y = toMinutes(b?.t);
  return x === y ? 0 : x === null ? 1 : y === null ? -1 : x - y;
}

export const snap = (n, step = STEP) => Math.round(n / step) * step;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// The three ways to change a block. Each takes {start, dur} and returns the new {start, dur}, snapped to the grid and
// kept inside the day.
export const moveTo = (block, start) => ({
  start: clamp(snap(start), 0, DAY - block.dur),
  dur: block.dur,
});
// Drag the bottom edge to `end`.
export function resizeEnd(block, end) {
  const e = clamp(snap(end), block.start + STEP, DAY);
  return { start: block.start, dur: e - block.start };
}
// Drag the top edge to `start`; the end stays where it is.
export function resizeStart(block, start) {
  const end = block.start + block.dur,
    s = clamp(snap(start), 0, end - STEP);
  return { start: s, dur: end - s };
}

// Blocks that overlap in time sit side by side. Gives each block a `lane` and the number of `lanes` in its group.
export function layoutDay(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.end - a.end),
    out = [];
  let group = [],
    groupEnd = 0,
    laneEnds = [];
  const flush = () => {
    for (const b of group) out.push({ ...b, lanes: laneEnds.length });
    group = [];
    laneEnds = [];
  };
  for (const b of sorted) {
    if (group.length && b.start >= groupEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= b.start);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = b.end;
    group.push({ ...b, lane });
    groupEnd = Math.max(groupEnd, b.end);
  }
  flush();
  return out;
}

// The hours the grid shows: 06:00–22:00, widened to whole hours that hold every block.
export function hourWindow(spans, from = 6 * 60, to = 22 * 60) {
  let lo = from,
    hi = to;
  for (const s of spans) {
    lo = Math.min(lo, s.start);
    hi = Math.max(hi, s.end);
  }
  return [Math.floor(lo / 60) * 60, Math.min(DAY, Math.ceil(hi / 60) * 60)];
}

// The shipped activity names carry a length: "Deep focus (2 hours)", "Driving (30 min or more)". Offered as a
// suggestion when one is placed on the calendar, never applied to what is already saved. Null when there is none.
export function suggestDuration(name) {
  const text = typeof name === "string" ? name : "";
  const hours = /\(\s*(\d+(?:[.,]\d+)?)\s*(?:hours?|hrs?|h)\b/i.exec(text),
    mins = /\(\s*(\d+)\s*(?:minutes?|mins?|m)\b/i.exec(text);
  const minutes = hours ? Number(hours[1].replace(",", ".")) * 60 : mins ? Number(mins[1]) : null;
  if (minutes === null) return null;
  const rounded = Math.round(minutes / MIN_DUR) * MIN_DUR;
  return validDur(rounded) ? rounded : null;
}

// An activity's points follow how long it takes: a cost of 2 at 30 minutes is 4 at an hour and 1 at 15 minutes. Whole
// points only, never less than one for an activity that cost something (or gave something back), and never beyond the
// largest cost there is. `from` is the length the cost was for, `to` the new one; anything else leaves the cost alone.
export function scaleCost(cost, from, to) {
  if (!Number.isInteger(cost) || cost === 0 || !validDur(from) || !validDur(to)) return cost;
  const scaled = Math.max(1, Math.round((Math.abs(cost) * to) / from));
  return Math.sign(cost) * Math.min(MAX_COST, scaled);
}
