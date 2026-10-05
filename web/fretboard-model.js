// Fretboard: the rules behind the "what is fretting me, and what is in my hands" board.
// A board is one personal document (t-fretboard). Cards sit on a canvas with two axes: left to right is how much the
// thing is in your hands, top to bottom is how much it matters right now. Positions are fractions of the canvas, so the
// same board draws the same on a phone and a desktop. Everything here is pure, so it is tested without a browser.

export const BOARD_ID = "t-fretboard";
export const TEXT_LIMIT = 240;
export const ITEM_LIMIT = 400;
export const THREE_LIMIT = 10; // the list is called "three things" but nobody is stopped at three

export const STATUSES = Object.freeze({
  todo: { label: "Not started", short: "To do", key: "1" },
  doing: { label: "In progress", short: "Doing", key: "2" },
  done: { label: "Done", short: "Done", key: "3" },
  external: { label: "Not my problem", short: "Not mine", key: "4" },
});
export const STATUS_ORDER = ["todo", "doing", "done", "external"];
export const KINDS = ["card", "note"];

export const DEFAULT_AXES = Object.freeze({
  left: "Out of my hands",
  right: "In my hands",
  top: "Matters most",
  bottom: "Can wait",
});

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
const round = (n) => Math.round(clamp01(n) * 1000) / 1000;
const text = (v, limit = TEXT_LIMIT) => (typeof v === "string" ? v.slice(0, limit) : "");
const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id);

export const emptyBoard = () => ({
  v: 1,
  tool: "fretboard",
  axes: { ...DEFAULT_AXES },
  items: {},
  three: [],
  threeDate: "",
});

// normaliseItem keeps only what the board understands and keeps every value inside its bounds, whatever an older build
// or a hand-edited backup wrote. Unknown kinds and statuses fall back rather than being dropped: a card is never lost.
export function normaliseItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const item = {
    k: KINDS.includes(raw.k) ? raw.k : "card",
    t: text(raw.t),
    x: round(Number(raw.x)),
    y: round(Number(raw.y)),
    z: Number.isInteger(raw.z) && raw.z >= 0 ? Math.min(raw.z, 1_000_000) : 0,
  };
  if (item.k === "card") item.s = Object.hasOwn(STATUSES, raw.s) ? raw.s : "todo";
  if (Number.isFinite(raw.w) && raw.w > 0) item.w = Math.min(1, Math.max(0.08, round(raw.w)));
  return item;
}

export function normaliseThree(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object" && validId(r.id))
    .slice(0, THREE_LIMIT)
    .map((r) => ({
      id: r.id,
      t: text(r.t),
      done: r.done === true,
      ...(validId(r.card) ? { card: r.card } : {}),
    }));
}

export function normaliseBoard(raw) {
  const board = emptyBoard();
  if (!raw || typeof raw !== "object") return board;
  if (raw.axes && typeof raw.axes === "object")
    for (const side of Object.keys(DEFAULT_AXES)) {
      const v = text(raw.axes[side], 40);
      if (v.trim()) board.axes[side] = v;
    }
  if (raw.items && typeof raw.items === "object")
    for (const [id, value] of Object.entries(raw.items).slice(0, ITEM_LIMIT)) {
      const item = validId(id) ? normaliseItem(value) : null;
      if (item) board.items[id] = item;
    }
  board.three = normaliseThree(raw.three);
  board.threeDate = /^\d{4}-\d{2}-\d{2}$/.test(raw.threeDate || "") ? raw.threeDate : "";
  if (typeof raw.title === "string" && raw.title.trim()) board.title = raw.title.slice(0, 60);
  return board;
}

// applyBoardPatch is how the sync queue changes a board. A patch names the items it sets (or removes, with null), so two
// devices that each move different cards both keep their change when the queue replays on the other's copy. The axes
// merge side by side; the three-things list is small and replaced whole.
export function applyBoardPatch(arg, body) {
  const board = normaliseBoard(body);
  if (!arg || typeof arg !== "object") return board;
  if (arg.items && typeof arg.items === "object")
    for (const [id, value] of Object.entries(arg.items)) {
      if (!validId(id)) continue;
      if (value === null) delete board.items[id];
      else {
        const item = normaliseItem(value);
        if (item) board.items[id] = item;
      }
    }
  if (arg.axes && typeof arg.axes === "object")
    for (const side of Object.keys(DEFAULT_AXES))
      if (typeof arg.axes[side] === "string")
        board.axes[side] = arg.axes[side].trim() ? text(arg.axes[side], 40) : DEFAULT_AXES[side];
  if (Array.isArray(arg.three)) board.three = normaliseThree(arg.three);
  if (typeof arg.threeDate === "string")
    board.threeDate = /^\d{4}-\d{2}-\d{2}$/.test(arg.threeDate) ? arg.threeDate : "";
  if (typeof arg.title === "string") {
    if (arg.title.trim()) board.title = arg.title.slice(0, 60);
    else delete board.title;
  }
  // Keep the document to what the board knows; the ids are already bounded by validId.
  const ids = Object.keys(board.items);
  if (ids.length > ITEM_LIMIT) for (const id of ids.slice(ITEM_LIMIT)) delete board.items[id];
  return board;
}

// Where a point sits. x grows towards "in my hands", y grows downwards, so a small y matters most.
export const quadrantOf = ({ x, y }) => ({
  control: x >= 0.5 ? "yours" : "beyond",
  priority: y < 0.5 ? "high" : "low",
});

export const QUADRANT_HINTS = Object.freeze({
  "beyond:high": "Matters, but out of your hands. Name it, then let the weight go.",
  "yours:high": "In your hands and it matters. Your next three things live here.",
  "beyond:low": "Out of your hands and can wait. Park it.",
  "yours:low": "Yours, but it can wait. Come back when there is room.",
});

export const cards = (board) =>
  Object.entries(board.items)
    .filter(([, i]) => i.k === "card")
    .map(([id, i]) => ({ id, ...i }));

// summarise counts the board the way the person reads it, so the strip under the canvas can say
// "four in your hands, one not yours" instead of making them count colours.
export function summarise(board) {
  const out = {
    cards: 0,
    notes: 0,
    byStatus: { todo: 0, doing: 0, done: 0, external: 0 },
    yoursHigh: 0,
    yoursLow: 0,
    beyondHigh: 0,
    beyondLow: 0,
    weight: 0, // open cards that matter and are out of your hands: the ones worth noticing
  };
  for (const item of Object.values(board.items)) {
    if (item.k !== "card") {
      out.notes++;
      continue;
    }
    out.cards++;
    out.byStatus[item.s]++;
    const q = quadrantOf(item);
    out[
      q.control === "yours"
        ? q.priority === "high"
          ? "yoursHigh"
          : "yoursLow"
        : q.priority === "high"
          ? "beyondHigh"
          : "beyondLow"
    ]++;
    if (q.control === "beyond" && q.priority === "high" && item.s !== "done") out.weight++;
  }
  return out;
}

// suggestThree picks the open cards most worth doing today: in your hands first, highest priority first, in-progress
// before not-started. Cards already on the list and things that are not yours stay out.
export function suggestThree(board, limit = 3) {
  const taken = new Set(board.three.map((t) => t.card).filter(Boolean));
  return cards(board)
    .filter((c) => c.s !== "done" && c.s !== "external" && c.t.trim() && !taken.has(c.id))
    .sort(
      (a, b) =>
        Number(b.x >= 0.5) - Number(a.x >= 0.5) ||
        a.y - b.y ||
        Number(b.s === "doing") - Number(a.s === "doing") ||
        b.x - a.x,
    )
    .slice(0, limit);
}

export const nextZ = (board) =>
  Math.min(1_000_000, Object.values(board.items).reduce((m, i) => Math.max(m, i.z || 0), 0) + 1);

// A starter board for someone who wants to see the idea before writing their own. Nothing personal: every card is an
// example a person is expected to replace.
export function exampleBoard(today) {
  const board = emptyBoard();
  const put = (id, k, t, x, y, s) => {
    board.items[id] = {
      k,
      t,
      x,
      y,
      z: Object.keys(board.items).length + 1,
      ...(k === "card" ? { s } : {}),
    };
  };
  put("ex-sleep", "card", "Sleep", 0.52, 0.08, "todo");
  put("ex-walk", "card", "Daily walk", 0.68, 0.3, "doing");
  put("ex-course", "card", "Finish the course", 0.86, 0.22, "done");
  put("ex-garden", "card", "Tidy the garden", 0.6, 0.62, "todo");
  put("ex-admin", "card", "Renew the insurance", 0.78, 0.8, "doing");
  put("ex-boss", "card", "Someone else's deadline", 0.14, 0.4, "external");
  put("ex-note", "note", "Right of the line: in my hands. Up: matters most.", 0.1, 0.86);
  board.three = [
    { id: "three-1", t: "Ten minutes outside", done: false, card: "ex-walk" },
    { id: "three-2", t: "Lights out by eleven", done: false, card: "ex-sleep" },
  ];
  board.threeDate = today || "";
  return board;
}
