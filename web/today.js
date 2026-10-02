// The Today tab: morning check-in, the points gauge, tapping activities. It can also show and edit a past day.

import { $, html, setHTML, uid, fmtLongDay } from "./util.js";
import { renderOngoing } from "./episodes.js";
import { PICKER, usage, favourites, groupItems, matches, selection } from "./picker.js";
import { readableDay, identifyEntries, balanceLabel, ADVICE, dayId, emptyDay, used, capOf, hhmm, addDays, listDays } from "./model.js";

const points = n => `${n} ${n === 1 ? "point" : "points"}`;
const costLabel = c => c > 0 ? "−" + c : c < 0 ? "+" + -c : "0";
const named = s => s[0].toUpperCase() + s.slice(1);

export function init(ctx) {
  let viewDate = null; // null follows the clock, so the screen moves on by itself at midnight
  let actsKey = "", editing = null, editingDate = "", query = "", groupFilter = ""; // groupFilter "" shows every group
  const more = new Map(), closed = new Set(); // per-group paging and the groups the person closed (all start open, so a new list shows buttons), kept while this tab is open
  let changing = false, onboardingSeen = false; // re-choosing a check-in that is set; whether the first-run checklist showed this session
  const entryForm = $("entry-form");

  const key = () => viewDate ?? ctx.today();
  const id = () => dayId(key());
  const day = () => { const d = readableDay(ctx.store.view(id()), key()); return { ...d, entries: identifyEntries(d.entries) } };
  // Each change is an operation on the day, stamped with the budget in force so history keeps its own numbers.
  const op = (type, arg, before, target = id()) => {
    const S = ctx.settings();
    return ctx.store.dispatch({ id: target, type, arg, before, original: ctx.store.view(id()), stamp: { budget: S.budget, sleepPenalty: S.sleepPenalty, amberPenalty: S.amberPenalty, redPenalty: S.redPenalty } });
  };

  function open(date) {
    viewDate = date === ctx.today() ? null : date;
    editing = null; changing = false; entryForm.hidden = true; restoreDraft(); render();
  }

  $("checkin").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const was = day().status, next = was === b.dataset.s ? null : b.dataset.s, target = id();
    changing = false;
    op("setStatus", next);
    // A cleared or changed check-in changes the day's points, so it can always be taken back.
    if (was) ctx.toast(next ? `Changed to ${named(next)}.` : "Check-in cleared.", { label: "Undo", fn: () => op("setStatus", was, undefined, target) });
  });
  $("checkin-change").addEventListener("click", () => {
    changing = true; render();
    $("checkin").querySelector('[aria-pressed="true"]')?.focus();
  });
  // First-run checklist: the first two steps tick themselves from what is logged; the budget is set right here.
  function patchSettings(arg) {
    const raw = ctx.store.view("settings");
    if (!raw) return;
    return ctx.store.dispatch({ id: "settings", type: "settingsPatch", arg, before: Object.fromEntries(Object.keys(arg).map(k => [k, raw[k]])), original: raw });
  }
  $("onboarding-dismiss").addEventListener("click", () => { patchSettings({ onboarding: { ...(ctx.store.view("settings")?.onboarding || {}), dismissed: true } }); onboardingSeen = false; render() });
  $("onboarding-budget").addEventListener("change", e => {
    const n = Math.round(Number(e.target.value)), S = ctx.settings();
    if (!Number.isInteger(n) || n < 1 || n > 30) { e.target.value = S.budget; return }
    if (n === S.budget) return;
    // Penalties may not exceed the budget, so they shrink with it.
    patchSettings({ budget: n, sleepPenalty: Math.min(S.sleepPenalty, n), amberPenalty: Math.min(S.amberPenalty, n), redPenalty: Math.min(S.redPenalty, n), onboarding: { ...(ctx.store.view("settings")?.onboarding || {}), budget: true } });
    const today = dayId(ctx.today());
    if (ctx.store.view(today)) ctx.store.dispatch({ id: today, type: "restamp", arg: { budget: n, sleepPenalty: Math.min(S.sleepPenalty, n) } });
    ctx.toast(`Daily points set to ${n}. Change it any time in Account.`);
  });
  $("act-filter").addEventListener("click", e => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    groupFilter = b.dataset.filter === groupFilter ? "" : b.dataset.filter; more.clear(); render();
  });
  $("act-search").addEventListener("input", e => { query = e.target.value; more.clear(); render() });
  $("acts").addEventListener("click", e => {
    const m = e.target.closest("[data-more]");
    if (m) { const s = m.dataset.more; more.set(s, (more.get(s) ?? PICKER.page) + (s === "search" ? PICKER.searchPage : PICKER.page)); render() }
  });
  $("acts").addEventListener("toggle", e => {
    const g = e.target.dataset?.group;
    if (!g) return;
    if (e.target.open) closed.delete(g); else closed.add(g);
  }, true);
  $("sleep").addEventListener("change", e => op("setPoorSleep", e.target.checked));
  const logOne = x => op("addEntry", { id: uid(), a: x.a, c: x.c, t: key() !== ctx.today() ? $("act-time").value : hhmm(new Date()) });
  // Takes the latest entry of that name off the day (what "−" does), with the same Undo as the entries list.
  function removeEntry(entry) {
    const index = day().entries.findIndex(x => x.id === entry.id), target = id();
    op("removeEntry", entry);
    ctx.toast("Activity removed.", { label: "Undo removal", fn: () => ctx.store.dispatch({ id: target, type: "restoreEntry", arg: { entry, index } }) });
  }
  $("acts").addEventListener("click", e => {
    const step = e.target.closest("[data-step]");
    const b = step || e.target.closest("button.act");
    if (!b) return;
    const x = ctx.settings().activities[b.dataset.i];
    if (!x) return;
    if (!step || step.dataset.step === "1") { logOne(x); return }
    const latest = day().entries.findLast(en => en.a === x.a);
    if (latest) removeEntry(latest);
  });
  function edit(entry = null) {
    editing = entry; editingDate = key();
    entryForm.hidden = false;
    $("entry-heading").textContent = entry ? "Edit activity" : "Other activity";
    $("entry-name").value = entry?.a || "";
    $("entry-cost").value = entry?.c ?? 1;
    $("entry-time").value = entry?.t ?? (key() === ctx.today() ? hhmm(new Date()) : "");
    $("entry-msg").textContent = "";
    $("entry-name").focus();
  }
  function restoreDraft() {
    const draft = ctx.drafts?.get(`activity:${id()}`);
    if (!draft) return;
    edit(draft.original); $("entry-name").value = draft.a; $("entry-cost").value = draft.c; $("entry-time").value = draft.t;
    $("entry-msg").textContent = "Unfinished activity draft restored.";
  }
  $("other-activity").addEventListener("click", () => edit());
  $("entry-cancel").addEventListener("click", () => { ctx.drafts?.remove(`activity:${id()}`); editing = null; entryForm.hidden = true });
  entryForm.addEventListener("input", () => ctx.drafts?.put(`activity:${id()}`, { original: editing, a: $("entry-name").value, c: $("entry-cost").value, t: $("entry-time").value }));
  entryForm.addEventListener("submit", async e => {
    e.preventDefault();
    if (editingDate !== key()) { render(); ctx.toast("The day changed. Your unfinished activity is kept on the previous day."); return }
    const original = ctx.store.view(id());
    const changes = { a: $("entry-name").value.trim(), c: Number($("entry-cost").value), t: $("entry-time").value };
    if (!changes.a || [...changes.a].length > 60 || !Number.isInteger(changes.c) || changes.c < -10 || changes.c > 10) { $("entry-msg").textContent = "Use a name of 1–60 characters and whole-number points from −10 to 10."; return }
    const previous = editing, target = id(), stamp = { budget: ctx.settings().budget, sleepPenalty: ctx.settings().sleepPenalty };
    if (previous && !day().entries.some(x => x.id === previous.id)) { $("entry-msg").textContent = "This activity was removed. Cancel or log it as an Other activity."; return }
    const changed = previous ? Object.fromEntries(Object.entries(changes).filter(([k,v]) => v !== previous[k])) : changes;
    const arg = previous ? { id: previous.id, changes: changed } : { id: uid(), ...changes };
    const ticket = op(previous ? "editEntry" : "addEntry",arg,previous);
    ctx.drafts?.remove(`activity:${target}`); editing = null; entryForm.hidden = true;
    ctx.toast(previous ? "Activity correction queued." : "Activity queued.", previous ? { label: "Undo correction", fn: () => ctx.store.dispatch({ id: target, type: "editEntry", arg: { id: previous.id, changes: Object.fromEntries(Object.keys(changed).map(k=>[k,previous[k]])) }, before: changes, original, stamp }) } : undefined);
    await ticket;
  });
  $("entries").addEventListener("click", e => {
    const b = e.target.closest("[data-entry]");
    if (!b) return;
    const entries = day().entries, index = entries.findIndex(x => x.id === b.dataset.entry), entry = entries[index];
    if (!entry) return;
    if (b.dataset.action === "edit") { edit(entry); return }
    removeEntry(entry);
  });

  $("day-prev").addEventListener("click", () => open(addDays(key(), -1)));
  $("day-next").addEventListener("click", () => { if (key() < ctx.today()) open(addDays(key(), 1)) });
  $("day-back").addEventListener("click", () => open(ctx.today()));
  // The date reads in the person's own format; tapping it opens the native picker underneath.
  $("day-date").closest("label").addEventListener("click", e => { if (e.target === $("day-pick")) return; e.preventDefault(); try { $("day-pick").showPicker() } catch { $("day-pick").focus() } });
  $("day-pick").addEventListener("change", e => {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= ctx.today()) open(v);
    else render();
  });

  const actButton = ({ item: x, i }) => html`<button class="act${x.c < 0 ? " rec" : ""}" data-i="${i}"><span>${x.a}</span><span class="c">${costLabel(x.c)}</span><span class="activity-add" aria-hidden="true"><span>Record</span><b>+</b></span></button>`;
  // An activity already logged on this day: green, how many times, and − / + to take one off or add another.
  const selectedCard = (count, { item: x, i }) => html`<div class="act on${x.c < 0 ? " rec" : ""}"><span class="name">${x.a}</span><span class="c">${costLabel(x.c)}</span><span class="stepper"><button type="button" class="step" data-step="-1" data-i="${i}" aria-label="Remove one ${x.a}">−</button><b class="count" aria-label="${count} ${count === 1 ? "time" : "times"} logged">×${count}</b><button type="button" class="step" data-step="1" data-i="${i}" aria-label="Add one more ${x.a}">+</button></span></div>`;
  // Long lists get a search box, a favourites row (most and latest used), sections by group and "Show more" paging.
  // Short lists look exactly as before. Buttons keep their index into the settings list, so tapping is unchanged.
  function renderActivities(S) {
    const all = groupItems(S.activities), names = all.length > 1 || all[0].name ? all.map(g => ({ name: g.name, n: g.rows.length })) : [];
    if (groupFilter && !names.some(g => g.name === groupFilter)) groupFilter = ""; // that group no longer exists
    const rows = (groupFilter ? all.find(g => g.name === groupFilter).rows : S.activities.map((item, i) => ({ item, i }))), long = S.activities.length > PICKER.searchFrom;
    $("act-search-row").hidden = !long;
    const q = long ? query.trim() : "";
    // Favourites come from other days, so the row stays put while you log today.
    // A logged activity changes in place (green, ×count, − and +) rather than moving, so nothing shifts under a finger.
    const { count, selected } = selection(S.activities.map((item, i) => ({ item, i })), day().entries);
    const favs = !q && !groupFilter && long ? favourites(rows.map(r => r.item.a), usage(Object.fromEntries(Object.entries(ctx.store.all()).filter(([k]) => k !== id())), ctx.today()).acts).map(n => rows.find(r => r.item.a === n)) : [];
    const found = q ? rows.filter(r => matches(q, r.item.a + " " + (r.item.g || ""))) : rows;
    const sections = (q ? [{ key: "search", name: "", rows: found, size: PICKER.searchPage }]
      : groupFilter ? [{ key: "g:" + groupFilter, name: "", rows, size: PICKER.searchPage }]
      : all.map(g => ({ key: "g:" + g.name, name: g.name, rows: g.rows, size: PICKER.page }))).filter(s => s.rows.length || (!q && !groupFilter && !s.name));
    const listKey = JSON.stringify([S.activities, q, groupFilter, favs.map(f => f.i), [...more], [...closed], long, selected.map(r => [r.i, count.get(r.item.a)])]);
    if (listKey === actsKey) return; // only rebuild the buttons when something shown has changed
    actsKey = listKey;
    // One tap on a group narrows the list to it; tapping it again, or "All", brings everything back.
    $("act-filter").hidden = names.length < 2;
    setHTML($("act-filter"), html`<button type="button" class="pill" data-filter="" aria-pressed="${!groupFilter}">All <span class="meta">${S.activities.length}</span></button>${names.map(g => html`<button type="button" class="pill" data-filter="${g.name}" aria-pressed="${groupFilter === g.name}">${g.name} <span class="meta">${g.n}</span></button>`)}`);
    const tile = r => count.get(r.item.a) ? selectedCard(count.get(r.item.a), r) : actButton(r);
    const grid = list => html`<div class="acts">${list.map(tile)}</div>`;
    const part = s => {
      const shown = more.get(s.key) ?? s.size, hide = s.rows.length - shown;
      const body = html`${grid(s.rows.slice(0, shown))}${hide > 0 ? html`<button class="secondary small" data-more="${s.key}">Show ${Math.min(hide, s.size)} more of ${s.rows.length}</button>` : ""}`;
      return s.name ? html`<details class="act-group" data-group="${s.key}"${closed.has(s.key) ? "" : " open"}><summary>${s.name} <span class="meta">${s.rows.length}</span></summary>${body}</details>` : body;
    };
    setHTML($("acts"), html`${favs.length ? html`<div class="act-fav"><h3 class="label">Frequent and recent</h3>${grid(favs)}</div>` : ""}${sections.map(part)}${q && !found.length ? html`<p class="empty">No activity matches${groupFilter ? ` in ${groupFilter}. Choose All to search every group` : ""}. Use Other activity to log it once.</p>` : ""}`);
    $("noacts").hidden = S.activities.length > 0;
  }

  function render() {
    if (!entryForm.hidden && editingDate !== key()) { editing = null; entryForm.hidden = true }
    const S = ctx.settings(), d = day(), k = key(), past = k !== ctx.today();
    const budget = d.budget ?? S.budget, spent = used(d), cap = capOf(d, S), left = cap - spent;

    $("day-label").textContent = past ? fmtLongDay(k, S.locale) : "Today";
    $("day-pick").value = k;
    $("day-date").textContent = past ? "Change day" : fmtLongDay(k, S.locale); // the person's date format, not the browser's
    $("day-pick").max = ctx.today();
    $("day-next").disabled = !past;
    $("day-notice").hidden = !past;
    $("act-time-row").hidden = !past;

    const collapsed = !!d.status && !changing;
    $("checkin").hidden = collapsed; $("checkin-done").hidden = !collapsed;
    if (collapsed) { const c = d.statusPenalty || 0; setHTML($("checkin-done-text"), html`<span class="dot ${d.status}"></span><b>${named(d.status)}</b> · ${c ? `−${points(c)}` : "full points"}`) }
    document.querySelectorAll("#checkin button").forEach(b => {
      b.setAttribute("aria-pressed", b.dataset.s === d.status);
      const cost = S[b.dataset.s + "Penalty"] || 0; // green never costs anything
      b.querySelector(".cost").textContent = cost ? `−${points(cost)}` : "Full points";
    });
    const took = d.statusPenalty || 0;
    $("advice").textContent = d.status ? ADVICE[d.status] + (took ? ` ${d.status[0].toUpperCase() + d.status.slice(1)} takes ${points(took)} off ${past ? "this day" : "today"}.` : "") : past ? "No check-in for this day." : "How are you starting today? Pick one.";
    $("sleep").checked = !!d.poorSleep;
    const sleepCost = d.sleepPenalty ?? S.sleepPenalty, when = past ? "this day" : "today";
    $("sleep-title").textContent = past ? "Slept badly that night" : "Slept badly last night";
    $("sleep-label").textContent = !sleepCost ? "Recorded only: costs no points" : d.poorSleep ? `Taking ${points(sleepCost)} off ${when}` : `Takes ${points(sleepCost)} off ${when}`;
    setHTML($("left"), html`${left} <small>of ${cap}</small>`);
    $("balance-label").textContent = balanceLabel(left, cap);
    renderOngoing(ctx, $("today-ongoing"));
    $("spentline").textContent = spent >= 0 ? `${spent} spent` : `${-spent} recovered`;

    // The ring is a view of the saved allowance, not a target. Keep the actual
    // number unbounded when recovery takes it above the allowance or spending below zero.
    const fraction = cap > 0 ? Math.max(0, Math.min(1, left / cap)) : 0;
    $("energy-progress").setAttribute("stroke-dasharray", `${fraction * 100} 100`);
    $("energy-visual").dataset.level = left < 0 ? "over" : left === 0 ? "empty" : left <= 3 ? "low" : "ready";
    $("energy-caption").textContent = left < 0 ? "Beyond your planned allowance" : left > cap ? "Recovery added points back" : left === 0 ? "Your balance, without judgement" : "Your own planning aid";
    $("energy-entry-count").textContent = `${d.entries.length} ${d.entries.length === 1 ? "activity" : "activities"} logged`;

    const cells = $("cells");
    // Updated in place so the bar eases between states instead of being rebuilt (which looked like a flash).
    cells.style.gridTemplateColumns = `repeat(${Math.min(budget, 15)},1fr)`;
    while (cells.children.length < budget) cells.append(Object.assign(document.createElement("div"), { className: "cell" }));
    while (cells.children.length > budget) cells.lastChild.remove();
    [...cells.children].forEach((c, i) => { c.className = i >= cap ? "cell lost" : i >= Math.max(0, left) ? "cell spent" : "cell" });
    cells.className = "cells" + (left <= 0 ? " out" : left <= 3 ? " low" : "");

    renderActivities(S);
    renderOnboarding(S, past);

    $("activity-log").hidden = !d.entries.length;
    setHTML($("entries"), html`${d.entries.map((e, i) => html`<li><div class="logged-activity"><span class="meta logged-time">${e.t || "Time not set"}</span><span class="logged-name">${e.a}</span><b class="logged-cost">${costLabel(e.c)}</b></div><div class="logged-actions"><button type="button" class="secondary logged-edit" data-entry="${e.id}" data-action="edit" aria-label="Edit ${e.a}">Edit</button><button type="button" class="secondary logged-remove" data-entry="${e.id}" data-action="remove" aria-label="Remove ${e.a}">Remove</button></div></li>`)}`);
  }

  function renderOnboarding(S, past) {
    const raw = ctx.store.view("settings"), ob = raw?.onboarding || {}, days = listDays(ctx.store.all());
    const checked = days.some(x => x.status), logged = days.some(x => x.entries.length), done = checked && logged;
    // Shown to an account that hasn't made its first check-in and log yet; once both are done it stays up, all ticked,
    // until the app is next opened, so it doesn't vanish under the person's finger.
    const show = !!raw && !ob.dismissed && !past && (!done || onboardingSeen);
    $("onboarding").hidden = !show;
    if (!show) return;
    onboardingSeen = true;
    $("onboarding-title").textContent = done ? "You're set up. See you tomorrow morning." : "Get started in under a minute";
    $("step-checkin").classList.toggle("done", checked);
    $("step-activity").classList.toggle("done", logged);
    $("step-budget").classList.toggle("done", !!ob.budget);
    if (document.activeElement !== $("onboarding-budget")) $("onboarding-budget").value = S.budget;
  }

  return { render, open, day: () => viewDate, show() { if (entryForm.hidden) restoreDraft(); render() } };
}
