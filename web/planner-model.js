import { capOf, dayId, readableDay, used } from "./model.js";
import { byTime } from "./calendar-model.js";

export const planId = (date) => `p-${date}`;
export const plannedEntryId = (date, id) => `planned:${date}:${id}`;
// In the order of the day: timed rows by start time, then the ones with no time.
export const planRows = (plan) =>
  Array.isArray(plan?.entries) ? [...plan.entries].sort(byTime) : [];
export function energyFlow(day, settings) {
  const spent = day.entries.reduce((n, e) => n + Math.max(0, e.c), 0);
  const recovered = day.entries.reduce((n, e) => n + Math.max(0, -e.c), 0);
  const allowance = capOf(day, settings);
  return { allowance, spent, recovered, remaining: allowance - spent + recovered };
}
// Planned recovery is never included in the balance available now. Plans have their
// own document namespace, keeping unlogged days out of clinical/history reporting.
export function forecast(docs, date, settings) {
  const plan = docs[planId(date)] || {};
  const day = readableDay(docs[dayId(date)], date);
  const logged = !!docs[dayId(date)];
  const allowance = logged ? capOf(day, settings) : (plan.allowance ?? settings.budget);
  const rows = planRows(plan);
  const done = rows.filter((e) => day.entries.some((a) => a.id === plannedEntryId(date, e.id)));
  const pending = rows.filter((e) => !done.includes(e));
  const committed = pending.reduce((n, e) => n + Math.max(0, e.c), 0);
  const recovery = pending.reduce((n, e) => n + Math.max(0, -e.c), 0);
  const remaining = allowance - used(day);
  const afterWork = remaining - committed;
  return {
    plan,
    day,
    logged,
    allowance,
    rows,
    done,
    pending,
    committed,
    recovery,
    remaining,
    afterWork,
    projected: afterWork + recovery,
    shortfall: Math.max(0, -afterWork),
    gap: Math.max(0, -(afterWork + recovery)),
  };
}
export function planComparison(docs, date) {
  const rows = planRows(docs[planId(date)]);
  if (!rows.length) return null;
  const entries = readableDay(docs[dayId(date)], date).entries;
  const completed = rows.filter((r) => entries.some((e) => e.id === plannedEntryId(date, r.id)));
  const estimated = completed.reduce((n, r) => n + r.c, 0);
  const actual = entries
    .filter((e) => completed.some((r) => e.id === plannedEntryId(date, r.id)))
    .reduce((n, e) => n + e.c, 0);
  return { total: rows.length, completed: completed.length, estimated, actual };
}
