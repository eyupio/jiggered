import test from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Europe/London";
const m = await import("../web/model.js");

test("addDays works on calendar days, across months, years and clock changes", () => {
  assert.equal(m.addDays("2026-01-31", 1), "2026-02-01");
  assert.equal(m.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(m.addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(m.addDays("2026-03-28", 1), "2026-03-29"); // clocks go forward on the 29th
  assert.equal(m.addDays("2026-03-29", 1), "2026-03-30"); // a 23-hour day
  assert.equal(m.addDays("2026-10-24", 2), "2026-10-26"); // a 25-hour day in between
  assert.equal(m.addDays("2026-10-01", -13), "2026-09-18");
});

test("dkey and hhmm use the local calendar", () => {
  const d = new Date(2026, 8, 30, 23, 5);
  assert.equal(m.dkey(d), "2026-09-30");
  assert.equal(m.hhmm(d), "23:05");
  assert.equal(m.nowLocal(d), "2026-09-30T23:05");
  assert.equal(m.dayId("2026-09-30"), "d-2026-09-30");
  assert.ok(m.isDayId("d-2026-09-30") && !m.isDayId("e-1") && !m.isDayId("d-2026-9-30"));
  assert.ok(m.isEpisodeId("e-1790000000000") && !m.isEpisodeId("e-") && !m.isEpisodeId("d-2026-09-30"));
});

test("normaliseSettings: nothing stored means the defaults", () => {
  for (const raw of [undefined, null, 5, "x", [], {}]) {
    const s = m.normaliseSettings(raw);
    assert.equal(s.budget, 10);
    assert.equal(s.sleepPenalty, 3);
    assert.equal(s.locale, "en-GB");
    assert.deepEqual(s.activities, m.DEFAULTS.activities);
    assert.deepEqual(s.symptoms, m.DEFAULTS.symptoms);
    assert.deepEqual(s.triggers, m.DEFAULTS.triggers);
  }
  const a = m.normaliseSettings({});
  a.activities[0].c = 99;
  assert.notEqual(m.DEFAULTS.activities[0].c, 99, "defaults must not be shared or mutable through the result");
});

test("normaliseSettings: validates and clamps", () => {
  const s = m.normaliseSettings({
    budget: "14", sleepPenalty: 99, locale: "xx-XX",
    activities: [{ a: "  Gym  ", c: 4.4 }, { a: "", c: 1 }, { a: "Free", c: 0 }, { a: "Too much", c: 50 }, { a: "Bad", c: "x" }, null, { a: "Rest", c: -3 }],
    symptoms: ["Cough", "cough", " Cough ", "", 5, "Sore throat"], triggers: [],
  });
  assert.equal(s.budget, 14);
  assert.equal(s.sleepPenalty, 3, "an out-of-range penalty falls back to the default");
  assert.equal(s.locale, "en-GB");
  assert.deepEqual(s.activities, [{ a: "Gym", c: 4 }, { a: "Free", c: 0 }, { a: "Rest", c: -3 }]);
  assert.deepEqual(s.symptoms, ["Cough", "cough", "Sore throat"].filter((x, i, l) => l.indexOf(x) === i));
  assert.deepEqual(s.triggers, [], "a list that is present but empty stays empty");
  assert.equal(m.normaliseSettings({ budget: 0 }).budget, 10);
  assert.equal(m.normaliseSettings({ budget: 31 }).budget, 10);
  assert.equal(m.normaliseSettings({ budget: 2, sleepPenalty: 3 }).sleepPenalty, 2, "the penalty can't exceed the budget");
  assert.equal(m.normaliseSettings({ locale: "" }).locale, "", "browser default is a valid choice");
  assert.equal(m.normaliseSettings({ locale: "de-DE" }).locale, "de-DE");
  const long = m.normaliseSettings({ symptoms: ["x".repeat(200)], activities: [{ a: "y".repeat(200), c: 1 }] });
  assert.equal(long.symptoms[0].length, 60);
  assert.equal(long.activities[0].a.length, 60);
  const many = m.normaliseSettings({ symptoms: Array.from({ length: 100 }, (_, i) => "s" + i) });
  assert.equal(many.symptoms.length, 40);
});

test("a day's budget: spent, cap, poor sleep, and remembered settings", () => {
  const S = m.normaliseSettings({});
  const d = { date: "2026-10-01", poorSleep: false, entries: [{ c: 2 }, { c: 3 }, { c: -1 }] };
  assert.equal(m.used(d), 4);
  assert.equal(m.capOf(d, S), 10);
  assert.equal(m.capOf({ ...d, poorSleep: true }, S), 7);
  assert.equal(m.used({ entries: [] }), 0);
  assert.equal(m.used({}), 0);
  // A day made under a 12-point budget keeps it when the settings later change.
  const old = { ...d, budget: 12, sleepPenalty: 4, poorSleep: true };
  assert.equal(m.capOf(old, S), 8);
  assert.equal(m.capOf({ ...d, poorSleep: true }, { ...S, budget: 20, sleepPenalty: 5 }), 15, "unstamped (older) days follow the current settings");
});

test("operations", () => {
  const id = "d-2026-10-01";
  const stamp = { budget: 12, sleepPenalty: 4 };
  let d = m.applyOp({ id, type: "setStatus", arg: "amber", stamp }, undefined);
  assert.deepEqual(d, { date: "2026-10-01", status: "amber", poorSleep: false, entries: [], budget: 12, sleepPenalty: 4 }, "the first change creates the day and stamps the budget");
  d = m.applyOp({ id, type: "setStatus", arg: null, stamp: { budget: 99, sleepPenalty: 9 } }, d);
  assert.equal(d.status, null);
  assert.equal(d.budget, 12, "an existing stamp is kept");
  d = m.applyOp({ id, type: "setPoorSleep", arg: true }, d);
  assert.equal(d.poorSleep, true);

  const e1 = { id: "a1", a: "Meeting", c: 2, t: "10:00" };
  const e2 = { id: "a2", a: "Meeting", c: 2, t: "10:00" };
  d = m.applyOp({ id, type: "addEntry", arg: e1 }, d);
  d = m.applyOp({ id, type: "addEntry", arg: e1 }, d);
  assert.equal(d.entries.length, 1, "replaying an add must not add it twice");
  d = m.applyOp({ id, type: "addEntry", arg: e2 }, d);
  assert.equal(d.entries.length, 2, "two identical-looking entries with different ids are two entries");
  d = m.applyOp({ id, type: "removeEntry", arg: e2 }, d);
  assert.deepEqual(d.entries.map(e => e.id), ["a1"]);
  d = m.applyOp({ id, type: "removeEntry", arg: e2 }, d);
  assert.equal(d.entries.length, 1, "removing something already gone changes nothing");

  const legacy = { date: "2026-10-01", status: "green", poorSleep: false, entries: [{ a: "Quiet break", c: -1, t: "09:00" }, { a: "Quiet break", c: -1, t: "09:00" }] };
  const after = m.applyOp({ id, type: "removeEntry", arg: { a: "Quiet break", c: -1, t: "09:00" } }, legacy);
  assert.equal(after.entries.length, 1, "entries from before ids existed are matched by content, one at a time");
  assert.equal(legacy.entries.length, 2, "ops never mutate their input");

  assert.deepEqual(m.applyOp({ id, type: "restamp", arg: { budget: 8, sleepPenalty: 2 } }, d).budget, 8);
  assert.equal(m.applyOp({ id, type: "remove" }, d), undefined);
  assert.deepEqual(m.applyOp({ id, type: "replace", arg: { x: 1 } }, d), { x: 1 });
  assert.deepEqual(m.applyOp({ id, type: "addEntry", arg: e1 }, { date: "2026-10-01" }).entries, [e1], "a doc missing its entries array is repaired");
  assert.throws(() => m.applyOp({ id, type: "nonsense" }, d), /unknown operation/);
});

test("listing days and episodes", () => {
  const docs = {
    "d-2026-09-29": { date: "2026-09-29" }, "d-2026-10-01": { date: "2026-10-01" }, "d-2026-09-30": { date: "2026-09-30" },
    "e-2": { when: "2026-09-30T08:00" }, "e-1": { when: "2026-10-01T08:00" }, "e-3": {}, settings: { budget: 9 },
  };
  assert.deepEqual(m.listDays(docs).map(d => d.date), ["2026-10-01", "2026-09-30", "2026-09-29"]);
  assert.deepEqual(m.listEpisodes(docs).map(([id]) => id), ["e-1", "e-2"], "newest first; broken ones skipped");
});

test("trends", () => {
  const S = m.normaliseSettings({});
  const day = (date, status, extra = {}) => ({ date, status, poorSleep: false, entries: [], ...extra });
  const docs = {
    "d-2026-10-01": day("2026-10-01", "red", { poorSleep: true, entries: [{ c: 4 }] }),
    "d-2026-09-30": day("2026-09-30", "green", { entries: [{ c: 1 }] }),
    "d-2026-09-29": day("2026-09-29", "amber", { poorSleep: true, entries: [{ c: 3 }, { c: 2 }] }),
    "d-2026-09-28": day("2026-09-28", null),
    "d-2026-08-01": day("2026-08-01", "red"), // outside the 30-day window
    "e-1": { when: "2026-10-01T09:00", symptoms: ["Headache", "Weakness"], before: ["Poor sleep", "High stress"] },
    "e-2": { when: "2026-09-20T09:00", symptoms: ["Headache"], before: ["Poor sleep"] },
    "e-3": { when: "2026-08-15T09:00", symptoms: ["Weakness"], before: ["Alcohol"] },
    "e-4": { when: "2026-06-01T09:00", symptoms: ["Cough"], before: ["Alcohol"] }, // older than 90 days
  };
  const t = m.trends(docs, S, "2026-10-01", 30);
  assert.equal(t.green, 1); assert.equal(t.amber, 1); assert.equal(t.red, 1);
  assert.equal(t.unchecked, 27, "30 days minus the 3 with a check-in");
  assert.equal(t.avgUsed, 2.5, "(4 + 1 + 5 + 0) / 4 days with a doc");
  assert.equal(t.poorSleepDays, 2); assert.equal(t.poorSleepBad, 2);
  assert.equal(t.episodes30, 2); assert.equal(t.episodes90, 3);
  assert.deepEqual(t.topTriggers[0], ["Poor sleep", 2]);
  assert.deepEqual(t.topSymptoms[0], ["Headache", 2]);
  assert.ok(!t.topTriggers.some(([n]) => n === "Cough"), "episodes older than 90 days don't count");
  assert.equal(m.trends({}, S, "2026-10-01").avgUsed, null);
});

test("csvCell quotes and defuses formulas", () => {
  assert.equal(m.csvCell("plain"), "plain");
  assert.equal(m.csvCell('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(m.csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(m.csvCell(null), "");
  assert.equal(m.csvCell(7), "7");
  for (const bad of ["=1+1", "+1", "-1", "@SUM(A1)", "\tx"]) assert.ok(m.csvCell(bad).startsWith("'"), bad);
  assert.equal(m.csvCell("a=b"), "a=b");
});

test("CSV exports", () => {
  const S = m.normaliseSettings({});
  const docs = {
    "d-2026-10-01": { date: "2026-10-01", status: "amber", poorSleep: true, entries: [{ a: "Meeting or call", c: 2, t: "10:15" }, { a: "Quiet break", c: -1, t: "" }] },
    "d-2026-09-30": { date: "2026-09-30", status: null, poorSleep: false, entries: [] },
    "e-1": { when: "2026-10-01T09:00", symptoms: ["Headache", "Weakness"], onset: "Sudden", duration: "Still going", before: ["Poor sleep"], notes: '=HYPERLINK("x"), café' },
  };
  const days = m.daysCsv(docs, S).split("\r\n");
  assert.equal(days[0], "date,check_in,poor_sleep,points_used,points_available,activities");
  assert.equal(days[1], "2026-09-30,,no,0,10,");
  assert.equal(days[2], "2026-10-01,amber,yes,1,7,10:15 Meeting or call (-2); Quiet break (+1)");
  assert.equal(days[3], "");
  const eps = m.episodesCsv(docs).split("\r\n");
  assert.equal(eps[0], "started,symptoms,how_it_came_on,how_long,in_the_day_or_two_before,notes,ended_local,start_time_zone,start_utc_offset_minutes,end_time_zone,end_utc_offset_minutes");
  assert.equal(eps[1], `2026-10-01T09:00,Headache; Weakness,Sudden,Still going,Poor sleep,"'=HYPERLINK(""x""), café",,,,,`);
});

test("clinician summary", () => {
  const docs = {
    "d-2026-10-01": { date: "2026-10-01", status: "red", poorSleep: true, entries: [{ c: 3 }] },
    "d-2026-09-20": { date: "2026-09-20", status: "green", poorSleep: false, entries: [] },
    "d-2026-06-01": { date: "2026-06-01", status: "amber", poorSleep: false, entries: [] },
    "e-1": { when: "2026-10-01T09:00", symptoms: ["Headache"], before: ["Poor sleep"] },
    "e-2": { when: "2026-06-01T09:00", symptoms: ["Weakness"], before: [] },
  };
  const S = m.normaliseSettings({});
  const s30 = m.summary(docs, S, "30", "2026-10-01");
  assert.equal(s30.from, "2026-09-02"); assert.equal(s30.to, "2026-10-01");
  assert.equal(s30.days.length, 2); assert.equal(s30.episodes.length, 1);
  assert.equal(s30.red, 1); assert.equal(s30.green, 1); assert.equal(s30.amber, 0);
  assert.equal(s30.avgUsed, 1.5); assert.equal(s30.poorSleepDays, 1);
  const all = m.summary(docs, S, "all", "2026-10-01");
  assert.equal(all.days.length, 3); assert.equal(all.episodes.length, 2);
  assert.equal(all.from, "2026-06-01", "'everything' starts at the first day with data");
  assert.equal(m.summary({}, S, "all", "2026-10-01").from, "2026-10-01");
});

test("csvCell leaves numbers alone: -2 is a number, not a formula", () => {
  assert.equal(m.csvCell(-2), "-2");
  assert.equal(m.csvCell("-2"), "'-2");
  assert.equal(m.csvCell("=SUM(A1)"), "'=SUM(A1)");
});


test("reports exclude future episodes and all-time dates include episode-only history", () => {
  const docs = {"e-1":{when:"2024-01-01T10:00",symptoms:["Headache"]},"e-2":{when:"2026-10-02T00:00",symptoms:["Future"]},"e-3":{when:"2026-10-01T23:59",before:["Poor sleep"]}};
  assert.equal(m.trends(docs,m.normaliseSettings(),"2026-10-01").episodes30,1);
  const sm=m.summary(docs,m.normaliseSettings(),"all","2026-10-01");assert.equal(sm.from,"2024-01-01");assert.equal(sm.episodes.length,2);
});
test("settings validation preserves zero but rejects silent truncation, duplicates and rounding", () => {
  const good={...m.normaliseSettings(),activities:[{a:"Observe",c:0}],symptoms:[],triggers:[]};
  assert.deepEqual(m.validateSettings(good),[]);
  for(const patch of [{budget:"2.5"},{budget:""},{sleepPenalty:11},{activities:[{a:"Walk",c:1},{a:"walk",c:2}]},{symptoms:["x".repeat(61)]},{triggers:Array.from({length:41},(_,i)=>String(i))}])assert.ok(m.validateSettings({...good,...patch}).length);
});
test("history filters use the same interval and never mutate source data",()=>{
 const docs={"d-2026-10-01":{date:"2026-10-01",status:"amber",entries:[{a:"Work",c:1}]},"e-1":{when:"2026-10-01T10:00",symptoms:["Headache"],duration:"Still going",notes:"Work"},"e-2":{when:"2026-09-01T10:00",symptoms:["Headache"],duration:"Under 15 min"}};
 assert.equal(m.selectHistory(docs,{from:"2026-10-01",to:"2026-10-01",query:"work",status:"amber",ongoing:true,symptom:"Headache"}).episodes.length,1);
 assert.equal(m.selectHistory(docs,{query:"no-match"}).days.length,0);
 assert.equal(m.ongoingEpisodes(docs).length,1);assert.equal(m.ongoingEpisodes({...docs,"e-1":{...docs["e-1"],endedAt:"2026-10-01T12:00"}}).length,0);
 assert.equal(m.balanceLabel(-2,10),"2 over your planned budget");assert.equal(m.balanceLabel(30,10),"20 above the starting budget");
});

test('episode chronology uses recorded offsets across zones and supports overnight completion',()=>{
 const original={when:'2026-10-01T09:00',whenOffset:-240};
 assert.equal(m.validateEpisodeTimes({when:original.when,endedAt:m.nowLocal(new Date('2026-10-01T12:00Z'))},original,new Date('2026-10-01T20:00Z'))?.[0],'ep-ended');
 assert.equal(m.validateEpisodeTimes({when:'2026-09-30T23:00',endedAt:'2026-10-01T01:00'},{},new Date('2026-10-01T20:00Z')),null);
});
