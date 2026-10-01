import test from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Europe/London";
const p = await import("../web/picker.js");
const m = await import("../web/model.js");

test("matches ignores case and accents and needs every word", () => {
  assert.ok(p.matches("cafe walk", "Walk to the Café"));
  assert.ok(p.matches("", "anything"));
  assert.ok(!p.matches("walk run", "Walk"));
});

const docs = {
  "d-2026-09-30": { entries: [{ a: "Walk", c: -2, t: "09:00" }, { a: "Call", c: 2, t: "10:00" }] },
  "d-2026-09-29": { entries: [{ a: "Walk", c: -2, t: "08:00" }, { a: "Nap", c: -1, t: "14:00" }] },
  "d-2026-01-01": { entries: [{ a: "Old", c: 1, t: "08:00" }] },
  "e-1": { when: "2026-09-30T08:00", symptoms: ["Dizzy"], before: ["Poor sleep"] },
};

test("usage counts recent use only, with the latest time", () => {
  const u = p.usage(docs, "2026-10-01");
  assert.equal(u.acts.get("Walk").n, 2);
  assert.equal(u.acts.get("Walk").last, "2026-09-30T09:00");
  assert.equal(u.acts.has("Old"), false);
  assert.equal(u.sym.get("Dizzy").n, 1);
  assert.equal(u.trig.get("Poor sleep").n, 1);
});

test("favourites put often-used names first, then the latest used", () => {
  const u = p.usage(docs, "2026-10-01").acts;
  assert.deepEqual(p.favourites(["Call", "Nap", "Walk", "Never"], u, 3), ["Walk", "Call", "Nap"]);
  assert.deepEqual(p.favourites(["Never"], u), []);
});

test("groupItems keeps list order, groups by first appearance and puts ungrouped last", () => {
  const items = [{ a: "1", g: "Home" }, { a: "2" }, { a: "3", g: "Work" }, { a: "4", g: "Home" }];
  const g = p.groupItems(items);
  assert.deepEqual(g.map(x => [x.name, x.rows.map(r => r.i)]), [["Home", [0, 3]], ["Work", [2]], ["Ungrouped", [1]]]);
  assert.deepEqual(p.groupItems([{ a: "x" }]).map(x => x.name), [""]);
  assert.deepEqual(p.groupNames(items), ["Home", "Work"]);
});

test("settings keep an optional activity group and allow 200 items", () => {
  const s = m.normaliseSettings({ activities: [{ a: "A", c: 1, g: " Work " }, { a: "B", c: 1, g: "  " }] });
  assert.equal(s.activities[0].g, "Work");
  assert.equal("g" in s.activities[1], false);
  const many = Array.from({ length: 250 }, (_, i) => ({ a: "n" + i, c: 1 }));
  assert.equal(m.normaliseSettings({ activities: many }).activities.length, 200);
  assert.ok(m.validateSettings({ ...m.normaliseSettings({}), activities: [{ a: "A", c: 1, g: "x".repeat(31) }] }).length > 0);
});

test("a group change merges onto a newer copy without touching other fields", () => {
  const before = [{ id: "1", a: "A", c: 1 }], next = [{ id: "1", a: "A", c: 1, g: "Work" }], current = [{ id: "1", a: "A", c: 2 }];
  const out = m.applyOp({ type: "settingsPatch", arg: { activities: next }, before: { activities: before } }, { activities: current });
  assert.deepEqual(out.activities, [{ id: "1", a: "A", c: 2, g: "Work" }]);
});
