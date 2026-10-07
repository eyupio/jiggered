// Fretboard: a canvas for what is fretting you. Cards go left or right by how much they are in your hands and up or down
// by how much they matter; the tray beside it holds today's three things. Everything is one board document, edited
// through boardPatch operations so two devices merge card by card (see fretboard-model.js).
import { $, html, setHTML, uid, fmtDay } from "./util.js";
import {
  BOARD_ID,
  DEFAULT_AXES,
  QUADRANT_HINTS,
  STATUSES,
  STATUS_ORDER,
  TEXT_LIMIT,
  THREE_LIMIT,
  ITEM_LIMIT,
  exampleBoard,
  nextZ,
  normaliseBoard,
  quadrantOf,
  suggestThree,
  summarise,
} from "./fretboard-model.js";

const DRAG_THRESHOLD = 4; // px before a press becomes a drag, so a tap still selects
const LONG_PRESS = 550; // ms before a touch opens the menu
const NUDGE = 0.01; // one arrow press moves a card this fraction of the canvas; Shift makes it five
const READ_ONLY = "Use the active Jiggered tab to make changes.";

const round3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const meta = {
  id: "fretboard",
  name: "Fretboard",
  eyebrow: "See what is fretting you",
  tagline:
    "Lay it all out. Right means it is in your hands; up means it matters now. Then choose today's three.",
  description:
    "A board for the things on your mind. Drop each one where it belongs, colour it by where it stands, and keep what is not yours in its place.",
};

export function mount(ctx, root) {
  let board = normaliseBoard(ctx.store.view(BOARD_ID));
  const saved = ctx.ui?.get("tools")?.fretboard || {};
  const hidden = new Set(
    Array.isArray(saved.hidden) ? saved.hidden.filter((s) => Object.hasOwn(STATUSES, s)) : [],
  );
  const selected = new Set();
  const undoStack = [],
    redoStack = [];
  let editing = null; // id of the item whose text is being typed
  let drag = null; // { ids, startX, startY, origin: {id: {x,y}}, moved, pointerId, target }
  let marquee = null; // { x, y } in canvas pixels
  let pressTimer = null;
  let visible = false;
  let lastPointer = { x: 0.5, y: 0.5 }; // where the mouse last was over the canvas, for "add here" and pasting

  setHTML(
    root,
    html`<div class="fb" id="fb">
      <div class="fb-toolbar">
        <div class="fb-tools">
          <button type="button" class="primary small" data-fb="add-card">+ Card</button>
          <button type="button" class="secondary small" data-fb="add-note">+ Note</button>
          <div class="fb-legend" role="group" aria-label="Show cards by status" id="fb-legend">
            <span class="fb-legend-label" aria-hidden="true">Show:</span>
            ${STATUS_ORDER.map(
              (s) =>
                html`<button type="button" class="fb-legend-item" data-status="${s}" aria-pressed="true"><span class="fb-swatch fb-s-${s}"></span>${STATUSES[s].label}</button>`,
            )}
          </div>
        </div>
        <div class="fb-tools fb-tools-end">
          <button type="button" class="ghost" data-fb="undo" title="Undo (Ctrl+Z)">Undo</button>
          <button type="button" class="ghost" data-fb="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button type="button" class="help-link x" data-help="fretboard">How it works</button>
        </div>
      </div>
      <div class="fb-actions" id="fb-actions" role="group" aria-label="What to do with the selection" hidden>
        <span class="meta" id="fb-actions-label"></span>
        <span class="fb-set" role="group" aria-label="Set the status of the selected cards">
          ${STATUS_ORDER.map(
            (s) =>
              html`<button type="button" class="fb-set-button" data-set-status="${s}" aria-pressed="false" aria-label="Set to ${STATUSES[s].label}"><span class="fb-swatch fb-s-${s}"></span>${STATUSES[s].short}</button>`,
          )}
        </span>
        <button type="button" class="secondary small" data-fb="edit-selected">Edit text</button>
        <button type="button" class="secondary small" data-fb="three-selected">Add to today's three</button>
        <button type="button" class="secondary small is-danger" data-fb="delete-selected">Delete</button>
      </div>
      <button type="button" class="skip-inline" data-fb="skip-board">
        Skip the board, go to today's three
      </button>
      <div class="fb-stage">
        <div class="fb-board">
          <div class="fb-axis fb-axis-x">
            <span class="fb-arrow" aria-hidden="true">◀</span>
            <button type="button" class="fb-axis-label" data-axis="left"></button>
            <span class="fb-axis-rule" aria-hidden="true"></span>
            <button type="button" class="fb-axis-label" data-axis="right"></button>
            <span class="fb-arrow" aria-hidden="true">▶</span>
          </div>
          <div class="fb-row">
            <div class="fb-axis fb-axis-y">
              <span class="fb-arrow" aria-hidden="true">▲</span>
              <button type="button" class="fb-axis-label" data-axis="top"></button>
              <span class="fb-axis-rule" aria-hidden="true"></span>
              <button type="button" class="fb-axis-label" data-axis="bottom"></button>
              <span class="fb-arrow" aria-hidden="true">▼</span>
            </div>
            <div
              class="fb-canvas"
              id="fb-canvas"
              tabindex="0"
              role="application"
              aria-label="Fretboard canvas. Double-click to add a card, drag to move, right-click for options."
            >
              <div class="fb-line fb-line-v"></div>
              <div class="fb-line fb-line-h"></div>
              ${["beyond:high", "yours:high", "beyond:low", "yours:low"].map(
                (q) =>
                  html`<div class="fb-quad" data-quad="${q}"><span>${QUADRANT_HINTS[q]}</span></div>`,
              )}
              <div class="fb-items" id="fb-items"></div>
              <div class="fb-marquee" id="fb-marquee" hidden></div>
              <div class="fb-empty" id="fb-empty" hidden>
                <p><b>Nothing on the board yet.</b></p>
                <p>Double-click anywhere to add the first thing on your mind, or tap + Card.</p>
                <button type="button" class="secondary small" data-fb="example">
                  Start with an example
                </button>
              </div>
            </div>
          </div>
        </div>
        <aside class="fb-tray" aria-labelledby="fb-three-title">
          <div class="fb-tray-head">
            <h3 id="fb-three-title">Today's three</h3>
            <span class="meta" id="fb-three-date"></span>
          </div>
          <p class="meta">The immediate plan. Small, concrete and yours.</p>
          <ol class="fb-three" id="fb-three"></ol>
          <p class="fb-three-note meta" id="fb-three-note" hidden></p>
          <form class="fb-three-form" id="fb-three-form">
            <label class="sr-only" for="fb-three-input">A thing for today</label>
            <input
              id="fb-three-input"
              type="text"
              maxlength="${TEXT_LIMIT}"
              placeholder="One thing for today…"
              autocomplete="off"
            />
            <button type="submit" class="secondary small">Add</button>
          </form>
          <div class="fb-tray-actions">
            <button type="button" class="x" data-fb="suggest">Suggest from the board</button>
            <button type="button" class="x" data-fb="three-fresh">Start fresh</button>
          </div>
        </aside>
      </div>
      <p class="fb-summary meta" id="fb-summary" role="status" aria-live="polite"></p>
      <p class="fb-status meta" id="fb-status" role="status" aria-live="polite"></p>
      <div class="fb-menu" id="fb-menu" role="menu" hidden></div>
    </div>`,
  );

  const canvas = $("fb-canvas"),
    layer = $("fb-items"),
    menu = $("fb-menu"),
    marqueeEl = $("fb-marquee");
  const nodes = new Map(); // id -> element

  // ---- saving ----
  const writable = () => !ctx.store.status().readOnly && !ctx.store.status().restoring;
  const refuse = () => {
    ctx.toast(
      ctx.store.status().restoring
        ? "Restore is in progress. Try again when it finishes."
        : READ_ONLY,
    );
    return false;
  };
  // inverse works out the patch that takes the board back, before the patch is applied.
  function inverse(patch) {
    const back = {};
    if (patch.items) {
      back.items = {};
      for (const id of Object.keys(patch.items))
        back.items[id] = board.items[id] ? { ...board.items[id] } : null;
    }
    if (patch.axes) back.axes = { ...board.axes };
    if (patch.three) back.three = board.three.map((t) => ({ ...t }));
    if (patch.threeDate !== undefined) back.threeDate = board.threeDate;
    return back;
  }
  // fieldPatch sends a change to an existing card as just the fields that differ, so replaying it on another device's
  // newer copy of that card cannot undo that device's other changes. New and removed cards go whole.
  function fieldPatch(patch) {
    if (!patch.items) return patch;
    const items = {},
      fields = {};
    for (const [id, value] of Object.entries(patch.items)) {
      const now = board.items[id];
      if (value === null || !now) {
        items[id] = value;
        continue;
      }
      const diff = {};
      for (const key of Object.keys(value))
        if (JSON.stringify(value[key]) !== JSON.stringify(now[key])) diff[key] = value[key];
      if (Object.keys(diff).length) fields[id] = diff;
    }
    const wire = { ...patch, items };
    if (!Object.keys(items).length) delete wire.items;
    if (Object.keys(fields).length) wire.fields = fields;
    return wire;
  }
  // commit queues a change. With a label, a toast offers Undo; Ctrl+Z works either way.
  function commit(patch, label, { track = true } = {}) {
    if (!writable()) return refuse();
    const back = inverse(patch);
    if (track) {
      undoStack.push({ undo: back, redo: patch });
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
    }
    ctx.store.dispatch({ id: BOARD_ID, type: "boardPatch", arg: fieldPatch(patch) });
    if (label) ctx.toast(label, { label: "Undo", fn: () => undoLast() });
    ctx.measure("tool_edited");
    render();
    return true;
  }
  function undoLast() {
    const entry = undoStack.pop();
    if (!entry) return;
    if (!writable()) {
      undoStack.push(entry);
      return refuse();
    }
    redoStack.push(entry);
    commit(entry.undo, "", { track: false });
    selected.clear();
    render();
  }
  function redoLast() {
    const entry = redoStack.pop();
    if (!entry) return;
    if (!writable()) {
      redoStack.push(entry);
      return refuse();
    }
    undoStack.push(entry);
    commit(entry.redo, "", { track: false });
    render();
  }

  // ---- items ----
  const item = (id) => board.items[id];
  const ids = () => Object.keys(board.items);
  const selectedIds = () => [...selected].filter((id) => item(id));
  function addItem(kind, x, y, text = "") {
    if (!writable()) return refuse();
    if (ids().length >= ITEM_LIMIT) {
      ctx.toast(`The board holds ${ITEM_LIMIT} items. Clear a few done ones first.`);
      return false;
    }
    const id = uid();
    const fresh = {
      k: kind,
      t: text,
      x: round3(clamp(x, 0, 0.9)),
      y: round3(clamp(y, 0, 0.92)),
      z: nextZ(board),
    };
    if (kind === "card") {
      fresh.s = "todo";
      showStatus("todo");
    }
    if (!commit({ items: { [id]: fresh } })) return false;
    selected.clear();
    selected.add(id);
    render();
    if (!text) startEdit(id, true);
    return id;
  }
  // A card given a status that the "Show:" pills have switched off would vanish into the dimmed layer; switch it on.
  function showStatus(s) {
    if (hidden.delete(s)) renderLegend();
  }
  function removeItems(list) {
    const gone = list.filter((id) => item(id));
    if (!gone.length) return;
    const n = gone.length;
    commit(
      { items: Object.fromEntries(gone.map((id) => [id, null])) },
      n === 1 ? `${item(gone[0]).k === "note" ? "Note" : "Card"} removed.` : `${n} items removed.`,
    );
    for (const id of gone) selected.delete(id);
    render();
  }
  // Choosing the status a card already has takes it back to "not started", so a colour (above all "not my
  // problem") is a toggle rather than a one-way door.
  function setStatus(list, s) {
    const cards = list.filter((id) => item(id)?.k === "card");
    if (!cards.length) return;
    const next = cards.every((id) => item(id).s === s) && s !== "todo" ? "todo" : s;
    const changed = cards.filter((id) => item(id).s !== next);
    if (!changed.length) return;
    showStatus(next);
    commit({ items: Object.fromEntries(changed.map((id) => [id, { ...item(id), s: next }])) });
  }
  // A thing typed into today's three also gets a card in the top right, unless a card already says the same.
  // The first spot in "in my hands, matters now" where a new card (about 0.17 x 0.07) overlaps nothing, then
  // anywhere on the board; if it is crowded, the spot with the fewest overlaps. "extra" are cards added in the same step.
  function freeSpot(extra = []) {
    const best = freeSpotIn(0.56, 0.8, 0.12, 0.44, [], extra);
    return best.hits ? freeSpotIn(0.02, 0.8, 0.02, 0.9, [], extra, best) : best;
  }
  // The first spot in a box (a card is about 0.17 x 0.07) that overlaps nothing, else the one that overlaps least.
  // "skip" are ids not counted as in the way (the cards being moved); "also" are positions already taken this step.
  function freeSpotIn(
    x0,
    x1,
    y0,
    y1,
    skip = [],
    also = [],
    start = { x: x0, y: y0, hits: Infinity },
  ) {
    const taken = [
      ...ids()
        .filter((id) => !skip.includes(id))
        .map((id) => item(id)),
      ...(Array.isArray(also) ? also : Object.values(also)),
    ].filter(Boolean);
    const W = 0.17,
      H = 0.07;
    let best = start;
    for (let y = y0; y <= y1; y += 0.08)
      for (let x = x0; x <= x1; x += 0.06) {
        const hits = taken.filter(
          (o) => o.x < x + W && o.x + W > x && o.y < y + H && o.y + H > y,
        ).length;
        if (hits < best.hits) best = { x, y, hits };
        if (!hits) return best;
      }
    return best;
  }
  function cardFor(text, extra = {}) {
    const wanted = text.trim().toLocaleLowerCase();
    const existing = ids().find(
      (id) => item(id).k === "card" && item(id).t.trim().toLocaleLowerCase() === wanted,
    );
    if (existing) return { id: existing, items: {} };
    if (ids().length >= ITEM_LIMIT) return { id: null, items: {} };
    const spot = freeSpot(Object.values(extra));
    const id = uid();
    return {
      id,
      items: {
        [id]: {
          k: "card",
          t: text.trim(),
          x: round3(spot.x),
          y: round3(spot.y),
          z: nextZ(board) + Object.keys(extra).length,
          s: "todo",
        },
      },
    };
  }
  function duplicate(list) {
    const copies = {};
    const picks = list.filter((id) => item(id));
    if (!picks.length) return;
    if (ids().length + picks.length > ITEM_LIMIT) {
      ctx.toast(`The board holds ${ITEM_LIMIT} items. Clear a few done ones first.`);
      return;
    }
    let z = nextZ(board);
    for (const id of picks) {
      const src = item(id);
      copies[uid()] = {
        ...src,
        x: round3(clamp(src.x + 0.03, 0, 0.95)),
        y: round3(clamp(src.y + 0.04, 0, 0.95)),
        z: z++,
      };
    }
    if (!commit({ items: copies })) return;
    selected.clear();
    for (const id of Object.keys(copies)) selected.add(id);
    render();
  }
  function restack(list, front) {
    const picks = list.filter((id) => item(id));
    if (!picks.length) return;
    const items = {};
    if (front) {
      let z = nextZ(board);
      for (const id of picks) items[id] = { ...item(id), z: z++ };
    } else {
      // Everything else moves up by the number of cards going to the back, so the order among the rest is kept.
      const rest = ids().filter((id) => !picks.includes(id));
      for (const id of rest) items[id] = { ...item(id), z: (item(id).z || 0) + picks.length };
      picks.forEach((id, i) => (items[id] = { ...item(id), z: i }));
    }
    commit({ items });
  }
  function convert(list) {
    const picks = list.filter((id) => item(id));
    if (!picks.length) return;
    const items = {};
    for (const id of picks) {
      const src = { ...item(id) };
      if (src.k === "card") {
        delete src.s;
        src.k = "note";
      } else {
        src.k = "card";
        src.s = "todo";
      }
      items[id] = src;
    }
    commit({ items });
  }
  // The same move as dragging, for those who cannot drag: each card goes to a free spot in the chosen corner.
  function moveToQuadrant(list, quad) {
    const [control, priority] = quad.split(":");
    const x0 = control === "yours" ? 0.52 : 0.02,
      y0 = priority === "high" ? 0.04 : 0.54;
    const moving = list.filter((id) => item(id));
    const placed = [];
    const items = {};
    for (const id of moving) {
      const src = item(id);
      const spot = freeSpotIn(x0, x0 + 0.34, y0, y0 + 0.36, moving, placed);
      const to = keepInside(nodes.get(id), spot.x, spot.y);
      placed.push(to);
      if (to.x !== src.x || to.y !== src.y) items[id] = { ...src, ...to };
    }
    if (Object.keys(items).length)
      commit({ items }, `Moved to ${placeName({ control, priority })}.`);
  }
  function addToThree(id) {
    const src = item(id);
    if (!src || !src.t.trim()) return;
    if (board.three.some((t) => t.card === id)) {
      ctx.toast("That is already on today's three.");
      return;
    }
    if (board.three.length >= THREE_LIMIT) {
      ctx.toast(`The list holds ${THREE_LIMIT}. Tick a few off first.`);
      return;
    }
    commit({
      three: [...board.three, { id: uid(), t: src.t.trim(), done: false, card: id }],
      threeDate: board.threeDate || ctx.today(),
    });
  }

  // ---- geometry ----
  const bounds = () => canvas.getBoundingClientRect();
  const toFraction = (clientX, clientY) => {
    const b = bounds();
    return {
      x: clamp((clientX - b.left) / b.width, 0, 1),
      y: clamp((clientY - b.top) / b.height, 0, 1),
    };
  };
  // Keep an element inside the canvas: its top-left can go no further than the canvas minus its own size.
  function keepInside(el, x, y, b = bounds()) {
    const maxX = Math.max(0, 1 - el.offsetWidth / b.width),
      maxY = Math.max(0, 1 - el.offsetHeight / b.height);
    return { x: round3(clamp(x, 0, maxX)), y: round3(clamp(y, 0, maxY)) };
  }
  // What each card was last placed for. Measuring a card forces the browser to lay the page out, so a rebuild of a
  // large board measures only the cards whose position, text or canvas size changed.
  const placedAs = new WeakMap();
  function place(el, x, y) {
    el.style.left = `${x * 100}%`;
    el.style.top = `${y * 100}%`;
    placedAs.delete(el); // something other than a repaint moved it; the next repaint must put it right
  }
  function moveSelection(dx, dy, label = "") {
    const picks = selectedIds();
    if (!picks.length) return;
    const items = {};
    for (const id of picks) {
      const el = nodes.get(id),
        src = item(id);
      const to = keepInside(el, src.x + dx, src.y + dy);
      if (to.x !== src.x || to.y !== src.y) items[id] = { ...src, ...to };
    }
    if (Object.keys(items).length) commit({ items }, label);
  }

  // ---- rendering ----
  function itemNode(id) {
    let el = nodes.get(id);
    if (el) return el;
    el = document.createElement("div");
    el.className = "fb-item";
    el.dataset.id = id;
    el.tabIndex = 0;
    el.append(
      Object.assign(document.createElement("span"), { className: "fb-dot", ariaHidden: "true" }),
    );
    el.append(Object.assign(document.createElement("span"), { className: "fb-text" }));
    nodes.set(id, el);
    layer.append(el);
    return el;
  }
  // Where a card sits, in the words on the board's own axes (the person may have renamed them). The standard labels
  // read more naturally as a sentence, so those keep their plain wording.
  const PLAIN = {
    left: "Out of your hands",
    right: "In your hands",
    top: "matters most",
    bottom: "can wait",
  };
  const sideWord = (side) =>
    board.axes[side] === DEFAULT_AXES[side] ? PLAIN[side] : board.axes[side];
  const placeName = (q) =>
    `${sideWord(q.control === "yours" ? "right" : "left")}, ${sideWord(q.priority === "high" ? "top" : "bottom")}`;
  function paintItem(id, src, b = bounds()) {
    const el = itemNode(id);
    const q = quadrantOf(src);
    el.className = [
      "fb-item",
      `fb-${src.k}`,
      src.k === "card" ? `fb-s-${src.s}` : "",
      selected.has(id) ? "is-selected" : "",
      src.k === "card" && hidden.has(src.s) ? "is-dimmed" : "",
      editing === id ? "is-editing" : "",
    ]
      .filter(Boolean)
      .join(" ");
    el.setAttribute("role", "button");
    el.setAttribute("aria-pressed", selected.has(id));
    el.setAttribute(
      "aria-label",
      `${src.k === "card" ? STATUSES[src.s].label + ": " : "Note: "}${src.t || "untitled"}. ${placeName(q)}.`,
    );
    const dimmed = src.k === "card" && hidden.has(src.s);
    el.tabIndex = dimmed ? -1 : 0;
    if (dimmed) el.setAttribute("aria-hidden", "true");
    else el.removeAttribute("aria-hidden");
    el.style.zIndex = String(10 + (src.z || 0));
    const textEl = el.querySelector(".fb-text");
    if (editing !== id) {
      textEl.textContent = src.t || (src.k === "card" ? "Untitled" : "…");
      textEl.classList.toggle("is-placeholder", !src.t);
    }
    // A card is drawn where it was saved, pulled in only as far as the canvas edge: a narrower screen clips nothing.
    if (!(drag && drag.moved && drag.ids.includes(id))) {
      const key = [src.x, src.y, src.k, src.t, src.s, editing === id, b.width, b.height].join("|");
      if (placedAs.get(el) !== key) {
        const to = keepInside(el, src.x, src.y, b);
        place(el, to.x, to.y);
        placedAs.set(el, key);
      }
    }
  }
  // Selection changes during a marquee touch only the cards that joined or left it.
  function paintSelection(before) {
    for (const [id, el] of nodes) {
      const on = selected.has(id);
      if (before.has(id) === on) continue;
      el.classList.toggle("is-selected", on);
      el.setAttribute("aria-pressed", String(on));
    }
    $("fb").classList.toggle("has-selection", selected.size > 0);
  }
  function renderItems() {
    const b = bounds();
    for (const [id, el] of nodes)
      if (!item(id)) {
        if (editing === id) editing = null;
        el.remove();
        nodes.delete(id);
        selected.delete(id);
      }
    for (const [id, src] of Object.entries(board.items)) paintItem(id, src, b);
    $("fb-empty").hidden = ids().length > 0;
    $("fb").classList.toggle("has-selection", selected.size > 0);
    renderActions();
  }
  // What can be done to what is selected, in plain view: status, edit, add to today's three, delete.
  function renderActions() {
    const bar = $("fb-actions"),
      picks = selectedIds();
    bar.hidden = !picks.length || !writable();
    if (bar.hidden) return;
    const cardsPicked = picks.filter((id) => item(id).k === "card");
    // One card needs no count; several do, so that Delete is not a surprise.
    $("fb-actions-label").textContent = picks.length > 1 ? `${picks.length} selected` : "";
    $("fb-actions-label").hidden = picks.length < 2;
    for (const b of bar.querySelectorAll("[data-set-status]")) {
      b.disabled = !cardsPicked.length;
      b.setAttribute(
        "aria-pressed",
        String(
          cardsPicked.length > 0 && cardsPicked.every((id) => item(id).s === b.dataset.setStatus),
        ),
      );
    }
    const only = picks.length === 1 ? item(picks[0]) : null;
    bar.querySelector('[data-fb="edit-selected"]').disabled = !only;
    bar.querySelector('[data-fb="three-selected"]').disabled = !(
      only &&
      only.k === "card" &&
      only.s !== "external" &&
      only.t.trim()
    );
    bar.querySelector('[data-fb="delete-selected"]').textContent =
      picks.length > 1 ? `Delete ${picks.length}` : "Delete";
  }
  // Whether the person's changes have reached the server is easy to lose sight of at the bottom of a long page.
  function renderStatus() {
    const st = ctx.store.status(),
      line = $("fb-status");
    if (st.failed) {
      line.textContent =
        "A change could not be saved. It is kept in Held changes at the top of the page.";
    } else if (st.pending) {
      line.textContent = st.offline
        ? `Offline. ${plural(st.pending, "change")} saved on this device and sent when you are back online.`
        : `${plural(st.pending, "change")} saved on this device, being sent.`;
    } else {
      line.textContent = "";
    }
    line.classList.toggle("err", !!st.failed);
  }
  function renderAxes() {
    for (const b of root.querySelectorAll("[data-axis]")) {
      const side = b.dataset.axis;
      if (b.querySelector("input")) continue;
      b.textContent = board.axes[side];
      b.title = "Click to rename";
      b.setAttribute("aria-label", `Rename the ${side} label: ${board.axes[side]}`);
    }
    // The corner captions advise in the default words; once the axes are renamed they just name the corner.
    const standard = Object.keys(DEFAULT_AXES).every(
      (side) => board.axes[side] === DEFAULT_AXES[side],
    );
    for (const quad of root.querySelectorAll(".fb-quad")) {
      const [control, priority] = quad.dataset.quad.split(":");
      quad.querySelector("span").textContent = standard
        ? QUADRANT_HINTS[quad.dataset.quad]
        : placeName({ control: control === "yours" ? "yours" : "beyond", priority });
    }
  }
  function renderLegend() {
    for (const b of $("fb-legend").querySelectorAll("[data-status]"))
      b.setAttribute("aria-pressed", !hidden.has(b.dataset.status));
  }
  function renderThree() {
    const today = ctx.today();
    const stale = board.threeDate && board.threeDate !== today && board.three.length;
    $("fb-three-date").textContent = board.three.length
      ? stale
        ? `From ${fmtDay(board.threeDate, ctx.settings().locale)}`
        : "Today"
      : "";
    // The list is rebuilt on every change: keep keyboard focus on the box that was just used.
    const focusedId = document.activeElement?.dataset?.threeDone;
    setHTML(
      $("fb-three"),
      html`${board.three.map((t, i) => {
        const linked = t.card && item(t.card);
        return html`<li class="fb-three-item ${t.done ? "is-done" : ""} ${i >= 3 ? "is-extra" : ""}">
          <label class="fb-three-check"><input type="checkbox" data-three-done="${t.id}" ${t.done ? "checked" : ""} /><span class="sr-only">${t.done ? "Done" : "Mark done"}: ${t.t}</span></label>
          <button type="button" class="fb-three-text" data-three-edit="${t.id}" title="Click to edit">${t.t || "…"}</button>
          ${linked ? html`<button type="button" class="fb-chip" data-three-card="${t.card}" title="Show on the board">on board</button>` : ""}
          <button type="button" class="fb-three-remove" data-three-remove="${t.id}" aria-label="Remove ${t.t}">×</button>
        </li>`;
      })}`,
    );
    if (focusedId)
      $("fb-three")
        .querySelector(`[data-three-done="${CSS.escape(focusedId)}"]`)
        ?.focus();
    const note = $("fb-three-note");
    const left = board.three.filter((t) => !t.done).length;
    note.hidden = true;
    if (left > 3) {
      note.hidden = false;
      note.textContent = "That is more than three. Keep the ones that really matter today.";
    } else if (board.three.length && !left) {
      note.hidden = false;
      note.textContent = "All done. Be kind about what is left; tomorrow has its own three.";
    } else if (stale) {
      note.hidden = false;
      note.textContent = "A new day. Keep what still stands, or start fresh.";
    }
    $("fb-three-form").hidden = !writable();
    for (const b of root.querySelectorAll(".fb-tray-actions button")) b.disabled = !writable();
  }
  function renderSummary() {
    const s = summarise(board);
    const parts = [];
    if (!s.cards && !s.notes) parts.push("An empty board is a fine place to start");
    else {
      // Where the cards sit, then (separately, since they overlap it) how far along they are.
      parts.push(plural(s.cards, "card"));
      if (s.yoursHigh + s.yoursLow)
        parts.push(
          `${s.yoursHigh + s.yoursLow} in your hands${s.yoursHigh ? ` (${s.yoursHigh} that matter most)` : ""}`,
        );
      if (s.beyondHigh + s.beyondLow) parts.push(`${s.beyondHigh + s.beyondLow} out of your hands`);
      const along = [];
      if (s.byStatus.done) along.push(`${s.byStatus.done} done`);
      if (s.byStatus.external) along.push(`${s.byStatus.external} marked not yours`);
      if (along.length) parts.push(`of all of them, ${along.join(" and ")}`);
    }
    let gentle = "";
    if (s.weight)
      gentle = ` ${s.weight === 1 ? "One thing matters and is out of your hands." : `${s.weight} things matter and are out of your hands.`} Notice it, then let the weight go.`;
    else if (s.yoursHigh && !board.three.length)
      gentle = " Something in the top right could be one of today's three.";
    $("fb-summary").textContent = parts.join(" · ") + "." + gentle;
  }
  function render() {
    board = normaliseBoard(ctx.store.view(BOARD_ID));
    if (!visible) return;
    renderItems();
    renderAxes();
    renderLegend();
    renderThree();
    renderSummary();
    renderStatus();
    $("fb").classList.toggle("is-readonly", !writable());
    root.querySelector('[data-fb="undo"]').disabled = !undoStack.length;
    root.querySelector('[data-fb="redo"]').disabled = !redoStack.length;
  }

  // ---- text editing ----
  function startEdit(id, isNew = false) {
    const src = item(id);
    if (!src || editing === id) return;
    if (!writable()) return refuse();
    finishEdit();
    editing = id;
    const el = itemNode(id),
      textEl = el.querySelector(".fb-text");
    const ta = document.createElement("textarea");
    ta.className = "fb-edit";
    ta.maxLength = TEXT_LIMIT;
    ta.rows = 1;
    ta.value = src.t;
    ta.setAttribute("aria-label", src.k === "card" ? "Card text" : "Note text");
    ta.dataset.new = isNew ? "1" : "";
    textEl.classList.remove("is-placeholder");
    el.classList.add("is-editing");
    const grow = () => {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight}px`;
    };
    // The limit is silent when text is pasted or typed past it; say how much room is left near the end.
    const count = Object.assign(document.createElement("span"), { className: "fb-count meta" });
    count.setAttribute("aria-live", "polite");
    const tally = () => {
      count.textContent = ta.value.length >= 200 ? `${ta.value.length} / ${TEXT_LIMIT}` : "";
    };
    ta.addEventListener("input", () => {
      grow();
      tally();
    });
    textEl.replaceChildren(ta, count);
    ta.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        finishEdit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        finishEdit(true);
      }
    });
    ta.addEventListener("blur", () => finishEdit());
    ta.addEventListener("pointerdown", (e) => e.stopPropagation());
    ta.addEventListener("dblclick", (e) => e.stopPropagation());
    ta.addEventListener("contextmenu", (e) => e.stopPropagation());
    grow();
    tally();
    ta.focus();
    if (!isNew) ta.select();
    const to = keepInside(el, src.x, src.y);
    place(el, to.x, to.y);
  }
  // finishEdit saves the typed text. A brand-new item left empty is taken off the board again, and so is an existing
  // one whose text was cleared on purpose (Escape keeps the old text instead).
  function finishEdit(cancel = false) {
    if (!editing) return;
    const id = editing,
      el = nodes.get(id),
      ta = el?.querySelector("textarea.fb-edit");
    editing = null;
    if (!el || !ta) return;
    const isNew = ta.dataset.new === "1";
    const value = cancel ? (item(id)?.t ?? "") : ta.value.replace(/\s+$/, "").slice(0, TEXT_LIMIT);
    ta.remove();
    el.classList.remove("is-editing");
    el.querySelector(".fb-text").textContent = value; // so the card is measured at its new size
    const src = item(id);
    if (!src) return;
    if (!value.trim()) {
      if (isNew || !cancel) {
        commit(
          { items: { [id]: null } },
          isNew ? "" : `${src.k === "note" ? "Note" : "Card"} removed.`,
        );
        selected.delete(id);
      }
      render();
      canvas.focus({ preventScroll: true });
      return;
    }
    if (value !== src.t) {
      const el2 = nodes.get(id);
      const to = el2 ? keepInside(el2, src.x, src.y) : { x: src.x, y: src.y };
      commit({ items: { [id]: { ...src, t: value, ...to } } });
    }
    render();
    el.focus({ preventScroll: true });
  }
  function editAxis(button) {
    if (!writable()) return refuse();
    if (button.querySelector("input")) return;
    const side = button.dataset.axis;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 40;
    input.value = board.axes[side];
    input.className = "fb-axis-input";
    input.setAttribute("aria-label", `Label for the ${side} end of the axis`);
    button.replaceChildren(input);
    let finished = false; // removing the input blurs it, which would call this again mid-removal
    const done = (cancel) => {
      if (finished) return;
      finished = true;
      const value = cancel ? board.axes[side] : input.value.trim() || DEFAULT_AXES[side];
      input.remove();
      button.textContent = value;
      if (value !== board.axes[side]) commit({ axes: { [side]: value } });
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") done(false);
      if (e.key === "Escape") done(true);
    });
    input.addEventListener("blur", () => done(false));
    input.focus();
    input.select();
  }

  // ---- selection ----
  function select(id, { add = false, toggle = false } = {}) {
    if (!add && !toggle) selected.clear();
    if (toggle && selected.has(id)) selected.delete(id);
    else selected.add(id);
    renderItems();
  }
  function clearSelection() {
    if (!selected.size) return;
    selected.clear();
    renderItems();
  }
  function selectAll() {
    for (const id of ids())
      if (!(item(id).k === "card" && hidden.has(item(id).s))) selected.add(id);
    renderItems();
  }
  function reveal(id) {
    if (!item(id)) return;
    select(id);
    const el = nodes.get(id);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
    el?.focus({ preventScroll: true });
  }

  // ---- context menu ----
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    menu.replaceChildren();
  }
  function openMenu(clientX, clientY, targetId) {
    closeMenu();
    const picks = targetId ? selectedIds() : [];
    const one = picks.length === 1 ? item(picks[0]) : null;
    const point = toFraction(clientX, clientY);
    const entries = [];
    const add = (label, action, { key = "", danger = false, disabled = false } = {}) =>
      entries.push({ label, action, key, danger, disabled });
    const sep = () => entries.push(null);
    if (targetId) {
      if (one) add("Edit text", () => startEdit(picks[0]), { key: "Enter" });
      if (picks.some((id) => item(id).k === "card")) {
        entries.push({ heading: "Status" });
        for (const s of STATUS_ORDER) {
          const current = one?.k === "card" && one.s === s;
          add(current ? `${STATUSES[s].label} ✓` : STATUSES[s].label, () => setStatus(picks, s), {
            key: current && s !== "todo" ? "clear" : STATUSES[s].key,
          });
        }
        sep();
      }
      if (one && one.k === "card" && one.s !== "external")
        add("Add to today's three", () => addToThree(picks[0]), { key: "T" });
      entries.push({ heading: "Move to" });
      for (const [q, label] of [
        ["yours:high", `${board.axes.right}, ${board.axes.top}`],
        ["yours:low", `${board.axes.right}, ${board.axes.bottom}`],
        ["beyond:high", `${board.axes.left}, ${board.axes.top}`],
        ["beyond:low", `${board.axes.left}, ${board.axes.bottom}`],
      ])
        add(label, () => moveToQuadrant(picks, q));
      sep();
      add(picks.length > 1 ? "Duplicate all" : "Duplicate", () => duplicate(picks), {
        key: "Ctrl+D",
      });
      add(
        picks.every((id) => item(id).k === "note")
          ? "Turn into a card"
          : picks.every((id) => item(id).k === "card")
            ? "Turn into a note"
            : "Swap card and note",
        () => convert(picks),
      );
      add("Bring to front", () => restack(picks, true), { key: "]" });
      add("Send to back", () => restack(picks, false), { key: "[" });
      sep();
      add(picks.length > 1 ? `Delete ${picks.length} items` : "Delete", () => removeItems(picks), {
        key: "Del",
        danger: true,
      });
    } else {
      add("Add a card here", () => addItem("card", point.x, point.y));
      add("Add a note here", () => addItem("note", point.x, point.y));
      sep();
      add("Select all", selectAll, { key: "Ctrl+A", disabled: !ids().length });
      add(
        "Clear done cards",
        () => removeItems(ids().filter((id) => item(id).k === "card" && item(id).s === "done")),
        {
          disabled: !ids().some((id) => item(id).k === "card" && item(id).s === "done"),
        },
      );
      if (!ids().length) add("Start with an example", loadExample);
      sep();
      add("Undo", undoLast, { key: "Ctrl+Z", disabled: !undoStack.length });
      add("Redo", redoLast, { key: "Ctrl+Shift+Z", disabled: !redoStack.length });
    }
    setHTML(
      menu,
      html`${entries.map((e, i) =>
        e === null
          ? html`<hr />`
          : e.heading
            ? html`<p class="fb-menu-heading">${e.heading}</p>`
            : html`<button type="button" role="menuitem" class="${e.danger ? "is-danger" : ""}" data-menu="${i}" ${e.disabled ? "disabled" : ""}><span>${e.label}</span>${e.key ? html`<kbd>${e.key}</kbd>` : ""}</button>`,
      )}`,
    );
    menu.hidden = false;
    // Keep the menu on screen: it opens at the pointer but never past the right or bottom edge.
    const w = menu.offsetWidth,
      h = menu.offsetHeight;
    menu.style.left = `${clamp(clientX, 8, innerWidth - w - 8)}px`;
    menu.style.top = `${clamp(clientY, 8, innerHeight - h - 8)}px`;
    menu.onclick = (e) => {
      const b = e.target.closest("[data-menu]");
      if (!b) return;
      closeMenu();
      entries[Number(b.dataset.menu)].action();
    };
    menu.onkeydown = (e) => {
      const buttons = [...menu.querySelectorAll("button:not([disabled])")];
      const i = buttons.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        buttons[(i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length]?.focus();
      } else if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        closeMenu();
        (targetId ? nodes.get(targetId) : canvas)?.focus({ preventScroll: true });
      }
    };
    menu.querySelector("button:not([disabled])")?.focus();
  }
  function loadExample() {
    if (ids().length) return;
    const example = exampleBoard(ctx.today());
    commit(
      { items: example.items, three: example.three, threeDate: example.threeDate },
      "Example board added.",
    );
  }

  // ---- pointer handling on the canvas ----
  // A tap (not a scroll, which ends in pointercancel) on empty board clears the selection.
  let touchTap = null;
  canvas.addEventListener("pointerup", (e) => {
    if (
      e.pointerType === "touch" &&
      touchTap &&
      Math.hypot(e.clientX - touchTap.x, e.clientY - touchTap.y) < 8
    )
      clearSelection();
    touchTap = null;
  });
  canvas.addEventListener("pointerdown", (e) => {
    closeMenu();
    if (e.target.closest("button, input, textarea")) return; // let the empty-state button receive its click
    if (e.button !== 0 && e.pointerType === "mouse") return; // right button is the menu, middle is left alone
    const el = e.target.closest(".fb-item");
    lastPointer = toFraction(e.clientX, e.clientY);
    if (el) {
      const id = el.dataset.id;
      if (editing === id) return;
      if (editing) finishEdit();
      const wasSelected = selected.has(id) && selected.size === 1;
      if (e.shiftKey || e.ctrlKey || e.metaKey) select(id, { toggle: true });
      else if (!selected.has(id)) select(id);
      if (!selected.has(id)) return;
      drag = {
        // A second tap on the one card that is selected edits it: a phone has no double-click.
        editOnTap: e.pointerType === "touch" && wasSelected,
        ids: selectedIds(),
        startX: e.clientX,
        startY: e.clientY,
        origin: Object.fromEntries(selectedIds().map((i) => [i, { x: item(i).x, y: item(i).y }])),
        moved: false,
        pointerId: e.pointerId,
        target: el,
        clickOnly: selected.size > 1 && !e.shiftKey && !e.ctrlKey && !e.metaKey,
        id,
      };
      el.setPointerCapture(e.pointerId);
      if (e.pointerType === "touch") {
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          if (drag && !drag.moved) {
            try {
              el.releasePointerCapture(drag.pointerId);
            } catch {}
            drag = null;
            openMenu(e.clientX, e.clientY, id);
          }
        }, LONG_PRESS);
      }
      e.preventDefault();
      return;
    }
    // Empty canvas: a press starts a marquee; a plain click clears the selection. A finger on empty
    // board is a scroll, not a selection rectangle.
    if (e.pointerType === "touch") {
      if (editing) finishEdit();
      touchTap = { x: e.clientX, y: e.clientY };
      return;
    }
    if (editing) finishEdit();
    const b = bounds();
    marquee = {
      x: e.clientX - b.left,
      y: e.clientY - b.top,
      add: e.shiftKey,
      started: false,
      pointerId: e.pointerId,
    };
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === "touch") {
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        if (marquee && !marquee.started) {
          try {
            canvas.releasePointerCapture(marquee.pointerId);
          } catch {}
          marquee = null;
          openMenu(e.clientX, e.clientY, null);
        }
      }, LONG_PRESS);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag && e.pointerId === drag.pointerId) {
      const dx = e.clientX - drag.startX,
        dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (!drag.moved) {
        if (!writable()) {
          drag.target.releasePointerCapture(drag.pointerId);
          drag = null;
          refuse();
          return;
        }
        drag.moved = true;
        clearTimeout(pressTimer);
        $("fb").classList.add("is-dragging");
      }
      const b = bounds();
      for (const id of drag.ids) {
        const el = nodes.get(id),
          o = drag.origin[id];
        if (!el || !o) continue;
        const to = keepInside(el, o.x + dx / b.width, o.y + dy / b.height);
        place(el, to.x, to.y);
        el.dataset.quad = `${quadrantOf(to).control}:${quadrantOf(to).priority}`;
      }
      return;
    }
    if (marquee && e.pointerId === marquee.pointerId) {
      const b = bounds();
      const x = e.clientX - b.left,
        y = e.clientY - b.top;
      if (!marquee.started && Math.hypot(x - marquee.x, y - marquee.y) < DRAG_THRESHOLD) return;
      if (!marquee.started) {
        marquee.started = true;
        clearTimeout(pressTimer);
        marqueeEl.hidden = false;
        if (!marquee.add) selected.clear();
        marquee.base = new Set(selected);
        // Cards do not move during a marquee: measure them once, not on every pointer move.
        marquee.rects = [...nodes].map(([id, el]) => [
          id,
          el.offsetLeft,
          el.offsetTop,
          el.offsetWidth,
          el.offsetHeight,
        ]);
      }
      const left = Math.min(x, marquee.x),
        top = Math.min(y, marquee.y),
        w = Math.abs(x - marquee.x),
        h = Math.abs(y - marquee.y);
      marqueeEl.style.left = `${left}px`;
      marqueeEl.style.top = `${top}px`;
      marqueeEl.style.width = `${w}px`;
      marqueeEl.style.height = `${h}px`;
      const before = new Set(selected);
      selected.clear();
      for (const id of marquee.base) selected.add(id);
      for (const [id, l, t, cw, ch] of marquee.rects) {
        const src = item(id);
        if (!src || (src.k === "card" && hidden.has(src.s))) continue;
        if (l < left + w && l + cw > left && t < top + h && t + ch > top) selected.add(id);
      }
      paintSelection(before);
    }
  });
  const endPointer = (e) => {
    clearTimeout(pressTimer);
    if (drag && e.pointerId === drag.pointerId) {
      const d = drag;
      drag = null;
      $("fb").classList.remove("is-dragging");
      try {
        d.target.releasePointerCapture(d.pointerId);
      } catch {}
      if (d.moved) {
        const b = bounds();
        const dx = (e.clientX - d.startX) / b.width,
          dy = (e.clientY - d.startY) / b.height;
        const items = {};
        for (const id of d.ids) {
          const el = nodes.get(id),
            o = d.origin[id],
            src = item(id);
          if (!el || !o || !src) continue;
          const to = keepInside(el, o.x + dx, o.y + dy);
          delete el.dataset.quad;
          if (to.x !== src.x || to.y !== src.y) items[id] = { ...src, ...to };
        }
        if (Object.keys(items).length) commit({ items });
        else render();
      } else if (e.type === "pointerup" && d.editOnTap) startEdit(d.id);
      else if (e.type === "pointerup" && d.clickOnly) select(d.id);
      if (e.type === "pointerup" && !editing) d.target.focus({ preventScroll: true });
      return;
    }
    if (marquee && e.pointerId === marquee.pointerId) {
      const m = marquee;
      marquee = null;
      try {
        canvas.releasePointerCapture(m.pointerId);
      } catch {}
      marqueeEl.hidden = true;
      if (m.started) render(); // the selection is final: bring the rest of the board in line with it
      if (!m.started && e.type === "pointerup" && !m.add) clearSelection();
      if (!m.started && e.type === "pointerup") canvas.focus({ preventScroll: true });
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("dblclick", (e) => {
    getSelection()?.removeAllRanges(); // a double-click must not leave text highlighted elsewhere on the page
    const el = e.target.closest(".fb-item");
    if (el) {
      startEdit(el.dataset.id);
      return;
    }
    const p = toFraction(e.clientX, e.clientY);
    addItem("card", p.x - 0.02, p.y - 0.02);
  });
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const el = e.target.closest(".fb-item");
    if (el) {
      if (editing === el.dataset.id) return;
      if (!selected.has(el.dataset.id)) select(el.dataset.id);
      openMenu(e.clientX, e.clientY, el.dataset.id);
    } else openMenu(e.clientX, e.clientY, null);
  });
  canvas.addEventListener("focusin", (e) => {
    const el = e.target.closest(".fb-item");
    if (el && !selected.has(el.dataset.id) && !drag && !marquee) select(el.dataset.id);
  });
  canvas.addEventListener("keydown", (e) => {
    if (editing) return;
    if (e.target.closest("button, input, textarea")) return; // Enter/Space belong to the focused control
    const el = e.target.closest(".fb-item");
    const picks = selectedIds();
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === "Escape") {
      if (!menu.hidden) closeMenu();
      else clearSelection();
      return;
    }
    if (mod && key === "a") {
      e.preventDefault();
      selectAll();
      return;
    }
    if (mod && key === "z") {
      e.preventDefault();
      e.shiftKey ? redoLast() : undoLast();
      return;
    }
    if (mod && key === "y") {
      e.preventDefault();
      redoLast();
      return;
    }
    if (mod && key === "d") {
      e.preventDefault();
      duplicate(picks);
      return;
    }
    if (!picks.length) {
      if (e.key === "Enter" && !el) {
        e.preventDefault();
        addItem("card", lastPointer.x, lastPointer.y);
      }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeItems(picks);
      canvas.focus({ preventScroll: true });
    } else if ((e.key === "Enter" || e.key === "F2") && picks.length === 1) {
      e.preventDefault();
      startEdit(picks[0]);
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const step = e.shiftKey ? NUDGE * 5 : NUDGE;
      moveSelection(
        e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
        e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
      );
    } else if (/^[1-4]$/.test(e.key) && !mod) {
      e.preventDefault();
      setStatus(picks, STATUS_ORDER[Number(e.key) - 1]);
    } else if (key === "t" && picks.length === 1 && !mod) {
      e.preventDefault();
      addToThree(picks[0]);
    } else if (e.key === "]" || e.key === "[") {
      e.preventDefault();
      restack(picks, e.key === "]");
    } else if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      const target = nodes.get(picks[0]);
      const r = target.getBoundingClientRect();
      openMenu(r.left + r.width / 2, r.top + r.height / 2, picks[0]);
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag && !marquee) lastPointer = toFraction(e.clientX, e.clientY);
  });

  // ---- the rest of the panel ----
  root.addEventListener("click", (e) => {
    const axis = e.target.closest("[data-axis]");
    if (axis) {
      editAxis(axis);
      return;
    }
    const legend = e.target.closest("[data-status]");
    if (legend) {
      const s = legend.dataset.status;
      hidden.has(s) ? hidden.delete(s) : hidden.add(s);
      for (const id of selectedIds())
        if (item(id).k === "card" && hidden.has(item(id).s)) selected.delete(id);
      render();
      return;
    }
    const setTo = e.target.closest("[data-set-status]");
    if (setTo) {
      setStatus(selectedIds(), setTo.dataset.setStatus);
      return;
    }
    const b = e.target.closest("[data-fb]");
    if (b) {
      const what = b.dataset.fb;
      if (what === "edit-selected") {
        if (selectedIds().length === 1) startEdit(selectedIds()[0]);
      } else if (what === "three-selected") {
        if (selectedIds().length === 1) addToThree(selectedIds()[0]);
      } else if (what === "delete-selected") {
        removeItems(selectedIds());
        canvas.focus({ preventScroll: true });
      } else if (what === "skip-board") {
        // After the key press has finished: the same Enter must not also activate the control it lands on.
        setTimeout(() => $("fb-three-input").focus(), 0);
      } else if (what === "add-card" || what === "add-note") {
        // New things land near the middle of the "in my hands, matters" quadrant, a little apart from the last one.
        const spot = freeSpot();
        addItem(what === "add-card" ? "card" : "note", spot.x, spot.y);
      } else if (what === "undo") undoLast();
      else if (what === "redo") redoLast();
      else if (what === "example") loadExample();
      else if (what === "suggest") {
        // Ticked-off things are finished: only what is still to do takes up one of the three.
        const open = board.three.filter((t) => !t.done).length;
        const picks = suggestThree(board, 3 - Math.min(3, open));
        if (!picks.length) {
          ctx.toast(
            open >= 3
              ? "You have three to do already. Finish or remove one to make room."
              : "Nothing to suggest yet. Add a card that is in your hands and matters.",
          );
          return;
        }
        commit({
          three: [
            ...board.three,
            ...picks.map((c) => ({ id: uid(), t: c.t.trim(), done: false, card: c.id })),
          ],
          threeDate: board.threeDate || ctx.today(),
        });
      } else if (what === "three-fresh") {
        if (!board.three.length) {
          commit({ threeDate: ctx.today() });
          return;
        }
        commit({ three: [], threeDate: ctx.today() }, "Today's three cleared.");
      }
      return;
    }
    const done = e.target.closest("[data-three-done]");
    if (done) {
      const id = done.dataset.threeDone;
      commit({ three: board.three.map((t) => (t.id === id ? { ...t, done: done.checked } : t)) });
      return;
    }
    const remove = e.target.closest("[data-three-remove]");
    if (remove) {
      const id = remove.dataset.threeRemove;
      commit({ three: board.three.filter((t) => t.id !== id) }, "Taken off today's three.");
      return;
    }
    const card = e.target.closest("[data-three-card]");
    if (card) {
      reveal(card.dataset.threeCard);
      return;
    }
    const edit = e.target.closest("[data-three-edit]");
    if (edit) editThree(edit);
  });
  function editThree(button) {
    if (!writable()) return refuse();
    const id = button.dataset.threeEdit;
    const entry = board.three.find((t) => t.id === id);
    if (!entry || button.querySelector("input")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = TEXT_LIMIT;
    input.value = entry.t;
    input.className = "fb-three-input";
    input.setAttribute("aria-label", "Edit this thing");
    button.replaceChildren(input);
    let finished = false;
    const finish = (cancel) => {
      if (finished) return;
      finished = true;
      const value = cancel ? entry.t : input.value.trim();
      input.remove();
      button.textContent = value || entry.t;
      if (!cancel && value && value !== entry.t)
        commit({ three: board.three.map((t) => (t.id === id ? { ...t, t: value } : t)) });
      else renderThree();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(false);
      if (e.key === "Escape") finish(true);
    });
    input.addEventListener("blur", () => finish(false));
    input.focus();
    input.select();
  }
  $("fb-three-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("fb-three-input");
    const value = input.value.trim();
    if (!value) return;
    if (board.three.length >= THREE_LIMIT) {
      ctx.toast(`The list holds ${THREE_LIMIT}. Tick a few off first.`);
      return;
    }
    const card = cardFor(value);
    if (card.id === null)
      ctx.toast(`The board holds ${ITEM_LIMIT} items, so this is on today's three without a card.`);
    if (
      commit({
        ...(Object.keys(card.items).length ? { items: card.items } : {}),
        three: [
          ...board.three,
          { id: uid(), t: value, done: false, ...(card.id ? { card: card.id } : {}) },
        ],
        threeDate: board.threeDate || ctx.today(),
      })
    )
      input.value = "";
  });

  // The menu closes on a click or a press anywhere else, and when the page scrolls or resizes away from it.
  // So does the selection, unless the press is on the canvas or on the bar that acts on it.
  const outside = (e) => {
    if (!menu.hidden && !menu.contains(e.target)) closeMenu();
    if (
      visible &&
      !editing &&
      !drag &&
      !marquee &&
      !canvas.contains(e.target) &&
      !menu.contains(e.target) &&
      !$("fb-actions").contains(e.target)
    )
      clearSelection();
  };
  document.addEventListener("pointerdown", outside, true);
  addEventListener("resize", closeMenu);
  addEventListener("scroll", closeMenu, { passive: true });
  // Cards are sized by their text, so when the canvas changes size they are kept inside it.
  const sizer = new ResizeObserver(() => {
    if (visible && !drag) renderItems();
  });
  sizer.observe(canvas);

  return {
    render,
    show() {
      visible = true;
      render();
    },
    hide() {
      finishEdit();
      closeMenu();
      visible = false;
    },
    destroy() {
      document.removeEventListener("pointerdown", outside, true);
      removeEventListener("resize", closeMenu);
      removeEventListener("scroll", closeMenu);
      sizer.disconnect();
    },
    snapshot: () => ({ hidden: [...hidden] }),
  };
}
