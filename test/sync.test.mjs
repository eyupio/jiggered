import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../web/sync.js";

const res = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body) });

// A server with the same contract as the real one: revisions, If-Match, If-None-Match, 409 with the current doc.
class FakeServer {
  docs = new Map();
  requests = [];
  down = false;       // connection fails
  loseReply = 0;      // apply the next N writes, then drop the connection before replying
  status = null;      // answer everything with this status instead
  authed = true;
  gate = null;        // a promise PUTs wait on
  inflight = 0;
  maxInflight = 0;
  fetch = async (url, opts = {}) => {
    const method = opts.method || "GET";
    this.requests.push(`${method} ${url}`);
    this.inflight++; this.maxInflight = Math.max(this.maxInflight, this.inflight);
    try {
      if (this.down) throw new TypeError("Failed to fetch");
      if (!this.authed) return res(401, { error: "signed out" });
      if (this.status) return res(this.status, { error: "forced " + this.status });
      if (this.gate && method === "PUT") await this.gate;
      const path = new URL(url, "http://x").pathname;
      if (path === "/api/docs" && method === "GET") {
        return res(200, Object.fromEntries([...this.docs].map(([id, d]) => [id, { rev: d.rev, body: d.body }])));
      }
      const id = decodeURIComponent(path.replace("/api/docs/", ""));
      if (method === "DELETE") { this.docs.delete(id); return res(204, null) }
      const cur = this.docs.get(id), curRev = cur ? cur.rev : 0;
      const h = opts.headers || {};
      if ((h["If-None-Match"] === "*" && cur) || (h["If-Match"] !== undefined && Number(String(h["If-Match"]).replaceAll('"', "")) !== curRev)) {
        return res(409, { rev: curRev, body: cur ? cur.body : null });
      }
      this.docs.set(id, { rev: curRev + 1, body: JSON.parse(opts.body) });
      if (this.loseReply > 0) { this.loseReply--; throw new TypeError("connection reset") }
      return res(200, { rev: curRev + 1 });
    } finally { this.inflight-- }
  };
}

class MemStorage {
  m = new Map();
  get length() { return this.m.size }
  key(i) { return [...this.m.keys()][i] ?? null }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null }
  setItem(k, v) { this.m.set(k, String(v)) }
  removeItem(k) { this.m.delete(k) }
}

// A device: a store wired to the server, a storage, and timers the test steps by hand.
function device(server, { storage = new MemStorage(), uid = 1 } = {}) {
  const timers = [];
  const d = { server, storage, timers, authLost: 0, changes: 0 };
  d.store = createStore({
    fetch: (...a) => server.fetch(...a), storage,
    setTimer: (f, ms) => { const t = { f, ms }; timers.push(t); return t },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) },
    onChange: () => d.changes++,
    onAuthLost: () => d.authLost++,
  });
  d.store.hydrate(uid);
  d.fireTimer = async () => { const t = timers.shift(); t.f(); await d.store.flush() };
  return d;
}

const DAY = "d-2026-10-01";
const op = (id, type, arg) => ({ id, type, arg });
const entry = (id, a = "Meeting", c = 2) => ({ id, a, c, t: "10:00" });
const ids = body => body.entries.map(e => e.id);

test("a change shows at once, reaches the server, and empties the outbox", async () => {
  const s = new FakeServer(), d = device(s);
  d.store.dispatch(op(DAY, "setStatus", "amber"));
  assert.equal(d.store.view(DAY).status, "amber", "visible before any network traffic");
  assert.equal(d.store.status().pending, 1);
  await d.store.flush();
  assert.equal(s.docs.get(DAY).body.status, "amber");
  assert.equal(s.docs.get(DAY).rev, 1);
  assert.equal(d.store.status().pending, 0);
  assert.equal(d.store.status().offline, false);
  d.store.dispatch(op(DAY, "setStatus", "red"));
  await d.store.flush();
  assert.equal(s.docs.get(DAY).rev, 2);
  assert.equal(d.store.view(DAY).status, "red");
});

test("bug: two devices used to overwrite each other; now their changes merge", async () => {
  const s = new FakeServer(), phone = device(s), laptop = device(s);
  await phone.store.load(); await laptop.store.load(); // neither has seen anything yet
  phone.store.dispatch(op(DAY, "addEntry", entry("p1", "Meeting or call")));
  await phone.store.flush();
  laptop.store.dispatch(op(DAY, "addEntry", entry("l1", "Quiet break", -1))); // laptop never saw the phone's tap
  await laptop.store.flush();
  assert.deepEqual(ids(s.docs.get(DAY).body), ["p1", "l1"]);
  assert.deepEqual(ids(laptop.store.view(DAY)), ["p1", "l1"], "and the laptop now shows both");
  await phone.store.load();
  assert.deepEqual(ids(phone.store.view(DAY)), ["p1", "l1"]);
});

test("different kinds of change to the same day merge too", async () => {
  const s = new FakeServer(), a = device(s), b = device(s);
  await a.store.load(); await b.store.load();
  a.store.dispatch(op(DAY, "setStatus", "green"));
  b.store.dispatch(op(DAY, "setPoorSleep", true));
  b.store.dispatch(op(DAY, "addEntry", entry("b1")));
  await Promise.all([a.store.flush(), b.store.flush()]);
  const body = s.docs.get(DAY).body;
  assert.equal(body.status, "green"); assert.equal(body.poorSleep, true); assert.deepEqual(ids(body), ["b1"]);
});

test("removing an entry that someone else has changed around still works", async () => {
  const s = new FakeServer(), a = device(s), b = device(s);
  a.store.dispatch(op(DAY, "addEntry", entry("x1"))); a.store.dispatch(op(DAY, "addEntry", entry("x2")));
  await a.store.flush(); await b.store.load();
  a.store.dispatch(op(DAY, "addEntry", entry("x3"))); await a.store.flush();
  b.store.dispatch(op(DAY, "removeEntry", entry("x1"))); await b.store.flush(); // b is a revision behind
  assert.deepEqual(ids(s.docs.get(DAY).body), ["x2", "x3"]);
});

test("a retry after a lost reply does not add the entry twice", async () => {
  const s = new FakeServer(), d = device(s);
  s.loseReply = 1;
  await d.store.dispatch(op(DAY, "addEntry", entry("once")));
  assert.equal(s.docs.get(DAY).rev, 1, "the server did save it");
  assert.equal(d.store.status().offline, true, "but we never heard back");
  assert.equal(d.store.status().pending, 1);
  await d.fireTimer(); // the retry: our revision is stale, so the server answers 409 and we replay on its copy
  assert.deepEqual(ids(s.docs.get(DAY).body), ["once"]);
  assert.equal(d.store.status().pending, 0);
  assert.equal(d.store.status().offline, false);
});

test("bug: a failed save used to vanish on the next refresh; now it waits and then saves", async () => {
  const s = new FakeServer(), d = device(s);
  s.down = true;
  d.store.dispatch(op(DAY, "addEntry", entry("e1")));
  await d.store.flush();
  assert.equal(d.store.status().offline, true);
  assert.equal(d.store.status().pending, 1);
  assert.deepEqual(ids(d.store.view(DAY)), ["e1"], "still on screen");

  assert.equal(await d.store.load(), false, "refreshing while offline changes nothing");
  assert.deepEqual(ids(d.store.view(DAY)), ["e1"]);

  s.down = false; // back on signal: the app returns to the foreground and refreshes
  assert.equal(await d.store.load(), true);
  assert.deepEqual(ids(d.store.view(DAY)), ["e1"], "the refresh must not wipe it");
  await d.store.flush();
  assert.deepEqual(ids(s.docs.get(DAY).body), ["e1"]);
  assert.equal(d.store.status().pending, 0);
});

test("a refresh keeps unsent changes on top of what others saved meanwhile", async () => {
  const s = new FakeServer(), a = device(s), b = device(s);
  s.down = true;
  a.store.dispatch(op(DAY, "addEntry", entry("a1"))); await a.store.flush();
  s.down = false;
  b.store.dispatch(op(DAY, "addEntry", entry("b1"))); await b.store.flush();
  s.down = true; await a.store.flush(); s.down = false;
  await a.store.load();
  assert.deepEqual(ids(a.store.view(DAY)), ["b1", "a1"]);
  await a.store.flush();
  assert.deepEqual(ids(s.docs.get(DAY).body), ["b1", "a1"]);
});

test("delete, and undo of a delete", async () => {
  const s = new FakeServer(), d = device(s);
  const EP = "e-1790000000000", body = { when: "2026-10-01T09:00", symptoms: ["Headache"], notes: "keep me" };
  d.store.dispatch({ id: EP, type: "replace", arg: body }); await d.store.flush();
  assert.equal(s.docs.get(EP).rev, 1);

  d.store.dispatch({ id: EP, type: "remove" });
  assert.equal(d.store.view(EP), undefined);
  assert.equal(EP in d.store.all(), false);
  await d.store.flush();
  assert.equal(s.docs.has(EP), false);

  d.store.dispatch({ id: EP, type: "replace", arg: body }); // Undo
  await d.store.flush();
  assert.deepEqual(s.docs.get(EP).body, body);

  // Undo before the delete was even sent: one request, doc intact.
  s.requests.length = 0;
  s.down = true;
  d.store.dispatch({ id: EP, type: "remove" }); d.store.dispatch({ id: EP, type: "replace", arg: body });
  await d.store.flush(); s.down = false; s.requests.length = 0;
  await d.fireTimer();
  assert.deepEqual(s.requests, [`PUT /api/docs/${EP}`]);
  assert.deepEqual(s.docs.get(EP).body, body);
});

test("deleting something the server never had is fine", async () => {
  const s = new FakeServer(), d = device(s);
  d.store.dispatch({ id: "e-5", type: "remove" });
  await d.store.flush();
  assert.equal(d.store.status().pending, 0);
  assert.equal(d.store.status().error, "");
});

test("queued changes survive closing the app", async () => {
  const s = new FakeServer(), storage = new MemStorage();
  const before = device(s, { storage });
  s.down = true;
  before.store.dispatch(op(DAY, "setStatus", "red"));
  before.store.dispatch(op(DAY, "addEntry", entry("z1")));
  await before.store.flush();

  const after = device(s, { storage }); // a new page load: same device, same storage
  assert.equal(after.store.status().pending, 2);
  assert.equal(after.store.view(DAY).status, "red", "shown immediately, before any network");
  s.down = false;
  await after.store.flush();
  assert.equal(s.docs.get(DAY).body.status, "red");
  assert.deepEqual(ids(s.docs.get(DAY).body), ["z1"]);
  // The cache itself also lets the app open with its last data while offline.
  s.down = true;
  const offlineStart = device(s, { storage });
  assert.deepEqual(ids(offlineStart.store.view(DAY)), ["z1"]);
});

test("another person's cached data is wiped when someone else signs in on the same device", () => {
  const storage = new MemStorage();
  storage.setItem("jiggered:v1:2", JSON.stringify({ v: 1, base: { [DAY]: { status: "red" } }, revs: { [DAY]: 1 }, pending: [], seq: 0 }));
  storage.setItem("unrelated", "keep");
  const d = device(new FakeServer(), { storage, uid: 1 });
  assert.equal(storage.getItem("jiggered:v1:2"), null);
  assert.equal(storage.getItem("unrelated"), "keep");
  assert.equal(d.store.view(DAY), undefined, "and user 1 doesn't inherit it");
  d.store.dispatch(op(DAY, "setStatus", "green"));
  d.store.clear();
  assert.equal(storage.getItem("jiggered:v1:1"), null, "sign out clears this person's cache");
  assert.equal(d.store.status().pending, 0);
});

test("a corrupt or unavailable cache is not fatal", async () => {
  const storage = new MemStorage();
  storage.setItem("jiggered:v1:1", "{not json");
  const d = device(new FakeServer(), { storage });
  assert.equal(d.store.status().pending, 0);
  const broken = { length: 0, key() { return null }, getItem() { throw new Error("denied") }, setItem() { throw new Error("full") }, removeItem() { throw new Error("denied") } };
  const s = new FakeServer(), e = device(s, { storage: broken });
  e.store.dispatch(op(DAY, "setStatus", "green"));
  await e.store.flush();
  assert.equal(s.docs.get(DAY).body.status, "green", "works in memory when storage throws");
});

test("a change the server refuses is dropped with a reason, not retried forever", async () => {
  const s = new FakeServer(), d = device(s);
  s.status = 413;
  d.store.dispatch(op(DAY, "setStatus", "red"));
  await d.store.flush();
  assert.equal(d.store.status().pending, 0);
  assert.match(d.store.status().error, /forced 413/);
  assert.equal(d.timers.length, 0, "no retry scheduled");
  assert.equal(d.store.view(DAY), undefined, "the refused change is no longer shown as if it had saved");
  s.status = null;
  d.store.dispatch(op(DAY, "setStatus", "green"));
  await d.store.flush();
  assert.equal(d.store.status().error, "", "a later success clears the message");
});

test("server trouble is retried with growing delays, then recovers", async () => {
  const s = new FakeServer(), d = device(s);
  s.status = 503;
  await d.store.dispatch(op(DAY, "setStatus", "red"));
  assert.equal(d.store.status().offline, true);
  assert.equal(d.store.status().pending, 1);
  assert.deepEqual(d.timers.map(t => t.ms), [2000]);
  await d.store.dispatch(op(DAY, "setPoorSleep", true)); // tapping again while offline must not skip ahead in the schedule
  await d.store.dispatch(op(DAY, "setPoorSleep", false));
  assert.deepEqual(d.timers.map(t => t.ms), [2000]);
  await d.fireTimer();
  assert.deepEqual(d.timers.map(t => t.ms), [5000]);
  await d.fireTimer();
  assert.deepEqual(d.timers.map(t => t.ms), [15000]);
  s.status = null;
  await d.fireTimer();
  assert.equal(d.store.status().pending, 0);
  assert.equal(d.store.status().offline, false);
  assert.equal(d.timers.length, 0);
  assert.equal(s.docs.get(DAY).body.status, "red");
});

test("being signed out keeps the queue and stops trying", async () => {
  const s = new FakeServer(), d = device(s);
  s.authed = false;
  await d.store.dispatch(op(DAY, "setStatus", "red"));
  assert.equal(d.authLost, 1);
  assert.equal(d.store.status().pending, 1, "kept for when they sign back in");
  assert.equal(d.timers.length, 0);
  assert.equal(await d.store.load(), false);
  assert.equal(d.authLost, 2);
  s.authed = true; // signed back in
  await d.store.flush();
  assert.equal(s.docs.get(DAY).body.status, "red");
});

test("bug: a slow refresh could land after a save and undo it; network work now runs one piece at a time", async () => {
  const s = new FakeServer(), d = device(s);
  let release; s.gate = new Promise(r => release = r);
  d.store.dispatch(op(DAY, "addEntry", entry("g1")));    // PUT starts and waits on the gate
  const refreshed = d.store.load();                       // the app comes back to the foreground meanwhile
  release();
  assert.equal(await refreshed, true);
  await d.store.flush();
  assert.deepEqual(ids(d.store.view(DAY)), ["g1"]);
  assert.equal(s.maxInflight, 1, "never two requests at once");
  assert.deepEqual(s.requests.map(r => r.split(" ")[0]), ["PUT", "GET"], "the refresh waited its turn");
});

test("a doc deleted elsewhere disappears on refresh", async () => {
  const s = new FakeServer(), d = device(s);
  d.store.dispatch(op(DAY, "setStatus", "red")); await d.store.flush();
  s.docs.delete(DAY);
  await d.store.load();
  assert.equal(d.store.view(DAY), undefined);
  assert.deepEqual(d.store.all(), {});
});

test("a server that always conflicts can't trap us in a loop", async () => {
  const s = new FakeServer(), d = device(s);
  const real = s.fetch;
  s.fetch = async (url, opts = {}) => (opts.method === "PUT" ? (s.requests.push("PUT"), res(409, { rev: 7, body: { date: "2026-10-01", entries: [] } })) : real(url, opts));
  await d.store.dispatch(op(DAY, "setStatus", "red"));
  assert.equal(d.store.status().offline, true, "gives up and retries later");
  assert.equal(s.requests.length, 7, "one try plus six rebases, then it stops");
  assert.equal(d.store.status().pending, 1);
});

test("settings are just another doc", async () => {
  const s = new FakeServer(), d = device(s);
  d.store.dispatch({ id: "settings", type: "replace", arg: { budget: 12 } });
  await d.store.flush();
  assert.deepEqual(s.docs.get("settings").body, { budget: 12 });
  d.store.dispatch({ id: "settings", type: "replace", arg: { budget: 8 } });
  await d.store.flush();
  assert.equal(s.docs.get("settings").rev, 2);
  assert.equal(d.store.view("settings").budget, 8);
});

test("status reports what the page needs to show", async () => {
  const s = new FakeServer(), d = device(s);
  assert.deepEqual(d.store.status(), { pending: 0, flushing: false, offline: false, error: "", loaded: false });
  await d.store.load();
  assert.equal(d.store.status().loaded, true);
  const before = d.changes;
  d.store.dispatch(op(DAY, "setStatus", "red"));
  assert.ok(d.changes > before, "listeners hear about changes");
  assert.equal(d.store.status().pending, 1);
  await d.store.flush();
});
