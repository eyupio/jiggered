// Pure history analytics. Calendar gaps stay gaps; points use each day's recorded allowance.
import {
  addDays,
  listDays,
  listEpisodes,
  selectHistory,
  used,
  capOf,
  activityDays,
  averageNet,
} from "./model.js";

export const HISTORY_RANGES = [
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["180", "180 days"],
  ["365", "365 days"],
  ["all", "All time"],
];
const DAY = 86400000;
const ordinal = (key) => Date.parse(key + "T12:00:00Z") / DAY;
const validDates = new Map(); // a few thousand distinct dates are checked again and again; each is worked out once
const checkDate = (key) =>
  /^\d{4}-\d{2}-\d{2}$/.test(key || "") &&
  Number(key.slice(0, 4)) >= 1000 &&
  addDays(key, 0) === key;
export const validDate = (key) => {
  if (typeof key !== "string") return checkDate(key);
  let ok = validDates.get(key);
  if (ok === undefined) {
    ok = checkDate(key);
    if (validDates.size < 50000) validDates.set(key, ok);
  }
  return ok;
};
const round = (n) => Math.round(n * 10) / 10;
const average = (values) =>
  values.length ? round(values.reduce((s, n) => s + n, 0) / values.length) : null;
const counts = (lists, limit = 5) => {
  const result = new Map();
  for (const list of lists)
    for (const name of new Set(list)) if (name) result.set(name, (result.get(name) || 0) + 1);
  return [...result].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
};

export function historyRange(docs, today, preset = "30") {
  if (preset !== "all")
    return {
      from: addDays(today, 1 - Number(HISTORY_RANGES.find(([key]) => key === preset)?.[0] || 30)),
      to: today,
    };
  const dates = [
    ...listDays(docs).map((d) => d.date),
    ...listEpisodes(docs).map(([, e]) => e.when.slice(0, 10)),
  ].filter((d) => validDate(d) && d <= today);
  return { from: dates.reduce((a, b) => (a < b ? a : b), today), to: today };
}

function measure(days, episodes, S) {
  const checked = days.filter((d) => d.status),
    logged = activityDays(days);
  const statuses = Object.fromEntries(
    ["green", "amber", "red"].map((s) => [s, checked.filter((d) => d.status === s).length]),
  );
  return {
    days: days.length,
    checked: checked.length,
    logged: logged.length,
    ...statuses,
    avgUsed: averageNet(logged),
    avgAllowance: average(logged.map((d) => capOf(d, S))),
    overBudget: logged.filter((d) => used(d) > capOf(d, S)).length,
    poorSleep: days.filter((d) => d.poorSleep).length,
    episodes: episodes.length,
    spent: logged.reduce((s, d) => s + d.entries.reduce((n, e) => n + Math.max(0, e.c), 0), 0),
    recovery: logged.reduce((s, d) => s + d.entries.reduce((n, e) => n + Math.max(0, -e.c), 0), 0),
  };
}

export function historyInsights(docs, S, today, filters = {}) {
  const all = historyRange(docs, today, "all"),
    from = filters.from || all.from,
    to = filters.to || today;
  if (!validDate(from) || !validDate(to) || from > to || to > today)
    return {
      error: "Choose valid dates with an end date on or after the start and no later than today.",
    };
  const span = Math.round(ordinal(to) - ordinal(from)) + 1;
  const selected = selectHistory(docs, { ...filters, from, to });
  selected.days = selected.days.filter((d) => validDate(d.date));
  selected.episodes = selected.episodes.filter(([, e]) => validDate(e.when.slice(0, 10)));
  const { days, episodes } = selected;
  const previousTo = addDays(from, -1),
    previousFrom = addDays(from, -span);
  const previous = selectHistory(docs, { ...filters, from: previousFrom, to: previousTo });
  const metrics = measure(days, episodes, S),
    prior = measure(previous.days, previous.episodes, S);
  // At most 60 buckets regardless of account size. Each record is visited once.
  const bucketDays = Math.ceil(span / 60),
    buckets = Array.from({ length: Math.ceil(span / bucketDays) }, (_, i) => {
      const start = addDays(from, i * bucketDays),
        end = addDays(from, Math.min(span - 1, (i + 1) * bucketDays - 1));
      return {
        from: start,
        to: end,
        days: [],
        episodes: 0,
        green: 0,
        amber: 0,
        red: 0,
        poorSleep: 0,
      };
    });
  const bucketFor = (date) => buckets[Math.floor((ordinal(date) - ordinal(from)) / bucketDays)];
  for (const d of days) {
    const b = bucketFor(d.date);
    b.days.push(d);
    if (d.status) b[d.status]++;
    if (d.poorSleep) b.poorSleep++;
  }
  for (const [, e] of episodes) bucketFor(e.when.slice(0, 10)).episodes++;
  for (const b of buckets) {
    const logged = b.days.filter((d) => d.entries.length);
    b.avgUsed = average(logged.map(used));
    b.avgAllowance = average(logged.map((d) => capOf(d, S)));
    b.logged = logged.length;
    b.checked = b.green + b.amber + b.red;
    delete b.days;
  }
  const sleepGroup = (poor) => {
    const sample = days.filter((d) => d.status && !!d.poorSleep === poor),
      bad = sample.filter((d) => d.status !== "green").length;
    return {
      n: sample.length,
      bad,
      percent: sample.length ? Math.round((100 * bad) / sample.length) : null,
    };
  };
  const sleep = { poor: sleepGroup(true), other: sleepGroup(false) };
  const activities = new Map();
  for (const d of days)
    for (const e of d.entries) {
      if (!e.a) continue;
      const v = activities.get(e.a) || { name: e.a, count: 0, spent: 0, recovery: 0 };
      v.count++;
      v.spent += Math.max(0, e.c);
      v.recovery += Math.max(0, -e.c);
      activities.set(e.a, v);
    }
  const weekdays = Array.from({ length: 7 }, (_, i) => ({ index: i, checked: 0, bad: 0 }));
  for (const d of days.filter((d) => d.status)) {
    const w = weekdays[new Date(d.date + "T12:00:00Z").getUTCDay()];
    w.checked++;
    if (d.status !== "green") w.bad++;
  }
  return {
    from,
    to,
    span,
    bucketDays,
    buckets,
    days,
    episodes,
    metrics,
    prior,
    previousFrom,
    previousTo,
    sleep,
    weekdays,
    topSymptoms: counts(episodes.map(([, e]) => e.symptoms)),
    topTriggers: counts(episodes.map(([, e]) => e.before)),
    activities: [...activities.values()]
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 6),
  };
}
