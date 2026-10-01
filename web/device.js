// A synchronous in-memory view backed by acknowledged IndexedDB transactions.
// The large cache/outbox lives here rather than competing with localStorage's small quota.
export async function openDeviceStorage({ indexedDB = globalThis.indexedDB, legacy = null, userId = null, username = "" } = {}) {
  if (!indexedDB) return legacy;
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("jiggered-device", 1);
      let expired = false;
      const timer = setTimeout(() => { expired = true; reject(new Error("Device storage is unavailable")) }, 6000);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains("items")) request.result.createObjectStore("items") };
      request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result) };
      request.onerror = () => { expired = true; clearTimeout(timer); reject(request.error) };
      request.onblocked = () => { expired = true; clearTimeout(timer); reject(new Error("Close another old Jiggered tab to open device storage")) };
    });
    const cache = await new Promise((resolve, reject) => {
      const tx = db.transaction("items", "readonly"), store = tx.objectStore("items");
      const keys = store.getAllKeys(), values = store.getAll();
      tx.oncomplete = () => resolve(new Map(keys.result.map((k, i) => [k, values.result[i]])));
      tx.onerror = tx.onabort = () => reject(tx.error || new Error("Device storage could not be read"));
    });
    let tail = Promise.resolve();
    const write = action => {
      const promise = tail.then(() => new Promise((resolve, reject) => {
        const tx = db.transaction("items", "readwrite");
        action(tx.objectStore("items"));
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => reject(tx.error || new Error("Device storage is full or unavailable"));
      }));
      tail = promise.catch(() => {});
      return promise;
    };
    const retainedLegacy = new Map();
    const expectedKey = userId == null ? null : `jiggered:v1:${userId}:${username}`;
    const storage = {
      kind: "IndexedDB",
      legacyCopies(id, name) { const value = retainedLegacy.get(`jiggered:v1:${id}:${name}`); return value ? [value] : [] },
      get length() { return cache.size },
      key: i => [...cache.keys()][i] ?? null,
      getItem: key => cache.get(key) ?? null,
      setItem(key, value) { cache.set(key, value); return write(store => store.put(value, key)) },
      removeItem(key) { cache.delete(key); return write(store => store.delete(key)) },
      close() { db.close() },
    };
    // Migrate only name-bound cache keys. Unnamed keys cannot be attributed safely after an instance restore.
    if (legacy) {
      const keys = Array.from({ length: legacy.length }, (_, i) => legacy.key(i));
      for (const key of keys) if (key && /^jiggered:v1:\d+:.+/.test(key)) {
        try {
          if (expectedKey && key !== expectedKey) { legacy.removeItem(key); continue }
          const old = legacy.getItem(key);
          // A still-open older build may have written new operations to localStorage after migration.
          // Do not pick one divergent outbox and silently throw the other away.
          if (cache.has(key) && cache.get(key) !== old) { retainedLegacy.set(key, old); continue }
          if (!cache.has(key)) await storage.setItem(key, old);
          legacy.removeItem(key);
        } catch { /* retain the old copy until a later migration succeeds */ }
      }
      if (expectedKey) for (const key of keys) if (key?.startsWith("jiggered:v1:") && !/^jiggered:v1:\d+:.+/.test(key)) { try { legacy.removeItem(key) } catch { /* never adopt an unbound identity */ } }
    }
    return storage;
  } catch {
    if (db) db.close();
    return legacy; // callers detect actual persistence failures and show memory-only warnings
  }
}

export function createDrafts({ storage, userId, username, onError = () => {}, now = () => Date.now() }) {
  const prefix = `jiggered:drafts:${userId}:${username}:`;
  const memory = new Map();
  const expiry = 7 * 24 * 60 * 60 * 1000;
  const remove = key => {
    memory.delete(key);
    if (!storage) return;
    try { Promise.resolve(storage.removeItem(key)).catch(onError) } catch (e) { onError(e) }
  };
  if (storage) for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith("jiggered:drafts:") && !key.startsWith(prefix)) remove(key);
  }
  if (storage) for (let i = storage.length - 1; i >= 0; i--) {
    const key = storage.key(i);
    if (key?.startsWith(prefix)) { try { const draft = JSON.parse(storage.getItem(key)); if (now() - draft.at > expiry) remove(key); else memory.set(key, draft) } catch { remove(key) } }
  }
  const prune = () => { for (const [key,draft] of memory) if (now() - draft.at > expiry) remove(key) };
  return {
    get(name) {
      try {
        const draft = memory.get(prefix + name);
        if (!draft || typeof draft.at !== "number") return null;
        if (now() - draft.at > expiry) { remove(prefix + name); return null }
        return draft.value;
      } catch { return null }
    },
    put(name, value) {
      const draft = { at: now(), value }; memory.set(prefix + name, draft);
      if (!storage) { onError(new Error("Draft is only in memory. Keep this page open and download recovery before leaving.")); return }
      try { Promise.resolve(storage.setItem(prefix + name, JSON.stringify(draft))).catch(onError) } catch (e) { onError(e) }
    },
    remove(name) { remove(prefix + name) },
    list() { prune(); return [...memory].map(([key, draft]) => ({ name: key.slice(prefix.length), at: draft.at })).sort((a,b) => b.at - a.at) },
    count() { prune(); return memory.size },
    export() { prune(); return Object.fromEntries([...memory].map(([key, draft]) => [key.slice(prefix.length), draft.value])) },
    clear() {
      memory.clear();
      if (storage) for (let i = storage.length - 1; i >= 0; i--) { const key = storage.key(i); if (key?.startsWith(prefix)) remove(key) }
    },
  };
}
