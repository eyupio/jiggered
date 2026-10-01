// Keeps this device's copy of your docs in step with the server.
//
// Every change is an operation ("add this entry", "set the check-in to amber") that goes into an outbox.
// What you see is the server's copy with the outbox applied on top, so taps feel instant and survive going
// offline or closing the app. When the outbox is sent, a doc's operations are replayed on the latest server
// copy and sent with If-Match, so two devices editing the same day merge instead of overwriting each other.
// Nothing here touches the DOM: the page passes in fetch, storage and timers (tests pass fakes).

import { applyOp } from "./model.js";

const BASE_HEADERS = { "X-Requested-With": "jiggered" };
const PREFIX = "jiggered:v1:";
const BACKOFF = [2000, 5000, 15000, 30000, 60000];
const MAX_CONFLICTS = 6;

class Stop extends Error {}

// A request that hangs (a proxy that accepted it and went quiet) must fail, so the outbox retries instead of waiting forever.
const timeout = () => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined);

export function createStore({
  fetch: doFetch = (...a) => globalThis.fetch(...a),
  storage = null,
  setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = t => clearTimeout(t),
  onChange = () => {},
  onAuthLost = () => {},
} = {}) {
  let uid = null;
  let base = {};     // id -> doc, as the server last told us
  let revs = {};     // id -> revision of that copy
  let pending = [];  // the outbox: [{ n, id, type, arg, stamp }]
  let seq = 0;
  let discarded = [], failed = [], localError = "", localWrites = 0, durable = false, persistenceVersion = 0;
  let flushing = false, offline = false, error = "", loaded = false;
  let retryTimer = null, retryCount = 0;
  let tail = Promise.resolve(); // network work runs one piece at a time, so a refresh can't land between a save and its reply

  const exclusive = fn => { const run = tail.then(fn); tail = run.catch(() => {}); return run };
  const notify = () => { try { onChange() } catch (e) { console.error(e) } };
  let who = "";
  // Keyed by id and name: after restoring an older backup an id can belong to someone else, and their queued changes
  // must not be sent into that account.
  const key = () => PREFIX + uid + (who ? ":" + who : "");
  // Every request says whose page this is. If the browser has since signed in as someone else (another tab), the
  // server refuses with 401 rather than reading or writing that other person's data under this page's name.
  const HEADERS = () => ({ ...BASE_HEADERS, "X-Jiggered-User": String(uid) });

  function persist() {
    const version = ++persistenceVersion;
    durable = false;
    if (!storage || uid == null) { localError = "Device storage is unavailable. Keep this page open."; return }
    try {
      const result = storage.setItem(key(), JSON.stringify({ v: 1, base, revs, pending, seq, failed, discarded }));
      if (result && typeof result.then === "function") {
        localWrites++;
        Promise.resolve(result).then(() => {
          if (version === persistenceVersion) { durable = true; localError = "" }
        }, () => {
          if (version === persistenceVersion) { durable = false; localError = "Device storage could not save your copy. Keep this page open." }
        }).finally(() => { localWrites--; notify() });
      } else { durable = true; localError = "" }
    } catch { localError = "Device storage is full or blocked. Keep this page open." }
  }

  // hydrate loads what this device remembers for the signed-in person. Anyone else's data is wiped:
  // it must not sit on the device for the next person to find.
  function hydrate(userId, name = "") {
    uid = userId; who = name; base = {}; revs = {}; pending = []; failed = []; discarded = []; seq = 0; durable = false; localError = "";
    if (storage) {
      try {
        for (let i = storage.length - 1; i >= 0; i--) {
          const k = storage.key(i);
          if (k && k.startsWith(PREFIX) && k !== key()) Promise.resolve(storage.removeItem(k)).catch(() => {});
        }
        const saved = JSON.parse(storage.getItem(key()) || "null");
        if (saved && saved.v === 1) { base = saved.base || {}; revs = saved.revs || {}; pending = saved.pending || []; seq = saved.seq || 0; failed = saved.failed || []; discarded = saved.discarded || []; durable = true }
      } catch { localError = "Could not read this device’s copy." }
    }
    persist(); notify();
  }

  // clear forgets everything on this device (sign out).
  function clear() {
    base = {}; revs = {}; pending = []; failed = []; discarded = []; seq = 0; ++persistenceVersion;
    if (storage && uid != null) { try { Promise.resolve(storage.removeItem(key())).catch(() => {}) } catch { /* ignore */ } }
    notify();
  }

  function view(id) {
    let body = base[id];
    for (const op of pending) if (op.id === id) body = applyOp(op, body);
    return body;
  }

  function all() {
    const out = {};
    for (const id of new Set([...Object.keys(base), ...pending.map(o => o.id)])) {
      const v = view(id);
      if (v !== undefined) out[id] = v;
    }
    return out;
  }

  // dispatch queues a change and starts sending it. The returned promise settles when that attempt is over.
  function dispatch(op) {
    pending.push({ ...op, retryOf: op.retryOf ?? op.n, n: ++seq });
    persist(); notify();
    const ticket = flush();
    ticket.n = seq;
    return ticket;
  }

  const status = () => ({ pending: pending.length, failed: failed.length, flushing, offline, error: failed.length ? failed[0].message : error, loaded, durable, localError, localWrites });
  const outcome = n => failed.some(f => f.ops.some(o => o.n === n || o.retryOf === n)) ? "failed" : pending.some(o => o.n === n || o.retryOf === n) ? "pending" : discarded.includes(n) ? "discarded" : n <= seq ? "saved" : "unknown";
  const failures = () => failed.map(f => ({ ...f }));
  function discardFailed(key) { const f = failed.find(f => f.key === key); if (f) discarded.push(...f.ops.flatMap(o => [o.n, o.retryOf].filter(n => n != null))); discarded = discarded.slice(-1000); failed = failed.filter(f => f.key !== key); persist(); notify() }
  function retryFailed(key) {
    const f = failed.find(f => f.key === key);
    if (!f) return Promise.resolve();
    failed = failed.filter(x => x.key !== key);
    for (const op of f.ops) pending.push({ ...op, retryOf: op.retryOf ?? op.n, n: ++seq });
    persist(); notify(); return flush();
  }
  const recoveryExport = () => ({ format: "jiggered-device-recovery-v1", exportedAt: new Date().toISOString(), username: who, docs: all(), pending, failed });

  // ---- talking to the server ----

  const reason = async r => { try { const j = await r.json(); return (j && j.error) || "" } catch { return "" } };

  async function send(id, body, rev) {
    const url = "/api/docs/" + encodeURIComponent(id);
    if (body === undefined) {
      const r = await doFetch(url, { method: "DELETE", headers: HEADERS(), credentials: "same-origin", signal: timeout() });
      return { status: r.status, rev: 0, message: r.status === 204 ? "" : await reason(r) };
    }
    const headers = { ...HEADERS(), "Content-Type": "application/json", ...(rev > 0 ? { "If-Match": `"${rev}"` } : { "If-None-Match": "*" }) };
    const r = await doFetch(url, { method: "PUT", headers, body: JSON.stringify(body), credentials: "same-origin", signal: timeout() });
    if (r.status === 200) return { status: 200, rev: (await r.json()).rev };
    if (r.status === 409) { const j = await r.json(); return { status: 409, rev: j.rev, body: j.body } }
    return { status: r.status, message: await reason(r) };
  }

  const adopt = (id, rev, body) => {
    if (body == null) { delete base[id]; delete revs[id] } else { base[id] = body; revs[id] = rev }
  };

  function settle(id, body, rev, lastN) {
    if (body === undefined) { delete base[id]; delete revs[id] } else { base[id] = body; revs[id] = rev }
    pending = pending.filter(o => !(o.id === id && o.n <= lastN));
    error = ""; retryCount = 0;
    persist(); notify();
  }

  // Refused content stays recoverable; successful unrelated saves never clear it.
  function dropBatch(id, lastN, message) {
    const ops = pending.filter(o => o.id === id && o.n <= lastN);
    failed.push({ key: `${Date.now()}-${lastN}`, id, ops, body: ops.reduce((b, op) => applyOp(op, b), base[id]), message: message || "The server refused this change.", at: Date.now() });
    pending = pending.filter(o => !(o.id === id && o.n <= lastN));
    persist(); notify();
  }

  async function drain() {
    if (retryTimer) { clearTimer(retryTimer); retryTimer = null }
    flushing = pending.length > 0; notify();
    try {
      while (pending.length) {
        const id = pending[0].id;
        const batch = pending.filter(o => o.id === id);
        const lastN = batch[batch.length - 1].n;
        for (let conflicts = 0; ;) {
          const body = batch.reduce((b, op) => applyOp(op, b), base[id]);
          const res = await send(id, body, revs[id] || 0);
          if (res.status === 200 || res.status === 204) { settle(id, body, res.rev, lastN); break }
          if (res.status === 409) {
            if (++conflicts > MAX_CONFLICTS) throw new Error("kept conflicting");
            adopt(id, res.rev, res.body); // someone saved first: take their copy and replay our changes on it
            continue;
          }
          if (res.status === 401) { onAuthLost(); throw new Stop() }
          if ([408, 425, 429].includes(res.status)) throw new Error("HTTP " + res.status); // transient: keep the change and retry
          if (res.status >= 400 && res.status < 500) { if (failed.length >= 100) throw new Error("Recovery is full. Download or resolve older refused changes first."); dropBatch(id, lastN, res.message); break }
          throw new Error("HTTP " + res.status);
        }
      }
      offline = false;
    } catch (e) {
      if (!(e instanceof Stop)) {
        offline = true;
        if (e.message?.startsWith("Recovery is full")) error = e.message;
        // Back off only when a scheduled retry itself fails; extra attempts from the person tapping don't count.
        retryTimer = setTimer(() => { retryTimer = null; retryCount++; flush() }, BACKOFF[Math.min(retryCount, BACKOFF.length - 1)]);
      }
    } finally {
      flushing = false; notify();
    }
  }

  const flush = () => exclusive(drain);

  // load refreshes from the server. Changes still in the outbox stay on top of it.
  function load() {
    return exclusive(async () => {
      let r;
      try { r = await doFetch("/api/docs", { credentials: "same-origin", headers: { Accept: "application/json", "X-Jiggered-User": String(uid) }, signal: timeout() }) }
      catch { offline = true; notify(); return false }
      if (r.status === 401) { onAuthLost(); return false }
      if (!r.ok) { offline = true; notify(); return false }
      const server = await r.json();
      base = {}; revs = {};
      for (const [id, d] of Object.entries(server)) { base[id] = d.body; revs[id] = d.rev }
      loaded = true; offline = false;
      persist(); notify();
      return true;
    }).then(ok => { if (ok && pending.length) flush(); return ok });
  }

  return { hydrate, clear, view, all, dispatch, flush, load, status, outcome, failures, discardFailed, retryFailed, recoveryExport };
}
