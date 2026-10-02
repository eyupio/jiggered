// Presentation state belongs to this signed-in person and this browser tab.
// Record drafts and credentials never pass through this store.
export function clearViewState(storage) {
  try {
    for (let i = (storage?.length || 0) - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (key?.startsWith("jiggered:view:") || key?.startsWith("jiggered:nav:"))
        storage.removeItem(key);
    }
  } catch {}
}

export function createViewState(user, storage) {
  const key = `jiggered:view:${user.id}:${user.username}`;
  let state = {};
  try {
    for (let i = (storage?.length || 0) - 1; i >= 0; i--) {
      const other = storage.key(i);
      if (other?.startsWith("jiggered:view:") && other !== key) storage.removeItem(other);
    }
    const saved = JSON.parse(storage?.getItem(key) || "null");
    if (saved?.v === 1 && saved.views && typeof saved.views === "object") state = saved.views;
  } catch {
    // Browsing still works when storage is blocked or an old copy is malformed.
  }
  return {
    get(name) {
      const value = state[name];
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    },
    set(name, value) {
      state[name] = value;
      try {
        storage?.setItem(key, JSON.stringify({ v: 1, views: state }));
      } catch {
        // A presentation preference must never prevent a record from being saved.
      }
    },
    clear() {
      state = {};
      try {
        storage?.removeItem(key);
      } catch {}
    },
    details(root, restore = false) {
      const saved = this.get("details");
      for (const el of root.querySelectorAll("details[id]:not(#account-menu)")) {
        if (restore && typeof saved[el.id] === "boolean") el.open = saved[el.id];
        else if (!restore) saved[el.id] = el.open;
      }
      if (!restore) this.set("details", saved);
    },
  };
}

export const savedCount = (value, fallback = 30) =>
  Number.isInteger(value) && value >= 1 && value <= 100000 ? value : fallback;
export const savedText = (value) => (typeof value === "string" ? value.slice(0, 2000) : "");
