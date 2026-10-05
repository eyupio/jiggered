import test from "node:test";
import assert from "node:assert/strict";

const m = await import("../web/fretboard-model.js");
const model = await import("../web/model.js");

test("an empty or broken board normalises to a drawable one", () => {
  for (const raw of [undefined, null, 1, "x", [], {}, { items: [], axes: "no", three: "no" }]) {
    const b = m.normaliseBoard(raw);
    assert.deepEqual(b.items, {});
    assert.deepEqual(b.three, []);
    assert.deepEqual(b.axes, m.DEFAULT_AXES);
  }
});

test("items keep their position inside the canvas and a known status", () => {
  const b = m.normaliseBoard({
    items: {
      a: { k: "card", t: "Sleep", x: 1.4, y: -2, s: "weird", z: 3 },
      b: { k: "note", t: 42, x: "0.2", y: 0.3 },
      "bad id!": { t: "no" },
      c: "not an object",
      d: { k: "card", t: "x".repeat(500), x: 0.5, y: 0.5, w: 5 },
    },
  });
  assert.deepEqual(b.items.a, { k: "card", t: "Sleep", x: 1, y: 0, z: 3, s: "todo" });
  assert.deepEqual(b.items.b, { k: "note", t: "", x: 0.2, y: 0.3, z: 0 });
  assert.equal(b.items["bad id!"], undefined);
  assert.equal(b.items.c, undefined);
  assert.equal(b.items.d.t.length, m.TEXT_LIMIT);
  assert.equal(b.items.d.w, 1);
});

test("a patch sets and removes items by id and leaves the others alone", () => {
  const before = {
    items: {
      a: { k: "card", t: "A", x: 0.1, y: 0.1, s: "todo" },
      b: { k: "card", t: "B", x: 0.9, y: 0.9, s: "done" },
    },
    axes: { left: "Stress" },
  };
  const after = m.applyBoardPatch(
    {
      items: { a: null, c: { k: "note", t: "C", x: 0.5, y: 0.5 } },
      axes: { right: "Controlled", top: "" },
    },
    before,
  );
  assert.equal(after.items.a, undefined);
  assert.equal(after.items.b.t, "B");
  assert.equal(after.items.c.k, "note");
  assert.equal(after.axes.left, "Stress");
  assert.equal(after.axes.right, "Controlled");
  assert.equal(after.axes.top, m.DEFAULT_AXES.top, "a blank label falls back to the default");
  assert.equal(after.axes.bottom, m.DEFAULT_AXES.bottom);
});

test("two devices moving different cards both keep their change when the queue replays", () => {
  const server = {
    items: {
      a: { k: "card", t: "A", x: 0.1, y: 0.1, s: "todo" },
      b: { k: "card", t: "B", x: 0.2, y: 0.2, s: "todo" },
    },
  };
  const phone = m.applyBoardPatch({ items: { a: { ...server.items.a, x: 0.8 } } }, server);
  const laptop = m.applyBoardPatch({ items: { b: { ...server.items.b, s: "done" } } }, phone);
  assert.equal(laptop.items.a.x, 0.8);
  assert.equal(laptop.items.b.s, "done");
});

test("the sync model applies boardPatch like any other operation", () => {
  const doc = model.applyOp(
    {
      id: m.BOARD_ID,
      type: "boardPatch",
      arg: {
        items: { a: { k: "card", t: "A", x: 0.6, y: 0.2 } },
        three: [{ id: "t1", t: "Walk" }],
      },
    },
    undefined,
  );
  assert.equal(doc.tool, "fretboard");
  assert.equal(doc.items.a.s, "todo");
  assert.deepEqual(doc.three, [{ id: "t1", t: "Walk", done: false }]);
  assert.ok(model.isToolId("t-fretboard"));
  assert.ok(!model.isToolId("t-"));
  assert.ok(!model.isToolId("t-Fretboard"));
});

test("three things are bounded and keep their card link only when it is a valid id", () => {
  const b = m.normaliseBoard({
    three: Array.from({ length: 20 }, (_, i) => ({
      id: "t" + i,
      t: "x",
      done: "yes",
      card: i % 2 ? "c1" : "bad id",
    })),
    threeDate: "2026-10-05",
  });
  assert.equal(b.three.length, m.THREE_LIMIT);
  assert.equal(b.three[0].done, false);
  assert.equal(b.three[0].card, undefined);
  assert.equal(b.three[1].card, "c1");
  assert.equal(b.threeDate, "2026-10-05");
  assert.equal(m.normaliseBoard({ threeDate: "yesterday" }).threeDate, "");
});

test("quadrants read right as in your hands and up as matters most", () => {
  assert.deepEqual(m.quadrantOf({ x: 0.9, y: 0.1 }), { control: "yours", priority: "high" });
  assert.deepEqual(m.quadrantOf({ x: 0.1, y: 0.9 }), { control: "beyond", priority: "low" });
  assert.deepEqual(m.quadrantOf({ x: 0.5, y: 0.5 }), { control: "yours", priority: "low" });
});

test("the summary counts the board the way a person reads it", () => {
  const b = m.normaliseBoard({
    items: {
      a: { k: "card", t: "A", x: 0.8, y: 0.1, s: "todo" },
      b: { k: "card", t: "B", x: 0.9, y: 0.2, s: "done" },
      c: { k: "card", t: "C", x: 0.1, y: 0.2, s: "external" },
      d: { k: "card", t: "D", x: 0.2, y: 0.8, s: "doing" },
      e: { k: "note", t: "E", x: 0.5, y: 0.5 },
    },
  });
  const s = m.summarise(b);
  assert.equal(s.cards, 4);
  assert.equal(s.notes, 1);
  assert.equal(s.yoursHigh, 2);
  assert.equal(s.beyondHigh, 1);
  assert.equal(s.beyondLow, 1);
  assert.equal(s.weight, 1, "an open card that matters and is out of your hands");
  assert.deepEqual(s.byStatus, { todo: 1, doing: 1, done: 1, external: 1 });
});

test("suggestions come from in your hands first, highest first, skipping done, not mine and already listed", () => {
  const b = m.normaliseBoard({
    items: {
      low: { k: "card", t: "Low", x: 0.9, y: 0.9, s: "todo" },
      high: { k: "card", t: "High", x: 0.6, y: 0.1, s: "todo" },
      done: { k: "card", t: "Done", x: 0.9, y: 0.05, s: "done" },
      theirs: { k: "card", t: "Theirs", x: 0.9, y: 0.05, s: "external" },
      beyond: { k: "card", t: "Beyond", x: 0.1, y: 0.05, s: "doing" },
      listed: { k: "card", t: "Listed", x: 0.95, y: 0.02, s: "todo" },
      blank: { k: "card", t: "  ", x: 0.95, y: 0.02, s: "todo" },
    },
    three: [{ id: "x", t: "Listed", card: "listed" }],
  });
  assert.deepEqual(
    m.suggestThree(b).map((c) => c.id),
    ["high", "low", "beyond"],
  );
  assert.deepEqual(
    m.suggestThree(b, 1).map((c) => c.id),
    ["high"],
  );
});

test("the example board is drawable and nextZ stacks above everything", () => {
  const b = m.normaliseBoard(m.exampleBoard("2026-10-05"));
  assert.ok(Object.keys(b.items).length > 3);
  assert.equal(b.threeDate, "2026-10-05");
  assert.equal(m.nextZ(b), Math.max(...Object.values(b.items).map((i) => i.z)) + 1);
  assert.equal(m.nextZ(m.emptyBoard()), 1);
});

test("field patches merge with another device's change to the same card and never bring back a deleted one", () => {
  const server = m.normaliseBoard({
    items: {
      a: { k: "card", t: "Pay bill", x: 0.6, y: 0.2, z: 1, s: "done" },
      b: { k: "card", t: "Call", x: 0.7, y: 0.3, z: 2, s: "todo" },
    },
  });
  // A stale device moved card a (it still thinks the card is "todo"); only x and y travel.
  const moved = m.applyBoardPatch({ fields: { a: { x: 0.9, y: 0.1 } } }, server);
  assert.equal(moved.items.a.s, "done", "the other device's status survives");
  assert.equal(moved.items.a.x, 0.9);
  // Either order gives the same card.
  const both = m.applyBoardPatch({ fields: { a: { s: "doing" } } }, moved);
  assert.deepEqual([both.items.a.x, both.items.a.s], [0.9, "doing"]);
  // A late edit to a card deleted elsewhere is dropped.
  const gone = m.applyBoardPatch({ items: { b: null } }, server);
  assert.equal(m.applyBoardPatch({ fields: { b: { x: 0.2 } } }, gone).items.b, undefined);
});

test("the summary counts what can be read: an empty, never-typed card is not one of them", () => {
  const b = m.normaliseBoard({
    items: {
      a: { k: "card", t: "Real", x: 0.7, y: 0.2, z: 1, s: "todo" },
      ghost: { k: "card", t: "  ", x: 0.1, y: 0.1, z: 2, s: "todo" },
      n: { k: "note", t: "", x: 0.2, y: 0.8, z: 3 },
    },
  });
  const s = m.summarise(b);
  assert.equal(s.cards, 1);
  assert.equal(s.notes, 0);
  assert.equal(
    s.weight,
    0,
    "the ghost does not become 'one thing that matters and is out of your hands'",
  );
  assert.equal(s.yoursHigh, 1);
});
