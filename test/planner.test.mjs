import test from "node:test";
import assert from "node:assert/strict";
import { applyOp, listDays, normaliseSettings } from "../web/model.js";
import {
  forecast,
  planId,
  plannedEntryId,
  energyFlow,
  planComparison,
} from "../web/planner-model.js";
const S = normaliseSettings({});
const date = "2026-10-03";
const work = { id: "work", a: "Deep focus", c: 8, t: "09:00" };
const rest = { id: "rest", a: "Quiet break", c: -3, t: "12:00" };
test("plans never create logged history days; recovery remains an estimate", () => {
  const docs = { [planId(date)]: { date, allowance: 6, entries: [work, rest] } };
  const f = forecast(docs, date, S);
  assert.equal(f.remaining, 6);
  assert.equal(f.afterWork, -2);
  assert.equal(f.projected, 1);
  assert.equal(f.shortfall, 2);
  assert.equal(f.gap, 0);
  assert.equal(listDays(docs).length, 0);
  assert.equal(forecast(docs, "2026-10-04", S).remaining, 10);
});
test("completion is idempotent and excludes the completed commitment using the actual cost", () => {
  const op = {
    id: "d-" + date,
    type: "addEntry",
    arg: { ...work, c: 5, id: plannedEntryId(date, work.id) },
    stamp: { budget: 10, sleepPenalty: 3 },
  };
  const day = applyOp(op);
  const twice = applyOp(op, day);
  assert.equal(twice.entries.length, 1);
  const docs = { [planId(date)]: { date, entries: [work, rest] }, ["d-" + date]: twice };
  const f = forecast(docs, date, S);
  assert.equal(f.done.length, 1);
  assert.equal(f.committed, 0);
  assert.equal(f.remaining, 5);
  assert.equal(f.projected, 8);
  assert.deepEqual(planComparison(docs, date), { total: 2, completed: 1, estimated: 8, actual: 5 });
  assert.equal(forecast({ ...docs, ["d-" + date]: { ...day, entries: [] } }, date, S).committed, 8);
});
test("logged check-ins and sleep supersede an estimated future allowance", () => {
  const docs = {
    [planId(date)]: { allowance: 9, entries: [work] },
    ["d-" + date]: {
      budget: 10,
      status: "amber",
      statusPenalty: 2,
      poorSleep: true,
      sleepPenalty: 3,
      entries: [{ c: -2 }],
    },
  };
  const f = forecast(docs, date, S);
  assert.equal(f.allowance, 5);
  assert.equal(f.remaining, 7);
  assert.equal(f.projected, -1);
  assert.deepEqual(energyFlow(f.day, S), { allowance: 5, spent: 0, recovered: 2, remaining: 7 });
});
test("planned operations replay and merge without losing other activities", () => {
  let body = applyOp({ id: planId(date), type: "addEntry", arg: work });
  body = applyOp({ id: planId(date), type: "addEntry", arg: rest }, body);
  body = applyOp({ id: planId(date), type: "addEntry", arg: work }, body);
  body = applyOp(
    { id: planId(date), type: "editEntry", arg: { id: "work", changes: { c: 4 } } },
    body,
  );
  assert.deepEqual(
    body.entries.map((x) => x.c),
    [4, -3],
  );
  body = applyOp({ id: planId(date), type: "removeEntry", arg: rest }, body);
  assert.equal(body.entries.length, 1);
});
