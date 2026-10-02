// Keeps this device's copy of your docs in step with the server.
//
// Every change is an operation ("add this entry", "set the check-in to amber") that goes into an outbox.
// What you see is the server's copy with the outbox applied on top, so taps feel instant and survive going
// offline or closing the app. When the outbox is sent, a doc's operations are replayed on the latest server
// copy and sent with If-Match, so two devices editing the same day merge instead of overwriting each other.
// Nothing here touches the DOM: the page passes in fetch, storage and timers (tests pass fakes).

import { applyOp, operationConflicts, validateSettings, normaliseSettings, identifyEntries } from "./model.js";

const BASE_HEADERS = { "X-Requested-With": "jiggered" };
const PREFIX = "jiggered:v1:";
const BACKOFF = [2000, 5000, 15000, 30000, 60000];
const MAX_CONFLICTS = 6;

class Stop extends Error {}

// A request that hangs (a proxy that accepted it and went quiet) must fail, so the outbox retries instead of waiting forever.
// A full snapshot may be large and the server allows it five minutes; saves are small and keep the short limit.
const snapshotTimeout = () => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(300000) : undefined);
const timeout = () => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined);

export function createStore({
  fetch: doFetch = (...a) => globalThis.fetch(...a),
  storage = null,
  setTimer = (f, ms) => setTimeout(f, ms),
  clearTimer = t => clearTimeout(t),
  onChange = () => {},
  onAuthLost = () => {},
} = {}) {
  let uid = null, stopped = false;
  let snapshotTag = null; // ETag of the last full snapshot; forgotten as soon as anything else changes base, so it is only ever sent while base is exactly that snapshot
  let queuedLoad = null;  // a refresh waiting its turn: more requests for one share it
  let base = {};     // id -> doc, as the server last told us
  let revs = {};     // id -> revision of that copy
  let pending = [];  // the outbox: [{ n, id, type, arg, stamp }]
  let seq = 0;
  let discarded = [], failed = [], localError = "", localWrites = 0, durable = false, persistenceVersion = 0;
  let restoring = false;
  const readOnly = () => storage?.writable === false;
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
    if (stopped) return;
    const version = ++persistenceVersion;
    if (readOnly()) return;
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
    if (stopped) return;
    uid = userId; who = name; snapshotTag = null; base = {}; revs = {}; pending = []; failed = []; discarded = []; seq = 0; durable = false; localError = "";
    if (storage) {
      try {
        for (let i = storage.length - 1; i >= 0; i--) {
          const k = storage.key(i);
          if (!readOnly() && k && k.startsWith(PREFIX) && k !== key()) Promise.resolve(storage.removeItem(k)).catch(() => {});
        }
        const saved = JSON.parse(storage.getItem(key()) || "null");
        if (saved && saved.v === 1) { base = saved.base || {}; revs = saved.revs || {}; pending = saved.pending || []; seq = saved.seq || 0; failed = saved.failed || []; discarded = saved.discarded || []; durable = true }
      } catch { localError = "Could not read this device’s copy." }
    }
    if (!readOnly()) persist(); notify();
  }

  // clear forgets everything on this device (sign out).
  async function clear() {
    stopped = true; clearTimer(retryTimer); retryTimer = null;
    snapshotTag = null; base = {}; revs = {}; pending = []; failed = []; discarded = []; seq = 0; ++persistenceVersion;
    if (storage && uid != null) { if (storage.purge) await storage.purge(); else await storage.removeItem(key()) }
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
    if (stopped) throw new Error("This device was signed out.");
    if (readOnly() || restoring) throw new Error(readOnly() ? "Use the active Jiggered tab to make changes." : "Restore is in progress. Try again when it finishes.");
    pending.push({ ...op, retryOf: op.retryOf ?? op.n, n: ++seq });
    persist(); notify();
    const ticket = flush();
    ticket.n = seq;
    return ticket;
  }

  const status = () => ({ pending: pending.length, failed: failed.length, flushing, offline, error: failed.length ? failed[0].message : error, loaded, durable, localError, localWrites, ...(readOnly() ? { readOnly: true } : {}), ...(restoring ? { restoring: true } : {}) });
  const outcome = n => failed.some(f => f.ops.some(o => o.n === n || o.retryOf === n)) ? "failed" : pending.some(o => o.n === n || o.retryOf === n) ? "pending" : discarded.includes(n) ? "discarded" : n <= seq ? "saved" : "unknown";
  const failures = () => failed.map(f => ({ ...f }));
  function discardFailed(key) { if (stopped || readOnly() || restoring) return; const f = failed.find(f => f.key === key); if (f) discarded.push(...f.ops.flatMap(o => [o.n, o.retryOf].filter(n => n != null))); discarded = discarded.slice(-1000); failed = failed.filter(f => f.key !== key); persist(); notify() }
  function retryFailed(key) {
    if (readOnly() || restoring) return Promise.resolve();
    const f = failed.find(f => f.key === key);
    if (!f) return Promise.resolve();
    failed = failed.filter(x => x.key !== key);
    for (let op of f.ops) {
      if (f.deletedEntry && op.type === "editEntry") {
        const entries = identifyEntries(f.body?.entries), index = entries.findIndex(e => e.id === op.arg.id);
        if (index >= 0) op = { ...op, type: "restoreEntry", arg: { entry: entries[index], index } };
      }
      pending.push({ ...op, ...(f.conflict ? { before: undefined, ...(f.deleted ? { type: "replace", arg: f.body } : {}) } : {}), retryOf: op.retryOf ?? op.n, n: ++seq });
    }
    persist(); notify(); return flush();
  }
  const recoveryExport = () => ({ format: "jiggered-device-recovery-v1", exportedAt: new Date().toISOString(), username: who, docs: all(), pending, failed });

  // ---- talking to the server ----

  const reason = async r => { try { const j = await r.json(); return (j && j.error) || "" } catch { return "" } };

  async function send(id, body, rev) {
    const url = "/api/docs/" + encodeURIComponent(id);
    if (body === undefined) {
      // Name the revision being deleted, so a copy saved elsewhere since is returned (409) rather than erased.
      const headers = { ...HEADERS(), ...(rev > 0 ? { "If-Match": `"${rev}"` } : {}) };
      const r = await doFetch(url, { method: "DELETE", headers, credentials: "same-origin", signal: timeout() });
      if (r.status === 409) { const j = await r.json(); return { status: 409, rev: j.rev, body: j.body } }
      return { status: r.status, rev: 0, message: r.status === 204 ? "" : await reason(r) };
    }
    const headers = { ...HEADERS(), "Content-Type": "application/json", ...(rev > 0 ? { "If-Match": `"${rev}"` } : { "If-None-Match": "*" }) };
    const r = await doFetch(url, { method: "PUT", headers, body: JSON.stringify(body), credentials: "same-origin", signal: timeout() });
    if (r.status === 200) return { status: 200, rev: (await r.json()).rev };
    if (r.status === 409) { const j = await r.json(); return { status: 409, rev: j.rev, body: j.body } }
    return { status: r.status, message: await reason(r) };
  }

  const adopt = (id, rev, body) => {
    snapshotTag = null;
    if (body == null) { delete base[id]; delete revs[id] } else { base[id] = body; revs[id] = rev }
  };

  function settle(id, body, rev, lastN) {
    snapshotTag = null;
    if (body === undefined) { delete base[id]; delete revs[id] } else { base[id] = body; revs[id] = rev }
    pending = pending.filter(o => !(o.id === id && o.n <= lastN));
    error = ""; retryCount = 0;
    persist(); notify();
  }

  // Refused content stays recoverable; successful unrelated saves never clear it.
  function dropBatch(id, lastN, message, extra = {}) {
    if (failed.length >= 100) throw new Error("Recovery is full. Download or resolve older refused changes first.");
    const ops = pending.filter(o => o.id === id && o.n <= lastN);
    failed.push({ key: `${Date.now()}-${lastN}`, id, ops, body: ops.reduce((b, op) => applyOp(op, b), base[id]), message: message || "The server refused this change.", at: Date.now(), ...extra });
    pending = pending.filter(o => !(o.id === id && o.n <= lastN));
    persist(); notify();
  }

  async function drain() {
    if (stopped || readOnly() || restoring) return;
    if (retryTimer) { clearTimer(retryTimer); retryTimer = null }
    flushing = pending.length > 0; notify();
    try {
      while (pending.length) {
        const id = pending[0].id;
        const batch = pending.filter(o => o.id === id);
        const lastN = batch[batch.length - 1].n;
        const desired = batch.reduce((b,op) => {
          if (op.type === "editEntry" && !identifyEntries(b?.entries).some(e=>e.id===op.arg.id)) {
            const originals = identifyEntries(op.original?.entries), index = originals.findIndex(e=>e.id===op.arg.id);
            const previous = originals[index] || op.before;
            if (previous?.a) return applyOp({ ...op, type: "restoreEntry", arg: { entry: { ...previous,...op.arg.changes,id:op.arg.id }, index: index < 0 ? (b?.entries?.length || 0) : index } },b);
          }
          return applyOp(op,b);
        },base[id] ?? batch[0].original);
        for (let conflicts = 0; ;) {
          let current = base[id];
          const fields = [];
          for (const op of batch) { fields.push(...operationConflicts(op,current)); current = applyOp(op,current) }
          if (fields.length) {
            dropBatch(id,lastN,`Changed elsewhere: ${[...new Set(fields)].join(", ")}. Keep the server copy or explicitly use your change.`, { conflict: true, deleted: base[id] == null, deletedEntry: fields.includes("deleted activity"), body: desired });
            break;
          }
          const body = batch.reduce((b, op) => applyOp(op, b), base[id]);
          if (batch.some(op => op.type === "settingsPatch")) {
            const errors = validateSettings({ ...normaliseSettings(body), ...body });
            if (errors.length) { dropBatch(id,lastN,"Combined settings need review: " + errors.map(([,message])=>message).join(" "), { conflict: true, body: desired }); break }
          }
          const res = await send(id, body, revs[id] || 0);
          if (stopped) throw new Stop();
          if (res.status === 200 || res.status === 204) { settle(id, body, res.rev, lastN); break }
          if (res.status === 409) {
            if (++conflicts > MAX_CONFLICTS) throw new Error("kept conflicting");
            adopt(id, res.rev, res.body); // someone saved first: take their copy and replay our changes on it
            // A delete is not replayed over a copy that changed since this device last saw it: the person chooses
            // in Recovery ("Keep server copy", or "Use my change" to delete it anyway).
            if (body === undefined && res.body != null) {
              dropBatch(id, lastN, "Changed elsewhere since you deleted it. Keep the server copy or explicitly delete it.", { conflict: true, body: undefined });
              break;
            }
            continue;
          }
          if (res.status === 401) { onAuthLost(); await clear(); throw new Stop() }
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
  // Serialize the entire destructive workflow with refreshes and sends; reject new writes meanwhile.
  function withRestore(task) {
    return exclusive(async () => {
      if (readOnly()) throw new Error("Restore in the active Jiggered tab.");
      await drain();
      if (pending.length || failed.length) throw new Error("Resolve queued or refused changes before restoring. Download recovery to keep them.");
      restoring = true; notify();
      try { return await task() } finally { restoring = false; notify() }
    });
  }
  function refreshDevice() { if (readOnly()) { hydrate(uid,who); loaded = true; notify() } }


  // load refreshes from the server. Changes still in the outbox stay on top of it. When this device already holds the
  // server's current snapshot the server says so (304) and nothing is downloaded, parsed or rewritten. Any failure,
  // including one while the body is arriving, leaves the copy on this device exactly as it was and reports offline.
  function load() {
    if (queuedLoad) return queuedLoad; // a refresh is already waiting its turn and will see everything this one would
    const run = exclusive(async () => {
      queuedLoad = null;
      try {
        const headers = { Accept: "application/json", "X-Jiggered-User": String(uid), ...(snapshotTag && loaded ? { "If-None-Match": snapshotTag } : {}) };
        const r = await doFetch("/api/docs", { credentials: "same-origin", headers, signal: snapshotTimeout() });
        if (r.status === 401) { onAuthLost(); await clear(); return false }
        if (stopped) return false;
        if (r.status === 304 && snapshotTag) { offline = false; notify(); return true }
        if (!r.ok) { offline = true; notify(); return false }
        const server = await r.json();
        if (stopped) return false;
        const tag = r.headers?.get?.("ETag") || null;
        base = {}; revs = {};
        for (const [id, d] of Object.entries(server)) { base[id] = d.body; revs[id] = d.rev }
        snapshotTag = tag;
        loaded = true; offline = false;
        persist(); notify();
        return true;
      } catch {
        offline = true; notify(); return false; // a dropped connection or a body that never finished: keep what we have
      }
    });
    queuedLoad = run;
    return run.then(ok => { if (ok && pending.length) flush(); return ok });
  }

  return { hydrate, clear, withRestore, refreshDevice, view, all, dispatch, flush, load, status, outcome, failures, discardFailed, retryFailed, recoveryExport };
}

