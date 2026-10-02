// The page: who is signed in, the tabs, and the wiring between the views and the sync store.

import { api, $, fmtLongDay, setPageUser, html, setHTML, downloadFile, withBusy } from "./util.js";
import {
  openDeviceStorage,
  createDrafts,
  claimEditingTab,
  purgeDeviceStorage,
  PURGE_KEY,
} from "./device.js";
import { createStore } from "./sync.js";
import { normaliseSettings, resolveSettings, DEFAULTS, dkey } from "./model.js";
import * as todayView from "./today.js";
import * as episodesView from "./episodes.js";
import * as historyView from "./history.js";
import * as accountView from "./account.js";
import * as helpView from "./help.js";
import { initTooltips } from "./tooltips.js";
import { initDefaultsNotice } from "./defaults-notice.js";
import { profileInitials, normaliseProfile } from "./profile.js";
import { createViewState, clearViewState } from "./view-state.js";
// admin.js is only loaded, and its tab only created, for admins: see syncAdmin

const ME_KEY = "jiggered:me";
const legacyStorage = (() => {
  try {
    const s = window.localStorage;
    s.setItem("jiggered:probe", "1");
    s.removeItem("jiggered:probe");
    return s;
  } catch {
    return null;
  }
})();
const remember = (me) => {
  try {
    legacyStorage && legacyStorage.setItem(ME_KEY, JSON.stringify(me));
  } catch {
    /* ignore */
  }
};
const recall = () => {
  try {
    return JSON.parse(legacyStorage.getItem(ME_KEY) || "null");
  } catch {
    return null;
  }
};
const forget = () => {
  try {
    legacyStorage && legacyStorage.removeItem(ME_KEY);
  } catch {
    /* ignore */
  }
};

const SIGN_IN = "sign-in"; // getMe's answer when the browser is being sent to the sign-in page

// Who is signed in. Offline, fall back to who this device last saw so the app still opens;
// null means nobody is known here and the server can't be reached.
async function getMe() {
  let r = null;
  try {
    r = await fetch("/api/me", { credentials: "same-origin", signal: AbortSignal.timeout(6000) });
  } catch {
    /* offline, or too slow to wait for */
  }
  if (r && r.status === 401) {
    forget();
    try {
      clearViewState(window.sessionStorage);
    } catch {}
    try {
      await purgeDeviceStorage(legacyStorage);
      location.href = "/login";
    } catch {
      fatal(
        "Signed out, but this browser could not remove its device copy. Clear site data before sharing this device.",
      );
    }
    return SIGN_IN;
  }
  if (r && r.ok) {
    const me = await r.json();
    remember(me);
    return me;
  }
  return recall();
}

function fatal(text) {
  document.body.classList.remove("app-loading");
  const p = Object.assign(document.createElement("p"), { className: "fatal", textContent: text });
  document.querySelector(".wrap").replaceChildren(p);
}

(async function boot() {
  const me = await getMe();
  if (me === SIGN_IN) return;
  if (!me) {
    fatal(
      "Can't reach the server, and nobody has signed in on this device yet. Connect once to get started.",
    );
    return;
  }
  setPageUser(me.id);
  let tabStorage;
  try {
    tabStorage = window.sessionStorage;
  } catch {}
  const ui = createViewState(me, tabStorage);
  let ready = false;
  $("who").textContent = me.username;
  $("who-initials").textContent = profileInitials(me.username);
  $("today").textContent = fmtLongDay(dkey(new Date()), "en-GB");

  // A temporary password was just handed out: nothing else works until it is changed.
  if (me.must_change_password) {
    document.body.classList.remove("app-loading");
    $("view-heading").textContent = "A space of your own.";
    $("view-description").textContent = "Choose a new password, then make yourself at home.";
    $("tabs").hidden = true;
    document.querySelectorAll("section[id$=-panel]").forEach((p) => {
      p.hidden = p.id !== "account-panel";
    });
    document.querySelectorAll("#account-panel > .panel:not(#pw-panel)").forEach((p) => {
      p.hidden = true;
    });
    $("sync").hidden = true;
    document.querySelectorAll("header [data-help]").forEach((b) => {
      b.hidden = true;
    }); // nothing to open until the password is changed
    $("banner").hidden = false;
    $("banner").classList.add("welcome");
    $("banner").textContent =
      "Welcome to Jiggered. Choose a new password to continue (the one you were given was only temporary), then you'll do a ten-second morning check-in.";
    $("account-panel").hidden = false;
    accountView.init({
      me,
      settings: () => normaliseSettings(),
      store: null,
      today: () => dkey(new Date()),
    });
    $("pw-cur").focus();
    return;
  }

  // Several things can notice at once that the session has ended; the browser should be sent to sign in only once.
  let leaving = false;
  const toSignIn = async () => {
    if (leaving) return;
    leaving = true;
    forget();
    // Remove sensitive rendered content immediately, even if device storage fails.
    document.querySelector(".wrap").hidden = true;
    try {
      await store.clear();
      drafts.clear();
      ui.clear();
      await purgeDeviceStorage(legacyStorage);
      try {
        sessionStorage.removeItem(`jiggered:nav:${me.id}`);
      } catch {}
      location.href = "/login";
    } catch {
      fatal(
        "Signed out, but this browser could not remove its device copy. Clear site data before sharing this device.",
      );
      document.querySelector(".wrap").hidden = false;
    }
  };

  const coordination = await claimEditingTab(navigator.locks, "jiggered-editor");
  const storage = await openDeviceStorage({
    coordination,
    legacy: legacyStorage,
    userId: me.id,
    username: me.username,
  });
  let draftError = storage?.legacyCopies?.(me.id, me.username).length
    ? "An older build has a different device copy. Download recovery, then close the older tab; neither copy has been discarded."
    : "";
  const drafts = createDrafts({
    storage,
    userId: me.id,
    username: me.username,
    onError: (message) => {
      draftError = message?.message || String(message);
      updateSync();
    },
  });
  const store = createStore({
    storage,
    onChange: () => {
      if (!ready) return;
      renderHeader();
      renderActive();
      updateSync();
    },
    onAuthLost: toSignIn,
    onTask: (event) => {
      if (!ready) return;
      ctx.measure(event);
      if (active === "account") views.account.refreshUsage();
    },
  });

  storage?.onChange?.(() => {
    if (storage.writable === false && legacyStorage?.getItem(ME_KEY) == null) toSignIn();
    else store.refreshDevice();
  });
  addEventListener("storage", (e) => {
    if (e.key === PURGE_KEY) toSignIn();
  });
  // Read-only tabs can browse and download. They never edit drafts or send writes.
  for (const type of ["click", "submit", "input", "change", "pointerdown", "keydown"])
    document.addEventListener(
      type,
      (e) => {
        if (!store.status().readOnly && !store.status().restoring) return;
        const target = e.target;
        const safe = target.closest?.(
          "#tabs,#signout,#account-menu,#help-panel,[data-help],.help-tip,.daynav,#history-panel,#account-shortcuts,#export-device,#export-all,#day-back,[data-settings],#entry-cancel,#tab-reload",
        );
        if (safe) return;
        if (target.closest?.("button,input,textarea,select,form,.drag-handle")) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
  if (!coordination.writable) {
    const notice = document.createElement("div");
    notice.className = "notice";
    notice.setAttribute("role", "status");
    notice.textContent = coordination.reason + " ";
    const reload = document.createElement("button");
    reload.id = "tab-reload";
    reload.className = "secondary";
    reload.textContent = "Reload to edit here";
    reload.onclick = () => location.reload();
    notice.append(reload);
    $("tabs").before(notice);
    document
      .querySelectorAll(
        "#today-panel input,#epform input,#epform textarea,#epform select,#setform input,#setform textarea,#setform select",
      )
      .forEach((el) => (el.readOnly = true));
  }

  let sharedDefaults = DEFAULTS;
  try {
    const cached = JSON.parse(
      storage?.getItem(`jiggered:defaults:${me.id}:${me.username}`) || "null",
    );
    if (cached) sharedDefaults = normaliseSettings(cached);
  } catch {
    /* use factory fallback */
  }
  let defaultsTag = "";
  async function loadDefaults() {
    let fresh = false,
      fallback = false;
    try {
      const r = await fetch("/api/defaults", {
        credentials: "same-origin",
        headers: { "X-Jiggered-User": String(me.id) },
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        fresh = true;
        fallback = r.headers.get("X-Jiggered-Defaults-Fallback") === "true";
        sharedDefaults = normaliseSettings(await r.json());
        defaultsTag = r.headers.get("ETag") || "";
        await storage?.setItem(
          `jiggered:defaults:${me.id}:${me.username}`,
          JSON.stringify(sharedDefaults),
        );
      }
    } catch {
      /* offline fallback */
    }
    return { body: sharedDefaults, tag: defaultsTag, fresh, fallback };
  }
  let settingsKey, settingsVal;
  let usageConsent = false;
  void api("GET", "/api/me/usage-consent").then((r) => {
    usageConsent = r.ok && r.data.available === true && r.data.enabled === true;
  });
  const ctx = {
    setUsageConsent(value) {
      usageConsent = value === true;
    },
    measure(event) {
      if (usageConsent) void api("POST", "/api/me/usage", { event });
    },
    me,
    ui,
    store,
    drafts,
    defaults: () => sharedDefaults,
    legacyCopies: () => storage?.legacyCopies?.(me.id, me.username) || [],
    loadDefaults,
    setDefaults(value, tag) {
      sharedDefaults = value;
      defaultsTag = tag;
      renderActive();
    },
    today: () => dkey(new Date()),
    settings() {
      // the same object until the stored settings change
      const raw = store.view("settings"),
        k = JSON.stringify([raw ?? null, sharedDefaults]);
      if (k !== settingsKey) {
        settingsKey = k;
        settingsVal = resolveSettings(raw, sharedDefaults);
      }
      return settingsVal;
    },
    toast,
    go,
    back() {
      go(views[beforeHelp] && beforeHelp !== "help" ? beforeHelp : "today");
    },
    leave: toSignIn,
    openHistoryPeriod(from, to) {
      go("history");
      views.history.openPeriod(from, to);
    },
    reopenSetup() {
      go("today");
      views.today.reopenSetup();
    },
    openDay(date) {
      go("today");
      views.today.open(date);
    },
    editEpisode(id) {
      views.episode.edit(id);
    },
    editSettings(section) {
      go("account");
      views.account.focus(section);
    },
  };
  // Constructors also restore drafts and selected records, so give them the final
  // initial snapshot instead of letting a late network response replace defaults.
  store.hydrate(me.id, me.username);
  await Promise.all([loadDefaults(), store.load()]);
  if (leaving) return;
  const notice = initDefaultsNotice(ctx, {
    canWrite: () => coordination.writable && !store.status().restoring,
  });
  const tooltips = initTooltips(ctx);
  const views = {
    today: todayView.init(ctx),
    episode: episodesView.init(ctx),
    history: historyView.init(ctx),
    account: accountView.init(ctx),
    help: helpView.init(ctx),
  };

  const scrolls = { ...ui.get("nav").scrolls };
  let active = "today",
    beforeHelp = "today";
  function go(tab) {
    if (tab === "help" && active !== "help") beforeHelp = active;
    if (ready && tab !== active) saveNav();
    if (!Object.hasOwn(views, tab)) tab = "today"; // e.g. someone who has stopped being an admin
    if (tab !== active && views[active] && views[active].hide) views[active].hide();
    tooltips.hide();
    active = tab;
    document.body.dataset.view = tab;
    const intro = $("t-" + tab)?.dataset;
    $("view-heading").textContent =
      intro?.heading ||
      (tab === "admin" ? "Care for this shared space." : "A little guidance, when you need it.");
    $("view-description").textContent =
      intro?.description ||
      (tab === "admin"
        ? "Manage accounts, shared defaults and the services that keep this instance running."
        : "Find your way around, one small step at a time.");
    try {
      history.replaceState(null, "", "#" + tab);
    } catch {
      /* the address bar is only a convenience */
    }
    for (const b of document.querySelectorAll("#tabs button")) {
      b.setAttribute("aria-selected", b.dataset.tab === tab);
      b.tabIndex = b.dataset.tab === tab ? 0 : -1;
    }
    for (const t of Object.keys(views)) $(t + "-panel").hidden = t !== tab;
    const shown = views[tab].show();
    ui.details($(tab + "-panel"), true);
    $("t-" + tab)?.scrollIntoView({ block: "nearest", inline: "nearest" }); // Help has no tab of its own // on a narrow phone the tab bar scrolls sideways
    scrollTo(0, Math.max(0, Number(scrolls[tab]) || 0));
    return shown;
  }
  $("brand-home").addEventListener("click", (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go("today");
  });
  const renderActive = () => {
    accountView.identity(ctx);
    notice.update();
    views[active] && views[active].render();
  };
  $("tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) go(b.dataset.tab);
  });

  $("tabs").addEventListener("keydown", (e) => {
    const buttons = [...$("tabs").querySelectorAll("button")],
      i = buttons.indexOf(e.target);
    if (i < 0 || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? buttons.length - 1
          : (i + (e.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    go(buttons[next].dataset.tab);
    buttons[next].focus();
  });
  // The account menu closes when something in it is chosen, or on a tap anywhere else.
  document.addEventListener(
    "click",
    (e) => {
      const menu = $("account-menu");
      if (menu.open && !e.target.closest("#account-menu summary")) menu.open = false;
      const goto = e.target.closest("[data-menu-go]");
      if (goto) {
        go(goto.dataset.menuGo);
        return;
      }
    },
    true,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && $("account-menu").open) {
      $("account-menu").open = false;
      $("account-menu").querySelector("summary").focus();
    }
  });
  document.addEventListener("click", (e) => {
    const help = e.target.closest("[data-help]");
    if (help) {
      views.help.open(help.dataset.help);
      return;
    }
    const settings = e.target.closest("[data-settings]"),
      finish = e.target.closest("[data-finish-episode]");
    if (settings) ctx.editSettings(settings.dataset.settings);
    if (finish) views.episode.edit(finish.dataset.finishEpisode, null, true);
  });
  $("recovery").addEventListener("click", (e) => {
    const b = e.target.closest("button"),
      f = b && store.failures().find((f) => f.key === b.dataset.key);
    if (!b) return;
    if (b.dataset.action === "download")
      downloadFile(
        "jiggered-device-recovery.json",
        JSON.stringify(
          {
            ...store.recoveryExport(),
            drafts: drafts.export(),
            legacyCopies: storage?.legacyCopies?.(me.id, me.username) || [],
          },
          null,
          2,
        ),
      );
    if (!f) return;
    if (b.dataset.action === "retry") store.retryFailed(f.key);
    if (b.dataset.action === "edit") {
      if (f.id === "settings") {
        go("account");
        views.account.recover(f.body);
      } else views.episode.recover(f.id, f.body);
    }
    if (
      b.dataset.action === "discard" &&
      (f.conflict ||
        confirm(
          "Discard this refused change? Download a recovery copy first if you want to keep it.",
        ))
    )
      store.discardFailed(f.key);
  });

  // The Admin tab isn't hidden for everyone else, it doesn't exist: the button, the panel and the code behind
  // them are only added while the server says this person is an admin, and taken away again if that changes.
  let adminSync = Promise.resolve();
  const syncAdmin = () =>
    (adminSync = adminSync.then(async () => {
      if (me.role === "admin" && !views.admin) {
        try {
          const { mount } = await import("./admin.js");
          if (me.role === "admin" && !views.admin) views.admin = mount(ctx);
        } catch (e) {
          console.error("couldn't load the admin tab", e);
        }
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
    try {
      r = await fetch("/api/me", { credentials: "same-origin" });
    } catch {
      return;
    } // offline: keep what we know
    if (r.ok) {
      const peek = await r
        .clone()
        .json()
        .catch(() => null);
      if (peek && peek.id !== me.id) {
        location.reload();
        return;
      }
    } // another tab signed in as someone else
    if (r.status === 401) {
      forget();
      toSignIn();
      return;
    }
    if (!r.ok) return;
    const fresh = await r.json();
    if (fresh.must_change_password) {
      location.reload();
      return;
    } // a reset password: show the change-it screen
    remember(fresh);
    Object.assign(me, fresh);
    $("who").textContent = me.username;
    accountView.identity(ctx);
    await syncAdmin();
  }

  // ---- the line at the bottom: are my changes safe? ----
  // The line keeps its height whether or not it has anything to say: showing and hiding it used to push the whole
  // page down and back up on every tap. A routine "Sending…" is held back briefly, so a normal quick save shows nothing.
  let quietTimer = null,
    quietSince = 0;
  let lastUsageFailure = false;
  function updateSync() {
    const st = store.status(),
      n = st.pending;
    if (st.failed && !lastUsageFailure) ctx.measure("save_failed");
    lastUsageFailure = !!st.failed;
    const routine =
      !!n &&
      !st.offline &&
      !st.failed &&
      !st.localError &&
      !draftError &&
      !st.readOnly &&
      !st.restoring;
    if (!routine) {
      quietSince = 0;
      clearTimeout(quietTimer);
      quietTimer = null;
    } else if (!quietSince) quietSince = Date.now();
    if (routine && Date.now() - quietSince < 700) {
      if (!quietTimer)
        quietTimer = setTimeout(
          () => {
            quietTimer = null;
            updateSync();
          },
          700 - (Date.now() - quietSince),
        );
      paintSync("");
      return;
    }
    paintSync(null);
  }
  function paintSync(quiet) {
    const st = store.status(),
      n = st.pending;
    $("sync").classList.toggle("err", !!st.failed || !!st.localError || !!draftError);
    $("sync").textContent =
      quiet === ""
        ? ""
        : st.readOnly
          ? coordination.reason
          : st.restoring
            ? "Restore in progress. Editing is paused."
            : st.localError ||
              draftError ||
              (st.failed
                ? `${st.failed} refused ${st.failed === 1 ? "change needs" : "changes need"} recovery below.`
                : n
                  ? !st.durable
                    ? `${n} changes are only in memory while device storage finishes. Keep this page open.`
                    : st.offline
                      ? `${n} changes queued on this device. Will retry when connected.`
                      : `${n} changes queued on this device. Sending…`
                  : st.offline
                    ? "Offline. Showing this device's copy."
                    : st.loaded
                      ? ""
                      : "Connecting…");
    $("sync").dataset.state = $("sync").textContent ? "attention" : "saved";
    const failures = store.failures();
    $("recovery").hidden = !failures.length && !st.localError && !draftError;
    if (!$("recovery").hidden)
      setHTML(
        $("recovery"),
        html`<h2>Recover unsaved changes</h2><p>Download a private copy before leaving this device. This recovery file is for support or manual recovery, not the account restore form.</p><button class="secondary" data-action="download">Download recovery copy</button>${failures.map((f) => html`<div class="recovery-item"><b>${f.id}</b><p>${f.message}</p><button class="secondary" data-action="retry" data-key="${f.key}">${f.conflict ? (f.deleted || f.deletedEntry ? "Restore my record" : "Use my change") : "Retry"}</button>${f.body && (f.id === "settings" || /^e-/.test(f.id)) ? html`<button class="secondary" data-action="edit" data-key="${f.key}">Edit a recovered copy</button>` : ""}<button class="x" data-action="discard" data-key="${f.key}">${f.conflict ? "Keep server copy" : "Discard"}</button></div>`)}`,
      );
  }

  // ---- toast, with an optional Undo ----
  let toastTimer;
  const hideToast = () => {
    $("toastbar").hidden = true;
  };
  function toast(message, undo) {
    const bar = $("toastbar");
    bar.replaceChildren(Object.assign(document.createElement("span"), { textContent: message }));
    if (undo) {
      const b = Object.assign(document.createElement("button"), { textContent: undo.label });
      b.addEventListener("click", () => {
        undo.fn();
        hideToast();
      });
      bar.append(b);
    }
    bar.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 8000);
  }

  // ---- the date moves on by itself, even if the app was left open overnight ----
  let lastToday = ctx.today();
  const renderHeader = () => {
    $("today").textContent = fmtLongDay(ctx.today(), ctx.settings().locale);
  };
  function tick() {
    renderHeader();
    if (ctx.today() !== lastToday) {
      lastToday = ctx.today();
      renderActive();
    }
  }
  const refresh = async () => {
    tick();
    loadDefaults().then(() => notice.update());
    if (!coordination.writable) {
      await storage?.refresh?.();
      store.refreshDevice();
    }
    store.load();
    refreshMe();
  };
  setInterval(tick, 30_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  addEventListener("focus", tick);
  addEventListener("pageshow", refresh);
  addEventListener("online", () => {
    store.flush();
    store.load();
    refreshMe();
  });

  // Restore presentation state before revealing the app. Keep each view's scroll position,
  // filters, paging and selected item, without storing form secrets or replacing record drafts.
  const NAV_KEY = `jiggered:nav:${me.id}`;
  const saveNav = () => {
    if (!ready || leaving) return;
    scrolls[active] = Math.round(scrollY);
    if (views[active]?.snapshot) ui.set(active, views[active].snapshot());
    ui.details($(active + "-panel"));
    ui.set("nav", { tab: active, scrolls, beforeHelp });
    const profile = normaliseProfile(store.view("settings")?.profile);
    ui.set("appearance", { theme: profile.theme, energyTheme: profile.energyTheme });
    try {
      sessionStorage.setItem(
        NAV_KEY,
        JSON.stringify({
          tab: active,
          y: Math.round(scrollY),
          day: active === "today" ? views.today.day() : null,
        }),
      );
    } catch {
      /* private window or blocked storage */
    }
  };
  const savedNav = (() => {
    const current = ui.get("nav");
    if (current.tab) return { ...current, y: current.scrolls?.[current.tab] };
    try {
      return JSON.parse(sessionStorage.getItem(NAV_KEY) || "null");
    } catch {
      return null;
    }
  })();
  const startTab = () => {
    const t = hashTab();
    return Object.hasOwn(views, t)
      ? t
      : savedNav && Object.hasOwn(views, savedNav.tab)
        ? savedNav.tab
        : "today";
  }; // after the Admin tab is mounted
  function hashTab() {
    try {
      return decodeURIComponent(location.hash.slice(1));
    } catch {
      return "";
    }
  }
  addEventListener("pagehide", saveNav);
  for (const type of ["click", "input", "change", "toggle"])
    document.addEventListener(type, () => queueMicrotask(saveNav), type === "toggle");
  let scrollFrame = null;
  addEventListener(
    "scroll",
    () => {
      if (scrollFrame !== null) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = null;
        saveNav();
      });
    },
    { passive: true },
  );
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveNav();
  });
  addEventListener("hashchange", () => {
    const t = hashTab();
    if (Object.hasOwn(views, t) && t !== active) go(t);
  }); // the address was edited by hand
  function restorePlace() {
    if (!savedNav || savedNav.tab !== active) return;
    if (
      active === "today" &&
      /^\d{4}-\d{2}-\d{2}$/.test(savedNav.day || "") &&
      savedNav.day < ctx.today()
    )
      views.today.open(savedNav.day);
    beforeHelp = Object.hasOwn(views, savedNav.beforeHelp) ? savedNav.beforeHelp : "today";
    scrollTo(0, Math.max(0, Number(savedNav.y) || 0));
  }

  // ---- sign out: never silently throw away changes that haven't reached the server ----
  $("signout").addEventListener("submit", async (e) => {
    e.preventDefault();
    return withBusy($("signout").querySelector("button"), "Signing out…", async () => {
      await store.flush();
      const n = store.status().pending + store.status().failed,
        unfinished = drafts.count();
      if (
        (n || unfinished) &&
        !confirm(
          `${n} unsaved changes and ${unfinished} unfinished drafts have device copies here. Signing out removes them. Download a recovery copy first if you need them. Sign out anyway?`,
        )
      )
        return;
      try {
        const r = await fetch("/logout", { method: "POST", credentials: "same-origin" });
        if (!r.ok) throw new Error("HTTP " + r.status); // a proxy error page is not a sign-out
      } catch {
        toast("Jiggered can't sign you out right now (offline, or the server isn't answering).");
        return;
      }
      await ctx.leave();
    });
  });

  addEventListener("beforeunload", (e) => {
    if (
      !leaving &&
      (((store.status().pending || store.status().failed) && !store.status().durable) ||
        (drafts.count() && draftError))
    ) {
      e.preventDefault();
      e.returnValue = "";
    }
  });

  if ("serviceWorker" in navigator) {
    // lets the app open offline; everything works without it
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete")
      register(); // the load event may well have fired while we waited for /api/me
    else addEventListener("load", register);
  }

  await syncAdmin();
  accountView.identity(ctx);
  await go(startTab());
  notice.update();
  tick();
  document.body.classList.remove("app-loading");
  restorePlace();
  ready = true;
  updateSync();
  saveNav();
  // Freeze the starting defaults into this account so future shared edits do not replace personal choices.
  if (coordination.writable && defaultsTag && store.status().loaded && !store.view("settings"))
    store.dispatch({ id: "settings", type: "replace", arg: normaliseSettings(sharedDefaults) });
})();
