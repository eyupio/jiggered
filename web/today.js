// The Today tab: morning check-in, the points gauge, tapping activities. It can also show and edit a past day.

import { $, html, setHTML, uid, fmtLongDay } from "./util.js";
import { renderOngoing } from "./episodes.js";
import { readableDay, balanceLabel, ADVICE, dayId, emptyDay, used, capOf, hhmm, addDays } from "./model.js";

const costLabel = c => c > 0 ? "−" + c : c < 0 ? "+" + -c : "0";

export function init(ctx) {
  let viewDate = null; // null follows the clock, so the screen moves on by itself at midnight
  let actsKey = "";

  const key = () => viewDate ?? ctx.today();
  const id = () => dayId(key());
  const day = () => readableDay(ctx.store.view(id()), key());
  // Each change is an operation on the day, stamped with the budget in force so history keeps its own numbers.
  const op = (type, arg) => {
    const S = ctx.settings();
    ctx.store.dispatch({ id: id(), type, arg, stamp: { budget: S.budget, sleepPenalty: S.sleepPenalty } });
  };

  function open(date) {
    viewDate = date === ctx.today() ? null : date;
    render();
  }

  $("checkin").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    op("setStatus", day().status === b.dataset.s ? null : b.dataset.s);
  });
  $("sleep").addEventListener("change", e => op("setPoorSleep", e.target.checked));
  $("acts").addEventListener("click", e => {
    const b = e.target.closest(".act");
    if (!b) return;
    const x = ctx.settings().activities[b.dataset.i];
    if (!x) return;
    const past = key() !== ctx.today();
    op("addEntry", { id: uid(), a: x.a, c: x.c, t: past ? $("act-time").value : hhmm(new Date()) });
  });
  $("entries").addEventListener("click", e => {
    const b = e.target.closest(".x");
    if (!b) return;
    const entry = day().entries[b.dataset.i];
    if (entry) op("removeEntry", entry);
  });

  $("day-prev").addEventListener("click", () => open(addDays(key(), -1)));
  $("day-next").addEventListener("click", () => { if (key() < ctx.today()) open(addDays(key(), 1)) });
  $("day-back").addEventListener("click", () => open(ctx.today()));
  $("day-pick").addEventListener("change", e => {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= ctx.today()) open(v);
    else render();
  });

  function render() {
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
    $("sleep-label").textContent = `Poor sleep last night (−${d.sleepPenalty ?? S.sleepPenalty} off ${past ? "this day" : "today"})`;
    setHTML($("left"), html`${left} <small>of ${cap}</small>`);
    $("balance-label").textContent = balanceLabel(left, cap);
    renderOngoing(ctx, $("today-ongoing"));
    $("spentline").textContent = spent >= 0 ? `${spent} spent` : `${-spent} recovered`;

    const cells = $("cells");
    cells.style.gridTemplateColumns = `repeat(${Math.min(budget, 15)},1fr)`;
    setHTML(cells, html`${Array.from({ length: budget }, (_, i) => html`<div class="${i >= cap ? "cell lost" : i >= Math.max(0, left) ? "cell spent" : "cell"}"></div>`)}`);
    cells.className = "cells" + (left <= 0 ? " out" : left <= 3 ? " low" : "");

    const ak = JSON.stringify(S.activities);
    if (ak !== actsKey) { // only rebuild the buttons when the activity list changes
      actsKey = ak;
      setHTML($("acts"), html`${S.activities.map((x, i) => html`<button class="act${x.c < 0 ? " rec" : ""}" data-i="${i}"><span>${x.a}</span><span class="c">${costLabel(x.c)}</span></button>`)}`);
      $("noacts").hidden = S.activities.length > 0;
    }

    setHTML($("entries"), html`${d.entries.map((e, i) => html`<li><span><span class="meta">${e.t}</span> ${e.a} <b>${costLabel(e.c)}</b></span><button class="x" data-i="${i}">Undo</button></li>`)}`);
    $("noentries").hidden = d.entries.length > 0;
  }

  return { render, open, show() { render() } };
}

