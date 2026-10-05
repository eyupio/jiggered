// What the History week view draws, kept apart from the page so it can be tested: which days make a week, and where an
// episode sits on each of them. Times here are the wall-clock text people typed, so every comparison is in whole minutes
// of that clock (read as UTC only to do the arithmetic, which keeps daylight-saving changes out of it).
import { addDays } from "./model.js";
import { DAY, MIN_DUR, fromMinutes } from "./calendar-model.js";

// The week is Monday to Sunday, as the History calendar is.
export const mondayOf = (date) =>
  addDays(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
export const weekDays = (date) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(date), i));

// An episode records how long it lasted as a range of words, not a number. Without an exact end time the bar is drawn
// at the middle of its range and says so.
const ABOUT = {
  "Under 15 min": 15,
  "15–60 min": 40,
  "1–4 hours": 150,
  "4–12 hours": 480,
  "Most of a day": 720,
  "Over a day": DAY,
};
const SHORTEST = 15; // an episode with no usable length is a marker, not a span
const wall = (text) => {
  // Strictly "YYYY-MM-DDTHH:MM": the browser's own parser reads some other text as a date.
  const stamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.exec(String(text ?? ""));
  const ms = stamp ? Date.parse(stamp[0] + ":00Z") : NaN;
  return Number.isFinite(ms) ? ms / 60_000 : null;
};

// Start and end of an episode in minutes, with `how` saying where the end came from: "exact" (an end time was
// recorded), "going" (still going, so it runs to now) or "about" (the length is only a range).
export function episodeSpan(episode, now) {
  const start = wall(episode?.when);
  if (start === null) return null;
  const ended = episode.endedAt ? wall(episode.endedAt) : null;
  if (ended !== null && ended > start) return { start, end: ended, how: "exact" };
  if (episode.duration === "Still going")
    return { start, end: Math.max(start + SHORTEST, wall(now) ?? 0), how: "going" };
  return { start, end: start + (ABOUT[episode.duration] ?? SHORTEST), how: "about" };
}

// The part of each episode that falls on `date`, as blocks for the time grid. One that runs past midnight is cut at it
// and carries on in the next day's column. `records` is [[id, episode]] as listEpisodes returns.
export function episodeBlocks(records, date, now) {
  const from = wall(date + "T00:00"),
    to = from + DAY,
    blocks = [];
  for (const [id, episode] of records) {
    const span = episodeSpan(episode, now);
    if (!span || span.end <= from || span.start >= to) continue;
    const start = Math.max(span.start, from) - from,
      length = Math.min(span.end, to) - from - start,
      notes = [];
    if (span.start < from) notes.push("began the day before");
    if (span.end > to) notes.push("carries on the next day");
    if (span.how === "going") notes.push("still going");
    if (span.how === "about") notes.push("length is approximate");
    blocks.push({
      id: "ep:" + id,
      title: episode.symptoms?.length ? episode.symptoms.join(", ") : "Episode",
      t: fromMinutes(start),
      dur: length >= MIN_DUR ? length : undefined,
      kind: "episode",
      side: true,
      hint: notes.join(", "),
    });
  }
  return blocks;
}
