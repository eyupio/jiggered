// The Today tab: morning check-in, the points gauge, tapping activities. It can also show and edit a past day.

import { $, html, setHTML, uid, fmtLongDay } from "./util.js";
import { renderOngoing } from "./episodes.js";
import { PICKER, usage, favourites, groupItems, matches } from "./picker.js";
import { readableDay, identifyEntries, balanceLabel, ADVICE, dayId, emptyDay, used, capOf, hhmm, addDays } from "./model.js";

const costLabel = c => c > 0 ? "−" + c : c < 0 ? "+" + -c : "0";

export function init(ctx) {
  let viewDate = null; // null follows the clock, so the screen moves on by itself at midnight
  let actsKey = "", editing = null, editingDate = "", query = "";
  const more = new Map(), closed = new Set(); // per-group paging and collapsed groups, kept while this tab is open
  const entryForm = $("entry-form");

  const key = () => viewDate ?? ctx.today();
  const id = () => dayId(key());
  const day = () => { const d = readableDay(ctx.store.view(id()), key()); return { ...d, entries: identifyEntries(d.entries) } };
  // Each change is an operation on the day, stamped with the budget in force so history keeps its own numbers.
  const op = (type, arg, before) => {
    const S = ctx.settings();
    return ctx.store.dispatch({ id: id(), type, arg, before, original: ctx.store.view(id()), stamp: { budget: S.budget, sleepPenalty: S.sleepPenalty } });
  };

  function open(date) {
    viewDate = date === ctx.today() ? null : date;
    editing = null; entryForm.hidden = true; restoreDraft(); render();
  }

  $("checkin").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    op("setStatus", day().status === b.dataset.s ? null : b.dataset.s);
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
  $("acts").addEventListener("click", e => {
    const b = e.target.closest(".act");
    if (!b) return;
    const x = ctx.settings().activities[b.dataset.i];
    if (!x) return;
    const past = key() !== ctx.today();
    op("addEntry", { id: uid(), a: x.a, c: x.c, t: past ? $("act-time").value : hhmm(new Date()) });
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
    const target = id(); op("removeEntry", entry);
    ctx.toast("Activity removed.", { label: "Undo removal", fn: () => ctx.store.dispatch({ id: target,type: "restoreEntry",arg: { entry,index } }) });
  });

  $("day-prev").addEventListener("click", () => open(addDays(key(), -1)));
  $("day-next").addEventListener("click", () => { if (key() < ctx.today()) open(addDays(key(), 1)) });
  $("day-back").addEventListener("click", () => open(ctx.today()));
  $("day-pick").addEventListener("change", e => {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= ctx.today()) open(v);
    else render();
  });

  const actButton = ({ item: x, i }) => html`<button class="act${x.c < 0 ? " rec" : ""}" data-i="${i}"><span>${x.a}</span><span class="c">${costLabel(x.c)}</span></button>`;
  // Long lists get a search box, a favourites row (most and latest used), sections by group and "Show more" paging.
  // Short lists look exactly as before. Buttons keep their index into the settings list, so tapping is unchanged.
  function renderActivities(S) {
    const rows = S.activities.map((item, i) => ({ item, i })), long = rows.length > PICKER.searchFrom;
    $("act-search-row").hidden = !long;
    const q = long ? query.trim() : "";
    const favs = !q && long ? favourites(rows.map(r => r.item.a), usage(ctx.store.all(), ctx.today()).acts).map(n => rows.find(r => r.item.a === n)) : [];
    const sections = q ? [{ key: "search", name: "", rows: rows.filter(r => matches(q, r.item.a + " " + (r.item.g || ""))), size: PICKER.searchPage }]
      : groupItems(S.activities).map(g => ({ key: "g:" + g.name, name: g.name, rows: g.rows, size: PICKER.page }));
    const key = JSON.stringify([S.activities, q, favs.map(f => f.i), [...more], [...closed], long]);
    if (key === actsKey) return; // only rebuild the buttons when something shown has changed
    actsKey = key;
    const grid = list => html`<div class="acts">${list.map(actButton)}</div>`;
    const part = s => {
      const shown = more.get(s.key) ?? s.size, hide = s.rows.length - shown;
      const body = html`${grid(s.rows.slice(0, shown))}${hide > 0 ? html`<button class="secondary small" data-more="${s.key}">Show ${Math.min(hide, s.size)} more of ${s.rows.length}</button>` : ""}`;
      return s.name ? html`<details class="act-group" data-group="${s.key}"${closed.has(s.key) ? "" : " open"}><summary>${s.name} <span class="meta">${s.rows.length}</span></summary>${body}</details>` : body;
    };
    setHTML($("acts"), html`${favs.length ? html`<div class="act-fav"><h3 class="label">Frequent and recent</h3>${grid(favs)}</div>` : ""}${sections.map(part)}${q && !sections[0].rows.length ? html`<p class="empty">No activity matches. Use Other activity to log it once.</p>` : ""}`);
    $("noacts").hidden = S.activities.length > 0;
  }

  function render() {
    if (!entryForm.hidden && editingDate !== key()) { editing = null; entryForm.hidden = true }
    const S = ctx.settings(), d = day(), k = key(), past = k !== ctx.today();
    const budget = d.budget ?? S.budget, spent = used(d), cap = capOf(d, S), left = cap - spent;

    $("day-label").textContent = past ? fmtLongDay(k, S.locale) : "Today";
    $("day-pick").value = k;
    $("day-pick").max = ctx.today();
    $("day-next").disabled = !past;
    $("day-notice").hidden = !past;
    $("act-time-row").hidden = !past;

    document.querySelectorAll("#checkin button").forEach(b => b.setAttribute("aria-pressed", b.dataset.s === d.status));
    $("advice").textContent = d.status ? ADVICE[d.status] : past ? "No check-in for this day." : "How are you starting today? Pick one.";
    $("sleep").checked = !!d.poorSleep;
    $("sleep-label").textContent = `Tick if you slept badly: takes ${d.sleepPenalty ?? S.sleepPenalty} off ${past ? "this day" : "today"}`;
    setHTML($("left"), html`${left} <small>of ${cap}</small>`);
    $("balance-label").textContent = balanceLabel(left, cap);
    renderOngoing(ctx, $("today-ongoing"));
    $("spentline").textContent = spent >= 0 ? `${spent} spent` : `${-spent} recovered`;

    const cells = $("cells");
    // Updated in place so the bar eases between states instead of being rebuilt (which looked like a flash).
    cells.style.gridTemplateColumns = `repeat(${Math.min(budget, 15)},1fr)`;
    while (cells.children.length < budget) cells.append(Object.assign(document.createElement("div"), { className: "cell" }));
    while (cells.children.length > budget) cells.lastChild.remove();
    [...cells.children].forEach((c, i) => { c.className = i >= cap ? "cell lost" : i >= Math.max(0, left) ? "cell spent" : "cell" });
    cells.className = "cells" + (left <= 0 ? " out" : left <= 3 ? " low" : "");

    renderActivities(S);

    setHTML($("entries"), html`${d.entries.map((e, i) => html`<li><span><span class="meta">${e.t}</span> ${e.a} <b>${costLabel(e.c)}</b></span><span class="row"><button class="x" data-entry="${e.id}" data-action="edit" aria-label="Edit ${e.a}">Edit</button><button class="x" data-entry="${e.id}" data-action="remove" aria-label="Remove ${e.a}">Remove</button></span></li>`)}`);
    $("noentries").hidden = d.entries.length > 0;
  }

  return { render, open, show() { if (entryForm.hidden) restoreDraft(); render() } };
}

