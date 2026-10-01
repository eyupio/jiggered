// The data model and the rules around it: settings, a day's energy budget, the operations that edit
// a doc, trends, and CSV. No DOM and no network, so it is tested with `node --test`.

export const DEFAULTS = Object.freeze({
  budget: 10,
  sleepPenalty: 3,
  locale: "en-GB",
  activities: [
    { a: "Meeting or call", c: 2 }, { a: "Unplanned interruption", c: 3 },
    { a: "Context switch", c: 1 }, { a: "Deep focus (2 hours)", c: 1 },
    { a: "Social or noisy place", c: 3 }, { a: "Travel or commute", c: 2 },
    { a: "Walk or dog walk", c: -2 }, { a: "Quiet break", c: -1 }],
  symptoms: ["Face numb or tingling", "Hand or arm numb", "Arm clumsy", "Blurred vision", "Eye discomfort", "Headache", "Speech change", "Weakness"],
  triggers: ["Poor sleep", "High stress", "Overload or overwhelm", "Long hyperfocus", "Long screen time", "Skipped meals", "Low water", "Noisy or busy place", "Alcohol", "Missed tablets"],
});

export const ONSET = ["Built up gradually", "Sudden"];
export const DURATIONS = ["Still going", "Under 15 min", "15–60 min", "1–4 hours", "4–12 hours", "Most of a day", "Over a day", "Ended (duration unknown)"];
export const ADVICE = {
  green: "Normal plan. Still leave gaps between demanding things.",
  amber: "Cut today's plan. Drop or move one demanding thing now.",
  red: "Essentials only. Protect your energy and plan recovery time.",
};
// "" means whatever the browser uses.
export const LOCALES = [["en-GB", "English (UK)"], ["en-US", "English (US)"], ["en-AU", "English (Australia)"], ["en-CA", "English (Canada)"],
  ["de-DE", "Deutsch"], ["fr-FR", "Français"], ["es-ES", "Español"], ["nl-NL", "Nederlands"], ["", "Browser default"]];

export const LIMITS = { budget: [1, 30], cost: [-10, 10], items: 40, text: 60 };

// ---- dates ----

export const pad = n => String(n).padStart(2, "0");
export const dkey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const nowLocal = (d = new Date()) => `${dkey(d)}T${hhmm(d)}`;
export const dayId = key => "d-" + key;
export const isDayId = id => /^d-\d{4}-\d{2}-\d{2}$/.test(id);
export const isEpisodeId = id => /^e-\d+$/.test(id);

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return dkey(new Date(y, m - 1, d + n));
}

// ---- settings ----

const text = (s, n = LIMITS.text) => typeof s === "string" ? [...s.trim()].slice(0, n).join("") : "";
const int = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : dflt };
const names = (v, dflt) => Array.isArray(v) ? [...new Set(v.map(x => text(x)).filter(Boolean))].slice(0, LIMITS.items) : [...dflt];

// normaliseSettings turns whatever is stored (or typed) into valid settings, falling back to the
// defaults for anything missing. A list that is present but empty stays empty.
export function normaliseSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const budget = int(r.budget, ...LIMITS.budget, DEFAULTS.budget);
  const activities = Array.isArray(r.activities)
    ? r.activities.map(x => ({ ...(typeof x?.id === "string" ? { id: x.id } : {}), a: text(x && x.a), c: int(x && x.c, ...LIMITS.cost, NaN) })).filter(x => x.a && Number.isFinite(x.c)).slice(0, LIMITS.items)
    : DEFAULTS.activities.map(x => ({ ...x }));
  return {
    budget,
    sleepPenalty: int(r.sleepPenalty, 0, budget, Math.min(DEFAULTS.sleepPenalty, budget)),
    locale: typeof r.locale === "string" && LOCALES.some(([v]) => v === r.locale) ? r.locale : DEFAULTS.locale,
    activities,
    symptoms: names(r.symptoms, DEFAULTS.symptoms),
    triggers: names(r.triggers, DEFAULTS.triggers),
  };
}

// ---- a day ----

export const emptyDay = key => ({ date: key, status: null, poorSleep: false, entries: [] });
export const used = d => (d.entries || []).reduce((s, e) => s + (e.c || 0), 0);
// Days remember the budget they were made under, so changing your settings doesn't rewrite history.
export const capOf = (d, S) => (d.budget ?? S.budget) - (d.poorSleep ? (d.sleepPenalty ?? S.sleepPenalty) : 0);

// ---- operations ----
// Edits are operations rather than whole-doc snapshots, so they can be replayed on top of a newer copy
// from the server. Each is safe to apply twice (a retried save must not add an entry twice).

// Deterministic legacy identities let independent devices migrate the same rows consistently.
export function identifyEntries(entries = []) {
  return (Array.isArray(entries) ? entries : []).map((e, i) => e.id ? e : { ...e, id: `legacy-entry:${i}:${JSON.stringify([e.a,e.c,e.t])}` });
}
export const identifyActivities = rows => (Array.isArray(rows) ? rows : []).map(e => e.id ? e : { ...e, id: `legacy-activity:${encodeURIComponent(e.a)}` });
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
export function operationConflicts(op, body) {
  if (!op.before) return [];
  if (body == null) return ["deleted record"];
  if (op.type === "editEntry") {
    const current = identifyEntries(body.entries).find(e => e.id === op.arg.id);
    if (!current) return ["deleted activity"];
    return Object.keys(op.arg.changes).filter(k => !equal(current[k],op.before[k]) && !equal(current[k],op.arg.changes[k]));
  }
  const fields = Object.keys(op.arg).filter(k => k !== "activities");
  const conflicts = fields.filter(k => !equal(body[k],op.before[k]) && !equal(body[k],op.arg[k]));
  if (op.type === "settingsPatch" && op.arg.activities) {
    const current = identifyActivities(body.activities || []), before = identifyActivities(op.before.activities || []), next = op.arg.activities;
    for (const row of before) {
      const n = next.find(x => x.id === row.id), c = current.find(x => x.id === row.id);
      if (!n || !c) { if (!equal(n,row) && !equal(c,row) && !equal(c,n)) conflicts.push(`activity: ${row.a}`) }
      else for (const k of ["a","c"]) if (!equal(n[k],row[k]) && !equal(c[k],row[k]) && !equal(c[k],n[k])) conflicts.push(`activity: ${row.a} (${k === "a" ? "name" : "points"})`);
    }
    const common = new Set(before.filter(x => current.some(c=>c.id===x.id) && next.some(n=>n.id===x.id)).map(x=>x.id));
    const order = rows => rows.filter(x=>common.has(x.id)).map(x => x.id);
    if (!equal(order(next),order(before)) && !equal(order(current),order(before)) && !equal(order(current),order(next))) conflicts.push("activity order");
  }
  return conflicts;
}
function mergeActivities(current, before, next) {
  const old = identifyActivities(before || []), rows = identifyActivities(current || []);
  const deleted = old.filter(x => !next.some(n => n.id === x.id)).map(x => x.id);
  const out = rows.filter(x => !deleted.includes(x.id)).map(x => {
    const n = next.find(n => n.id === x.id), b = old.find(b => b.id === x.id);
    return n ? { ...x, ...Object.fromEntries(Object.entries(n).filter(([k,v]) => !equal(v,b?.[k]))) } : x;
  });
  for (const n of next) if (!old.some(b => b.id === n.id) && !out.some(x => x.id === n.id)) out.push(n);
  if (!equal(next.map(x=>x.id),old.map(x=>x.id))) {
    const rank = new Map(next.map((x,i)=>[x.id,i]));
    out.sort((a,b)=>(rank.get(a.id) ?? next.length)-(rank.get(b.id) ?? next.length));
  }
  return out;
}
const sameEntry = (x, y) => x.id && y.id ? x.id === y.id : x.a === y.a && x.c === y.c && x.t === y.t;

const DAY_OPS = {
  setStatus: (d, v) => ({ ...d, status: v || null }),
  setPoorSleep: (d, v) => ({ ...d, poorSleep: !!v }),
  addEntry: (d, e) => d.entries.some(x => x.id && x.id === e.id) ? d : { ...d, entries: [...d.entries, e] },
  removeEntry: (d, e) => {
    const i = d.entries.findIndex(x => sameEntry(x, e));
    return i < 0 ? d : { ...d, entries: d.entries.filter((_, j) => j !== i) };
  },
  editEntry: (d, arg) => ({ ...d, entries: identifyEntries(d.entries).map(e => e.id === arg.id ? { ...e, ...arg.changes, id: e.id } : e) }),
  restoreEntry: (d, arg) => {
    const entries = identifyEntries(d.entries);
    if (entries.some(e => e.id === arg.entry.id)) return d;
    entries.splice(Math.min(arg.index,entries.length),0,arg.entry);
    return { ...d, entries };
  },
  restamp: (d, s) => ({ ...d, budget: s.budget, sleepPenalty: s.sleepPenalty }),
};

// applyOp returns the doc after the operation, or undefined if the doc is gone.
export function applyOp(op, body) {
  if (op.type === "remove") return undefined;
  if (op.type === "replace") return op.arg;
  if (op.type === "settingsPatch") {
    const { activities, ...fields } = op.arg;
    return { ...(body || {}), ...fields, ...(activities ? { activities: mergeActivities(body?.activities,op.before?.activities,activities) } : {}) };
  }
  if (op.type === "patch") return { ...(body || {}), ...op.arg };
  const fn = DAY_OPS[op.type];
  if (!fn) throw new Error("unknown operation " + op.type);
  let d = body ?? emptyDay(op.id.slice(2));
  if (!Array.isArray(d.entries)) d = { ...d, entries: [] };
  if (d.budget === undefined && op.stamp && op.type !== "restamp") d = { ...d, budget: op.stamp.budget, sleepPenalty: op.stamp.sleepPenalty };
  if (["editEntry","removeEntry","restoreEntry"].includes(op.type)) d = { ...d, entries: identifyEntries(d.entries) };
  return fn(d, op.arg);
}

// ---- reading the docs ----

export function readableDay(raw, date) {
  const d = raw && typeof raw === "object" ? raw : {};
  return { ...d, date, status: ["green", "amber", "red"].includes(d.status) ? d.status : null,
    entries: Array.isArray(d.entries) ? d.entries.filter(e => e && Number.isFinite(e.c)).map(e => ({ ...e, a: typeof e.a === "string" ? e.a : "", t: typeof e.t === "string" ? e.t : "" })) : [] };
}
export function listDays(docs) {
  return Object.entries(docs).filter(([k,v]) => isDayId(k) && v).map(([id,v]) => readableDay(v,id.slice(2))).sort((a,b) => b.date.localeCompare(a.date));
}

export function listEpisodes(docs) {
  return Object.entries(docs).filter(([k]) => isEpisodeId(k)).filter(([, v]) => v && typeof v.when === "string").map(([id, v]) => [id, readableEpisode(v)]).sort((a, b) => b[1].when.localeCompare(a[1].when));
}

const top = (counts, n) => [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const tally = (lists) => { const m = new Map(); for (const l of lists) for (const x of l || []) m.set(x, (m.get(x) || 0) + 1); return m };

// trends summarises the last `window` days ending today.
export function trends(docs, S, today, window = 30) {
  const from = addDays(today, -(window - 1));
  const days = listDays(docs).filter(d => d.date >= from && d.date <= today);
  const count = s => days.filter(d => d.status === s).length;
  const checked = days.filter(d => d.status);
  const sleepy = days.filter(d => d.poorSleep);
  const since = n => addDays(today, -(n - 1)) + "T00:00";
  const eps = listEpisodes(docs).map(([, e]) => e);
  const recent90 = eps.filter(e => e.when >= since(90) && e.when < addDays(today, 1) + "T00:00");
  return {
    window,
    green: count("green"), amber: count("amber"), red: count("red"),
    unchecked: window - checked.length,
    avgUsed: days.length ? Math.round(days.reduce((s, d) => s + used(d), 0) / days.length * 10) / 10 : null,
    poorSleepDays: sleepy.length,
    poorSleepBad: sleepy.filter(d => d.status === "amber" || d.status === "red").length,
    episodes30: eps.filter(e => e.when >= since(30) && e.when < addDays(today, 1) + "T00:00").length,
    episodes90: recent90.length,
    topTriggers: top(tally(recent90.map(e => e.before)), 3),
    topSymptoms: top(tally(recent90.map(e => e.symptoms)), 3),
  };
}

// ---- CSV ----

// Cells starting with = + - @ would run as formulas if someone opens the file in a spreadsheet.
export const csvCell = v => {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // numbers like -2 are not formulas
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = rows => rows.map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export function daysCsv(docs, S) {
  const rows = [["date", "check_in", "poor_sleep", "points_used", "points_available", "activities"]];
  for (const d of listDays(docs).reverse()) {
    rows.push([d.date, d.status || "", d.poorSleep ? "yes" : "no", used(d), capOf(d, S),
      (d.entries || []).map(e => `${e.t ? e.t + " " : ""}${e.a} (${e.c > 0 ? "-" : "+"}${Math.abs(e.c)})`).join("; ")]);
  }
  return csv(rows);
}

export function episodesCsv(docs) {
  const rows = [["started", "symptoms", "how_it_came_on", "how_long", "in_the_day_or_two_before", "notes", "ended_local", "start_time_zone", "start_utc_offset_minutes", "end_time_zone", "end_utc_offset_minutes"]];
  for (const [, e] of listEpisodes(docs).reverse()) {
    rows.push([e.when, (e.symptoms || []).join("; "), e.onset || "", e.duration || "", (e.before || []).join("; "), e.notes || "", e.endedAt || "", e.whenZone || "", e.whenOffset ?? "", e.endZone || "", e.endOffset ?? ""]);
  }
  return csv(rows);
}

// ---- clinician summary ----

export const RANGES = [["30", "Last 30 days"], ["90", "Last 90 days"], ["365", "Last year"], ["all", "Everything"]];

export function summary(docs, S, range, today) {
  const from = range === "all" ? "0000-00-00" : addDays(today, -(Number(range) - 1));
  const days = listDays(docs).filter(d => d.date >= from && d.date <= today);
  const episodes = listEpisodes(docs).map(([, e]) => e).filter(e => e.when >= from + "T00:00" && e.when < addDays(today, 1) + "T00:00");
  const count = s => days.filter(d => d.status === s).length;
  return {
    from: range === "all" ? [today, ...days.map(d => d.date), ...episodes.map(e => e.when.slice(0, 10))].sort()[0] : from, to: today,
    days, episodes,
    green: count("green"), amber: count("amber"), red: count("red"),
    avgUsed: days.length ? Math.round(days.reduce((s, d) => s + used(d), 0) / days.length * 10) / 10 : null,
    poorSleepDays: days.filter(d => d.poorSleep).length,
    topTriggers: top(tally(episodes.map(e => e.before)), 5),
    topSymptoms: top(tally(episodes.map(e => e.symptoms)), 5),
  };
}

// Editor validation is separate from defensive reading: never silently trim a person's unfinished work.
export function validateSettings(r) {
  const errors = [];
  const integer = (v, lo, hi) => String(v).trim() !== "" && Number.isInteger(Number(v)) && Number(v) >= lo && Number(v) <= hi;
  if (!integer(r.budget, ...LIMITS.budget)) errors.push(["set-budget", "Choose a whole-number budget from 1 to 30."]);
  if (!integer(r.sleepPenalty, 0, Number(r.budget))) errors.push(["set-penalty", "Poor sleep costs must be a whole number between zero and your daily budget."]);
  if (!LOCALES.some(([v]) => v === r.locale)) errors.push(["set-locale", "Choose a supported date format."]);
  for (const [key, field, label] of [["activities", "set-acts", "activities"], ["symptoms", "set-sym", "symptoms"], ["triggers", "set-trig", "triggers"]]) {
    const values = key === "activities" ? r[key].map(x => x.a.trim()) : r[key].map(x => x.trim()).filter(Boolean);
    if (values.length > LIMITS.items) errors.push([field, `Keep at most ${LIMITS.items} ${label}. Your text has been kept.`]);
    if (values.some(x => !x || [...x].length > LIMITS.text)) errors.push([field, `Each ${label} name needs 1–${LIMITS.text} characters.`]);
    if (new Set(values.map(x => x.toLowerCase())).size !== values.length) errors.push([field, `Use distinct ${label} names (including capitalisation).`]);
  }
  if (r.activities.some(x => !integer(x.c, ...LIMITS.cost))) errors.push(["set-acts", "Activity points must be whole numbers from −10 to 10. Zero is allowed."]);
  return errors;
}

export function balanceLabel(left, cap) {
  return left < 0 ? `${-left} over your planned budget` : left > cap ? `${left - cap} above the starting budget` : left === 0 ? "No points left in your plan" : "Points left in your plan";
}

export function ongoingEpisodes(docs) {
  return listEpisodes(docs).filter(([, e]) => e.duration === "Still going" && !e.endedAt);
}

export function selectHistory(docs, filters = {}) {
  const { from = "", to = "", status = "", symptom = "", ongoing = false, query = "" } = filters;
  const between = date => (!from || date >= from) && (!to || date <= to);
  const contains = text => text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const days = listDays(docs).filter(d => between(d.date) && (!status || d.status === status) && contains([d.date, ...(d.entries || []).map(e => e.a)].join(" ")));
  const episodes = listEpisodes(docs).filter(([, e]) => between(e.when.slice(0, 10)) && (!symptom || (e.symptoms || []).includes(symptom)) && (!ongoing || e.duration === "Still going" && !e.endedAt) && contains([e.when, ...(e.symptoms || []), ...(e.before || []), e.notes || ""].join(" ")));
  return { days, episodes };
}

// Strip broken imported fields at the read boundary; retain the original document for recovery/export.
export function readableEpisode(e) {
  const names = value => Array.isArray(value) ? value.filter(x => typeof x === "string") : [];
  return { ...e, symptoms: names(e.symptoms), before: names(e.before), notes: typeof e.notes === "string" ? e.notes : "", onset: typeof e.onset === "string" ? e.onset : "", duration: typeof e.duration === "string" ? e.duration : "" };
}

// Existing captures retain their recorded offset when an end time is entered in another time zone.
export function validateEpisodeTimes(value, original = {}, now = new Date()) {
  const localInstant = text => new Date(text).getTime();
  const recordedInstant = (text, offset) => Date.parse(text + "Z") - offset * 60000;
  const start = value.when === original.when && Number.isFinite(original.whenOffset) ? recordedInstant(value.when, original.whenOffset) : localInstant(value.when);
  const end = value.endedAt === original.endedAt && Number.isFinite(original.endOffset) ? recordedInstant(value.endedAt, original.endOffset) : localInstant(value.endedAt);
  if (!value.when || !Number.isFinite(start) || start > now.getTime()) return ["ep-when", "Choose a valid start time that isn't in the future."];
  if (value.endedAt && (!Number.isFinite(end) || end < start || end > now.getTime())) return ["ep-ended", "End time must be between the start time and now, including the recorded time-zone offset."];
  return null;
}
