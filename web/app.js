// The page: who is signed in, the tabs, and the wiring between the views and the sync store.

import { $, fmtLongDay, setPageUser } from "./util.js";
import { createStore } from "./sync.js";
import { normaliseSettings, dkey } from "./model.js";
import * as todayView from "./today.js";
import * as episodesView from "./episodes.js";
import * as historyView from "./history.js";
import * as accountView from "./account.js";
// admin.js is only loaded, and its tab only created, for admins: see syncAdmin

const ME_KEY = "jiggered:me";
const storage = (() => {
  try { const s = window.localStorage; s.setItem("jiggered:probe", "1"); s.removeItem("jiggered:probe"); return s } catch { return null }
})();
const remember = me => { try { storage && storage.setItem(ME_KEY, JSON.stringify(me)) } catch { /* ignore */ } };
const recall = () => { try { return JSON.parse(storage.getItem(ME_KEY) || "null") } catch { return null } };
const forget = () => { try { storage && storage.removeItem(ME_KEY) } catch { /* ignore */ } };

const SIGN_IN = "sign-in"; // getMe's answer when the browser is being sent to the sign-in page

// Who is signed in. Offline, fall back to who this device last saw so the app still opens;
// null means nobody is known here and the server can't be reached.
async function getMe() {
  let r = null;
  try { r = await fetch("/api/me", { credentials: "same-origin", signal: AbortSignal.timeout(6000) }) } catch { /* offline, or too slow to wait for */ }
  if (r && r.status === 401) { forget(); location.href = "/login"; return SIGN_IN }
  if (r && r.ok) { const me = await r.json(); remember(me); return me }
  return recall();
}

function fatal(text) {
  const p = Object.assign(document.createElement("p"), { className: "fatal", textContent: text });
  document.querySelector(".wrap").replaceChildren(p);
}

(async function boot() {
  const me = await getMe();
  if (me === SIGN_IN) return;
  if (!me) { fatal("Can't reach the server, and nobody has signed in on this device yet. Connect once to get started."); return }
  setPageUser(me.id);
  $("who").textContent = me.username;
  $("today").textContent = fmtLongDay(dkey(new Date()), "en-GB");

  // A temporary password was just handed out: nothing else works until it is changed.
  if (me.must_change_password) {
    $("tabs").hidden = true;
    document.querySelectorAll("section[id$=-panel]").forEach(p => { p.hidden = p.id !== "account-panel" });
    document.querySelectorAll("#account-panel > .panel:not(#pw-panel)").forEach(p => { p.hidden = true });
    $("sync").hidden = true;
    $("banner").hidden = false;
    $("banner").textContent = "Choose a new password to continue. The one you were given was only temporary.";
    $("account-panel").hidden = false;
    accountView.init({ me, settings: () => normaliseSettings(), store: null, today: () => dkey(new Date()) });
    $("pw-cur").focus();
    return;
  }

  // Several things can notice at once that the session has ended; the browser should be sent to sign in only once.
  let leaving = false;
  const toSignIn = () => { if (!leaving) { leaving = true; location.href = "/login" } };

  const store = createStore({
    storage,
    onChange: () => { renderHeader(); renderActive(); updateSync() },
    onAuthLost: toSignIn,
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
    leave() { leaving = true; store.clear(); forget(); location.href = "/login" }, // wipe this device's copy, then go to the sign-in page
    openDay(date) { go("today"); views.today.open(date) },
    editEpisode(id) { views.episode.edit(id) },
  };
  const views = {
    today: todayView.init(ctx), episode: episodesView.init(ctx), history: historyView.init(ctx),
    account: accountView.init(ctx),
  };

  let active = "today";
  function go(tab) {
    if (!views[tab]) tab = "today"; // e.g. the Admin tab of someone who has just stopped being an admin
    if (tab !== active && views[active] && views[active].hide) views[active].hide();
    active = tab;
    for (const b of document.querySelectorAll("#tabs button")) b.setAttribute("aria-selected", b.dataset.tab === tab);
    for (const t of Object.keys(views)) $(t + "-panel").hidden = t !== tab;
    views[tab].show();
    $("t-" + tab).scrollIntoView({ block: "nearest", inline: "nearest" }); // on a narrow phone the tab bar scrolls sideways
    scrollTo(0, 0);
  }
  const renderActive = () => views[active] && views[active].render();
  $("tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) go(b.dataset.tab) });

  // The Admin tab isn't hidden for everyone else, it doesn't exist: the button, the panel and the code behind
  // them are only added while the server says this person is an admin, and taken away again if that changes.
  let adminSync = Promise.resolve();
  const syncAdmin = () => (adminSync = adminSync.then(async () => {
    if (me.role === "admin" && !views.admin) {
      try {
        const { mount } = await import("./admin.js");
        if (me.role === "admin" && !views.admin) views.admin = mount(ctx);
      } catch (e) { console.error("couldn't load the admin tab", e) }
    } else if (me.role !== "admin" && views.admin) {
      const open = active === "admin";
      views.admin.destroy();
      delete views.admin;
      if (open) go("today");
    }
  }));

  // Roles can change while the app is open (an admin promotes or demotes you, resets your password, removes you).
  async function refreshMe() {
    let r;
    try { r = await fetch("/api/me", { credentials: "same-origin" }) } catch { return } // offline: keep what we know
    if (r.ok) { const peek = await r.clone().json().catch(() => null); if (peek && peek.id !== me.id) { location.reload(); return } } // another tab signed in as someone else
    if (r.status === 401) { forget(); toSignIn(); return }
    if (!r.ok) return;
    const fresh = await r.json();
    if (fresh.must_change_password) { location.reload(); return } // a reset password: show the change-it screen
    remember(fresh);
    Object.assign(me, fresh);
    $("who").textContent = me.username;
    accountView.identity(ctx);
    await syncAdmin();
  }

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
  const renderHeader = () => { $("today").textContent = fmtLongDay(ctx.today(), ctx.settings().locale) };
  function tick() {
    renderHeader();
    if (ctx.today() !== lastToday) { lastToday = ctx.today(); renderActive() }
  }
  const refresh = () => { tick(); store.load(); refreshMe() };
  setInterval(tick, 30_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh() });
  addEventListener("focus", tick);
  addEventListener("pageshow", refresh);
  addEventListener("online", () => { store.flush(); store.load(); refreshMe() });

  // ---- sign out: never silently throw away changes that haven't reached the server ----
  $("signout").addEventListener("submit", async e => {
    e.preventDefault();
    await store.flush();
    const n = store.status().pending;
    if (n && !confirm(`${n} ${n === 1 ? "change hasn't" : "changes haven't"} reached the server yet and will be lost if you sign out now. Sign out anyway?`)) return;
    try {
      const r = await fetch("/logout", { method: "POST", credentials: "same-origin" });
      if (!r.ok) throw new Error("HTTP " + r.status); // a proxy error page is not a sign-out
    } catch { toast("Jiggered can't sign you out right now (offline, or the server isn't answering)."); return }
    ctx.leave();
  });

  if ("serviceWorker" in navigator) { // lets the app open offline; everything works without it
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register(); // the load event may well have fired while we waited for /api/me
    else addEventListener("load", register);
  }

  store.hydrate(me.id); // after everything its change listener touches exists
  await syncAdmin();
  go("today");
  updateSync();
  tick();
  store.load();
})();
