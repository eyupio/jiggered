// The page: who is signed in, the tabs, and the wiring between the views and the sync store.

import { $, fmtLongDay } from "./util.js";
import { createStore } from "./sync.js";
import { normaliseSettings, dkey } from "./model.js";
import * as todayView from "./today.js";
import * as episodesView from "./episodes.js";
import * as historyView from "./history.js";
import * as accountView from "./account.js";
import * as adminView from "./admin.js";

const ME_KEY = "jiggered:me";
const storage = (() => {
  try { const s = window.localStorage; s.setItem("jiggered:probe", "1"); s.removeItem("jiggered:probe"); return s } catch { return null }
})();
const remember = me => { try { storage && storage.setItem(ME_KEY, JSON.stringify(me)) } catch { /* ignore */ } };
const recall = () => { try { return JSON.parse(storage.getItem(ME_KEY) || "null") } catch { return null } };
const forget = () => { try { storage && storage.removeItem(ME_KEY) } catch { /* ignore */ } };

// Who is signed in. Offline, fall back to who this device last saw so the app still opens.
async function getMe() {
  let r = null;
  try { r = await fetch("/api/me", { credentials: "same-origin" }) } catch { /* offline */ }
  if (r && r.status === 401) { forget(); location.href = "/login"; return null }
  if (r && r.ok) { const me = await r.json(); remember(me); return me }
  return recall();
}

function fatal(text) {
  const p = Object.assign(document.createElement("p"), { className: "fatal", textContent: text });
  document.querySelector(".wrap").replaceChildren(p);
}

const TABS = ["today", "episode", "history", "account", "admin"];

(async function boot() {
  const me = await getMe();
  if (!me) { if (me === undefined || me === false) fatal("Can't reach the server, and nobody has signed in on this device yet. Connect once to get started."); return }
  $("who").textContent = me.username;
  $("today").textContent = fmtLongDay(dkey(new Date()), "en-GB");

  // A temporary password was just handed out: nothing else works until it is changed.
  if (me.must_change_password) {
    $("tabs").hidden = true;
    for (const t of TABS) if (t !== "account") $(t + "-panel").hidden = true;
    document.querySelectorAll("#account-panel > .panel:not(#pw-panel)").forEach(p => { p.hidden = true });
    $("sync").hidden = true;
    $("banner").hidden = false;
    $("banner").textContent = "Choose a new password to continue. The one you were given was only temporary.";
    $("account-panel").hidden = false;
    accountView.init({ me, settings: () => normaliseSettings(), store: null, today: () => dkey(new Date()) });
    $("pw-cur").focus();
    return;
  }

  const store = createStore({
    storage,
    onChange: () => { renderActive(); updateSync() },
    onAuthLost: () => { location.href = "/login" },
  });

  let settingsKey, settingsVal;
  const ctx = {
    me, store,
    today: () => dkey(new Date()),
    settings() { // the same object until the stored settings change
      const raw = store.view("settings"), k = JSON.stringify(raw ?? null);
      if (k !== settingsKey) { settingsKey = k; settingsVal = normaliseSettings(raw) }
      return settingsVal;
    },
    toast,
    go,
    openDay(date) { go("today"); views.today.open(date) },
    editEpisode(id) { views.episode.edit(id) },
  };
  const views = {
    today: todayView.init(ctx), episode: episodesView.init(ctx), history: historyView.init(ctx),
    account: accountView.init(ctx), admin: adminView.init(ctx),
  };

  let active = "today";
  function go(tab) {
    if (tab === "admin" && me.role !== "admin") tab = "today";
    active = tab;
    for (const t of TABS) { $("t-" + t).setAttribute("aria-selected", t === tab); $(t + "-panel").hidden = t !== tab }
    views[tab].show();
    scrollTo(0, 0);
  }
  const renderActive = () => views[active] && views[active].render();
  $("tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(b.dataset.tab) });
  $("t-admin").hidden = me.role !== "admin";

  // ---- the line at the bottom: are my changes safe? ----
  function updateSync() {
    const st = store.status(), n = st.pending;
    $("sync").textContent =
      st.error ? `Couldn't save a change: ${st.error}`
      : n && st.offline ? `Offline. ${n} ${n === 1 ? "change is" : "changes are"} saved on this device and will sync when you're back online.`
      : n ? "Saving…"
      : st.offline ? "Offline. Showing what's saved on this device."
      : st.loaded ? "Saved on your server."
      : "Connecting…";
  }

  // ---- toast, with an optional Undo ----
  let toastTimer;
  const hideToast = () => { $("toastbar").hidden = true };
  function toast(message, undo) {
    const bar = $("toastbar");
    bar.replaceChildren(Object.assign(document.createElement("span"), { textContent: message }));
    if (undo) {
      const b = Object.assign(document.createElement("button"), { textContent: undo.label });
      b.addEventListener("click", () => { undo.fn(); hideToast() });
      bar.append(b);
    }
    bar.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 8000);
  }

  // ---- the date moves on by itself, even if the app was left open overnight ----
  let lastToday = ctx.today();
  function tick() {
    const k = ctx.today();
    $("today").textContent = fmtLongDay(k, ctx.settings().locale);
    if (k !== lastToday) { lastToday = k; renderActive() }
  }
  const refresh = () => { tick(); store.load() };
  setInterval(tick, 30_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh() });
  addEventListener("focus", tick);
  addEventListener("pageshow", refresh);
  addEventListener("online", () => { store.flush(); store.load() });

  // ---- sign out: never silently throw away changes that haven't reached the server ----
  $("signout").addEventListener("submit", async e => {
    e.preventDefault();
    await store.flush();
    const n = store.status().pending;
    if (n && !confirm(`${n} ${n === 1 ? "change hasn't" : "changes haven't"} reached the server yet and will be lost if you sign out now. Sign out anyway?`)) return;
    try { await fetch("/logout", { method: "POST", credentials: "same-origin" }) }
    catch { toast("You're offline, so Jiggered can't sign you out right now."); return }
    store.clear(); forget();
    location.href = "/login";
  });

  if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => { /* works without it */ }));

  store.hydrate(me.id); // after everything its change listener touches exists
  go("today");
  updateSync();
  tick();
  store.load();
})();
