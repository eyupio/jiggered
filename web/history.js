// The History tab: the last two weeks at a glance, trends, every day and episode, and ways to share them.

import { $, html, setHTML, fmtDay, fmtWhen, fmtLongDay } from "./util.js";
import { addDays, listDays, listEpisodes, used, capOf, trends, daysCsv, episodesCsv, summary, RANGES } from "./model.js";

const PAGE = 30;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type })); // the BOM makes Excel read the UTF-8 properly
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function init(ctx) {
  let shown = PAGE;
  setHTML($("sum-range"), html`${RANGES.map(([v, label]) => html`<option value="${v}">${label}</option>`)}`);

  $("more-days").addEventListener("click", () => { shown += PAGE; render() });
  $("days").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (b) ctx.openDay(b.dataset.day) });
  $("strip").addEventListener("click", e => { const b = e.target.closest("[data-day]"); if (b) ctx.openDay(b.dataset.day) });

  $("eps").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = b.dataset.id;
    if (b.classList.contains("edit")) return ctx.editEpisode(id);
    if (b.classList.contains("del")) {
      const body = ctx.store.view(id);
      if (!body) return;
      ctx.store.dispatch({ id, type: "remove" });
      ctx.toast("Episode deleted.", { label: "Undo", fn: () => ctx.store.dispatch({ id, type: "replace", arg: body }) });
    }
  });

  $("csv-days").addEventListener("click", () => download(`jiggered-days-${ctx.today()}.csv`, daysCsv(ctx.store.all(), ctx.settings()), "text/csv;charset=utf-8"));
  $("csv-eps").addEventListener("click", () => download(`jiggered-episodes-${ctx.today()}.csv`, episodesCsv(ctx.store.all()), "text/csv;charset=utf-8"));
  $("sum-print").addEventListener("click", () => {
    renderSummary();
    document.body.classList.add("printing");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing"), { once: true });
    window.print();
  });

  function renderSummary() {
    const S = ctx.settings(), L = S.locale;
    const range = $("sum-range").value, sm = summary(ctx.store.all(), S, range, ctx.today());
    const label = RANGES.find(([v]) => v === range)[1];
    const list = pairs => pairs.length ? pairs.map(([n, c]) => `${n} (${c})`).join(", ") : "none recorded";
    setHTML($("print-view"), html`
      <h1>Jiggered summary</h1>
      <p>${label}: ${fmtLongDay(sm.from, L)} to ${fmtLongDay(sm.to, L)}. Printed ${fmtLongDay(ctx.today(), L)}.</p>
      <h2>Check-ins</h2>
      <p>${plural(sm.days.filter(d => d.status).length, "day")} with a check-in: ${sm.green} green, ${sm.amber} amber, ${sm.red} red.
        ${sm.avgUsed === null ? "" : `On average ${sm.avgUsed} points were spent on the days that were logged.`}
        ${sm.poorSleepDays ? `Poor sleep was recorded on ${plural(sm.poorSleepDays, "day")}.` : ""}</p>
      <h2>Episodes (${sm.episodes.length})</h2>
      ${sm.episodes.length ? html`
        <p>Most often noticed: ${list(sm.topSymptoms)}.</p>
        <p>Most often in the day or two before: ${list(sm.topTriggers)}.</p>
        <table><thead><tr><th>Started</th><th>What was noticed</th><th>How it came on</th><th>How long</th><th>Before</th><th>Notes</th></tr></thead><tbody>
        ${sm.episodes.map(e => html`<tr><td>${fmtWhen(e.when, L)}</td><td>${(e.symptoms || []).join(", ")}</td><td>${e.onset || ""}</td><td>${e.duration || ""}</td><td>${(e.before || []).join(", ")}</td><td>${e.notes || ""}</td></tr>`)}
        </tbody></table>` : html`<p>None logged in this period.</p>`}
      <h2>Days</h2>
      ${sm.days.length ? html`<table><thead><tr><th>Day</th><th>Check-in</th><th>Points spent</th><th>Poor sleep</th></tr></thead><tbody>
        ${sm.days.map(d => html`<tr><td>${fmtDay(d.date, L)}</td><td>${d.status ? d.status[0].toUpperCase() + d.status.slice(1) : "none"}</td><td>${used(d)} of ${capOf(d, S)}</td><td>${d.poorSleep ? "yes" : ""}</td></tr>`)}
        </tbody></table>` : html`<p>No days logged in this period.</p>`}
      <p class="small-print">This is a personal log kept by the person it belongs to. It is not a medical record or a medical device.</p>`);
  }

  function render() {
    const S = ctx.settings(), L = S.locale, docs = ctx.store.all(), today = ctx.today();
    const days = listDays(docs), byDate = Object.fromEntries(days.map(d => [d.date, d]));

    setHTML($("strip"), html`${Array.from({ length: 14 }, (_, i) => {
      const k = addDays(today, i - 13), s = byDate[k] && byDate[k].status;
      return html`<button class="${s || ""}" data-day="${k}" title="${k}" aria-label="${fmtDay(k, L)}: ${s || "no check-in"}"></button>`;
    })}`);

    const t = trends(docs, S, today, 30);
    const eps = listEpisodes(docs);
    $("trends-panel").hidden = days.length < 3 && eps.length === 0;
    if (!$("trends-panel").hidden) {
      const names = pairs => pairs.map(([n, c]) => `${n} (${c})`).join(", ");
      setHTML($("trends"), html`
        <div class="stats">
          <div class="stat green"><b>${t.green}</b><span>green</span></div>
          <div class="stat amber"><b>${t.amber}</b><span>amber</span></div>
          <div class="stat red"><b>${t.red}</b><span>red</span></div>
          <div class="stat"><b>${t.unchecked}</b><span>no check-in</span></div>
        </div>
        <div class="trend-notes meta">
          ${t.avgUsed === null ? "" : html`<p>On average ${t.avgUsed} points spent on the days you logged.</p>`}
          ${t.poorSleepDays ? html`<p>Poor sleep on ${plural(t.poorSleepDays, "day")}; ${t.poorSleepBad} of those ended up amber or red.</p>` : ""}
          <p>Episodes: ${t.episodes30} in the last 30 days, ${t.episodes90} in the last 90.</p>
          ${t.topTriggers.length ? html`<p>Most often in the day or two before an episode: ${names(t.topTriggers)}.</p>` : ""}
          ${t.topSymptoms.length ? html`<p>Most often noticed: ${names(t.topSymptoms)}.</p>` : ""}
        </div>`);
    }

    setHTML($("days"), html`${days.slice(0, shown).map(d => html`<li><button class="dayrow" data-day="${d.date}"><span><span class="dot ${d.status || ""}"></span>${fmtDay(d.date, L)}${d.poorSleep ? html` <span class="meta">· poor sleep</span>` : ""}</span><span class="meta">${used(d)} of ${capOf(d, S)} used</span></button></li>`)}`);
    $("more-days").hidden = days.length <= shown;
    $("nodays").hidden = days.length > 0;

    setHTML($("eps"), html`${eps.map(([id, x]) => html`<div class="ep"><b>${fmtWhen(x.when, L)}</b>
      <span>${(x.symptoms || []).join(", ") || "No symptoms ticked"}</span>
      <span class="meta">${[x.onset, x.duration].filter(Boolean).join(" · ")}</span>
      ${(x.before || []).length ? html`<span class="meta">Before: ${x.before.join(", ")}</span>` : ""}
      ${x.notes ? html`<span class="meta">${x.notes}</span>` : ""}
      <span class="actions"><button class="x edit" data-id="${id}">Edit</button> <button class="x del" data-id="${id}">Delete</button></span></div>`)}`);
    $("noeps").hidden = eps.length > 0;
  }

  return { render, show() { shown = PAGE; render() } };
}
