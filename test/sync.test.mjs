import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../web/sync.js";

const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: name => headers[name] ?? null }, json: async () => body, text: async () => JSON.stringify(body) });

// A server with the same contract as the real one: revisions, If-Match, If-None-Match, 409 with the current doc.
class FakeServer {
  docs = new Map();
  requests = [];
  down = false;       // connection fails
  loseReply = 0;      // apply the next N writes, then drop the connection before replying
  status = null;      // answer everything with this status instead
  authed = true;
  gate = null;        // a promise PUTs wait on
  breakBody = false;  // the snapshot's headers arrive, then the connection dies before the body is read
  lastSnapshotRequest = null; // the headers of the latest GET /api/docs
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
        const tag = `W/"${[...this.docs].map(([id, d]) => id + ":" + d.rev).sort().join(",")}"`;
        this.lastSnapshotRequest = opts.headers || {};
        if ((opts.headers || {})["If-None-Match"] === tag) return res(304, null, { ETag: tag });
        const out = res(200, Object.fromEntries([...this.docs].map(([id, d]) => [id, { rev: d.rev, body: d.body }])), { ETag: tag });
        if (this.breakBody) out.json = async () => { throw new TypeError("network error while reading the body") };
        return out;
      }
      const id = decodeURIComponent(path.replace("/api/docs/", ""));
      const cur = this.docs.get(id), curRev = cur ? cur.rev : 0;
      const h = opts.headers || {};
      if (method === "DELETE") {
        if (cur && h["If-Match"] !== undefined && Number(String(h["If-Match"]).replaceAll('"', "")) !== curRev) return res(409, { rev: curRev, body: cur.body });
        this.docs.delete(id); return res(204, null);
      }
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

test("a delete names the revision it saw, and never erases a copy saved elsewhere since", async () => {
  const s = new FakeServer(), a = device(s), b = device(s, { storage: new MemStorage() });
  const EP = "e-1790000000000", body = { when: "2026-10-01T09:00", symptoms: ["Headache"], notes: "first" };
  a.store.dispatch({ id: EP, type: "replace", arg: body }); await a.store.flush();
  await b.store.load();
  a.store.dispatch({ id: EP, type: "replace", arg: { ...body, notes: "edited on A" } }); await a.store.flush();
  assert.equal(s.docs.get(EP).rev, 2);

  s.requests.length = 0;
  b.store.dispatch({ id: EP, type: "remove" }); await b.store.flush(); // B still holds revision 1
  assert.ok(s.requests.includes(`DELETE /api/docs/${EP}`));
  const kept = s.docs.get(EP)?.body.notes === "edited on A";
  const recoverable = b.store.recoveryExport().failed.some(f => f.id === EP);
  assert.ok(kept || recoverable, "the stale delete must not silently erase A's edit");
  assert.equal(b.store.status().pending, 0);

  // "Use my change" then deletes it, now that B has seen the current revision.
  const f = b.store.recoveryExport().failed.find(x => x.id === EP);
  assert.ok(f && f.conflict, "a changed-elsewhere delete waits in Recovery");
  await b.store.retryFailed(f.key);
  assert.equal(s.docs.has(EP), false);
});

test("an unchanged refresh downloads nothing and leaves the device copy alone", async () => {
  const s = new FakeServer(), d = device(s);
  d.store.dispatch({ id: DAY, type: "replace", arg: { status: "green", entries: [] } }); await d.store.flush();
  assert.equal(await d.store.load(), true);
  assert.equal(s.lastSnapshotRequest["If-None-Match"], undefined, "the first snapshot is unconditional");
  const before = JSON.stringify(d.store.all());
  assert.equal(await d.store.load(), true);
  assert.ok(s.lastSnapshotRequest["If-None-Match"], "the second refresh offers the tag it holds");
  assert.equal(JSON.stringify(d.store.all()), before);
  assert.equal(d.store.status().offline, false);
});

test("a change made elsewhere is picked up by the next refresh, and our own save forgets the tag", async () => {
  const s = new FakeServer(), a = device(s), b = device(s, { storage: new MemStorage() });
  a.store.dispatch({ id: DAY, type: "replace", arg: { status: "green", entries: [] } }); await a.store.flush();
  await b.store.load(); await b.store.load();
  assert.ok(s.lastSnapshotRequest["If-None-Match"]);
  a.store.dispatch({ id: DAY, type: "replace", arg: { status: "red", entries: [] } }); await a.store.flush();
  await b.store.load();
  assert.equal(b.store.view(DAY).status, "red", "the remote edit shows up");

  b.store.dispatch({ id: "e-7", type: "replace", arg: { notes: "mine" } }); await b.store.flush();
  await b.store.load();
  assert.equal(s.lastSnapshotRequest["If-None-Match"], undefined, "after our own save the tag is not trusted");
});

test("a snapshot whose body fails to arrive keeps the device copy and reports offline", async () => {
  const s = new FakeServer(), d = device(s);
  d.store.dispatch({ id: DAY, type: "replace", arg: { status: "amber", entries: [] } }); await d.store.flush();
  await d.store.load();
  d.store.dispatch({ id: "e-9", type: "replace", arg: { notes: "queued while offline" } });
  s.down = true; await d.store.flush(); s.down = false;
  s.docs.set(DAY, { rev: 9, body: { status: "red", entries: [] } }); // the server moved on, so the next answer is a 200
  s.breakBody = true;
  assert.equal(await d.store.load(), false);
  assert.equal(d.store.status().offline, true, "reported, not left on Connecting");
  assert.equal(d.store.view(DAY).status, "amber", "the cached copy is untouched");
  assert.ok(d.store.view("e-9"), "the queued change is still there");
  s.breakBody = false;
  assert.equal(await d.store.load(), true, "and the next try works");
  assert.equal(d.store.view(DAY).status, "red");
});

test("refreshes asked for while one is already waiting share it", async () => {
  const s = new FakeServer(), d = device(s);
  d.store.dispatch({ id: DAY, type: "replace", arg: { status: "green", entries: [] } }); await d.store.flush();
  let release; s.gate = new Promise(r => { release = r });
  d.store.dispatch({ id: "e-3", type: "replace", arg: { notes: "slow save" } }); // holds the network queue
  s.requests.length = 0;
  const loads = [d.store.load(), d.store.load(), d.store.load()];
  release(); s.gate = null;
  const results = await Promise.all(loads);
  assert.deepEqual(results, [true, true, true]);
  assert.equal(s.requests.filter(r => r === "GET /api/docs").length, 1, "one request answered all three");
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

test("a refused change leaves the optimistic view but remains recoverable", async () => {
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
  assert.match(d.store.status().error, /forced 413/, "unrelated saves must not hide recovery");
  assert.equal(d.store.failures()[0].body.status, "red");
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
  assert.deepEqual(d.store.status(), { pending: 0, failed: 0, flushing: false, offline: false, error: "", loaded: false, durable: true, localError: "", localWrites: 0 });
  await d.store.load();
  assert.equal(d.store.status().loaded, true);
  const before = d.changes;
  d.store.dispatch(op(DAY, "setStatus", "red"));
  assert.ok(d.changes > before, "listeners hear about changes");
  assert.equal(d.store.status().pending, 1);
  await d.store.flush();
});

test("a busy or rate-limiting server (408, 425, 429) is retried, not treated as a refusal", async () => {
  for (const code of [408, 425, 429]) {
    const s = new FakeServer(), d = device(s);
    s.status = code;
    await d.store.dispatch(op(DAY, "setStatus", "red"));
    assert.equal(d.store.status().pending, 1, `${code}: the change is kept`);
    assert.equal(d.store.status().offline, true, `${code}: and retried later`);
    assert.equal(d.store.status().error, "");
    s.status = null;
    d.timers.at(-1).f();
    await d.store.flush();
    assert.equal(d.store.status().pending, 0);
    assert.equal(s.docs.get(DAY).body.status, "red");
  }
});

test("every request says whose page it is, so a page that outlived its person is refused", async () => {
  const s = new FakeServer(), d = device(s, { uid: 7 });
  const seen = [];
  const real = s.fetch;
  s.fetch = (url, opts = {}) => { seen.push((opts.headers || {})["X-Jiggered-User"]); return real(url, opts) };
  d.store.dispatch(op(DAY, "setStatus", "red")); await d.store.flush(); await d.store.load();
  assert.deepEqual(seen, ["7", "7"]);
});


test("failed edits survive reload; retries preserve ticket identity until acknowledged", async () => {
 const server=new FakeServer(),storage=new MemStorage(),a=device(server,{storage});server.status=413;
 const ticket=a.store.dispatch(op("e-1","replace",{when:"2026-10-01T10:00",notes:"keep this"}));await ticket;assert.equal(a.store.outcome(ticket.n),"failed");
 const b=device(server,{storage});assert.equal(b.store.failures()[0].body.notes,"keep this");server.status=null;let release;server.gate=new Promise(r=>release=r);
 const retry=b.store.retryFailed(b.store.failures()[0].key);assert.equal(b.store.outcome(ticket.n),"pending");release();await retry;assert.equal(b.store.outcome(ticket.n),"saved");assert.equal(b.store.status().failed,0);
});
test("asynchronous persistence must acknowledge before claiming device durability",async()=>{
 const server=new FakeServer();server.down=true;let resolve;const storage=new MemStorage();storage.setItem=()=>new Promise(r=>resolve=r);const d=device(server,{storage});
 const ticket=d.store.dispatch(op(DAY,"setStatus","red"));await ticket;assert.equal(d.store.status().durable,false);resolve();await new Promise(r=>setImmediate(r));assert.equal(d.store.status().durable,true);
 const broken=new MemStorage();broken.setItem=()=>Promise.reject(new Error("full"));const b=device(server,{storage:broken});await b.store.dispatch(op(DAY,"setStatus","red"));await new Promise(r=>setImmediate(r));assert.equal(b.store.status().durable,false);assert.match(b.store.status().localError,/could not save/);assert.equal(b.store.recoveryExport().pending[0].arg,"red");
});
test("episode field patches preserve another device's notes while finishing",async()=>{
 const server=new FakeServer(),a=device(server),b=device(server);await a.store.dispatch(op("e-1","replace",{when:"2026-10-01T10:00",notes:"original",duration:"Still going"}));await b.store.load();
 await a.store.dispatch(op("e-1","patch",{notes:"new notes"}));await b.store.dispatch(op("e-1","patch",{duration:"1–4 hours"}));assert.equal(server.docs.get("e-1").body.notes,"new notes");assert.equal(server.docs.get("e-1").body.duration,"1–4 hours");
});

test("same-field episode edits need a choice; retries explicitly choose the local value",async()=>{
 const server=new FakeServer(),a=device(server),b=device(server);
 await a.store.dispatch(op("e-1","replace",{when:"2026-10-01T10:00",notes:"original"}));await b.store.load();
 await a.store.dispatch({id:"e-1",type:"patch",arg:{notes:"remote"},before:{notes:"original"}});
 const ticket=b.store.dispatch({id:"e-1",type:"patch",arg:{notes:"local"},before:{notes:"original"}});await ticket;
 assert.equal(server.docs.get("e-1").body.notes,"remote");assert.equal(b.store.outcome(ticket.n),"failed");assert.equal(b.store.failures()[0].body.notes,"local");
 assert.equal(b.store.failures()[0].conflict,true);await b.store.retryFailed(b.store.failures()[0].key);assert.equal(server.docs.get("e-1").body.notes,"local");
});
test("a deleted episode cannot be resurrected silently by a queued edit",async()=>{
 const server=new FakeServer(),a=device(server),b=device(server);await a.store.dispatch(op("e-1","replace",{when:"2026-10-01T10:00",notes:"original"}));await b.store.load();
 await a.store.dispatch(op("e-1","remove"));await b.store.dispatch({id:"e-1",type:"patch",arg:{notes:"local"},before:{notes:"original"}});
 assert.equal(server.docs.has("e-1"),false);const f=b.store.failures()[0];assert.equal(f.deleted,true);assert.equal(f.body.when,"2026-10-01T10:00");await b.store.retryFailed(f.key);assert.equal(server.docs.get("e-1").body.when,"2026-10-01T10:00");
});
test("restore blocks dispatch and waits for the current send; failure resumes edits",async()=>{
 const server=new FakeServer(),d=device(server);let enter,finish;const entered=new Promise(r=>enter=r),gate=new Promise(r=>finish=r);
 const restore=d.store.withRestore(async()=>{enter();await gate;throw new Error("restore failed")});await entered;
 assert.throws(()=>d.store.dispatch(op(DAY,"setStatus","red")),/Restore is in progress/);assert.equal(d.store.status().restoring,true);finish();await assert.rejects(restore,/restore failed/);
 await d.store.dispatch(op(DAY,"setStatus","green"));assert.equal(server.docs.get(DAY).body.status,"green");
});
test("read-only tabs cannot overwrite device state or send queued operations",async()=>{
 const server=new FakeServer(),storage=new MemStorage();server.down=true;const a=device(server,{storage});await a.store.dispatch(op(DAY,"addEntry",entry("offline")));const saved=storage.getItem(storage.key(0));
 const readonly={writable:false,get length(){return storage.length},key:i=>storage.key(i),getItem:k=>storage.getItem(k),setItem(){throw new Error("must not write")},removeItem(){throw new Error("must not remove")}};
 const b=device(server,{storage:readonly});server.down=false;await b.store.flush();assert.equal(server.docs.has(DAY),false);assert.throws(()=>b.store.dispatch(op(DAY,"setStatus","red")),/active Jiggered tab/);assert.equal(storage.getItem(storage.key(0)),saved);
 await a.store.flush();b.store.refreshDevice();assert.deepEqual(ids(b.store.view(DAY)),["offline"]);assert.equal(b.store.status().pending,0);
});
test("deleted activity wins until explicit restoration, even when refreshed before sending",async()=>{
 const server=new FakeServer(),a=device(server),b=device(server),logged=entry('one');await a.store.dispatch(op(DAY,'addEntry',logged));await b.store.load();
 await a.store.dispatch(op(DAY,'removeEntry',logged));await b.store.load();await b.store.dispatch({id:DAY,type:'editEntry',arg:{id:logged.id,changes:{c:0}},before:logged,original:{date:'2026-10-01',entries:[logged]}});
 assert.equal(server.docs.get(DAY).body.entries.length,0);const failure=b.store.failures()[0];assert.equal(failure.deletedEntry,true);assert.equal(failure.body.entries[0].c,0);await b.store.retryFailed(failure.key);assert.equal(server.docs.get(DAY).body.entries[0].c,0);
});
