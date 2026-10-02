// The History tab: the last two weeks at a glance, trends, every day and episode, and ways to share them.

import { energyWords, themeOf } from "./energy-theme.js";
import { $, html, setHTML, fmtDay, fmtWhen, fmtLongDay } from "./util.js";
import {
  addDays,
  listDays,
  listEpisodes,
  used,
  capOf,
  daysCsv,
  episodesCsv,
  summary,
  RANGES,
  selectHistory,
} from "./model.js";

import { historyRange, historyInsights } from "./history-model.js";
import { chartMarkup, connectCharts } from "./history-charts.js";
import { normaliseProfile } from "./profile.js";
import { initMatrix } from "./history-matrix.js";

const PAGE = 30;
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type })); // the BOM makes Excel read the UTF-8 properly
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function init(ctx) {
  const words = () => energyWords(themeOf(ctx));
  let shown = PAGE,
    episodesShown = PAGE,
    rangeMode = "30",
    initialised = false,
    rangeToday = ctx.today(),
    chartWindow = "";
  const matrix = initMatrix($("history-matrix"), ctx, (date) => {
    $("hist-from").value = $("hist-to").value = date;
    rangeMode = "custom";
    shown = episodesShown = PAGE;
    openFilters();
    render();
    $("eps").scrollIntoView({ block: "start" });
    $("hist-from").focus({ preventScroll: true });
  });
  const openFilters = () => {
    $("history-filter-panel").open = true;
  };
  const setRange = (key) => {
    rangeMode = key;
    rangeToday = ctx.today();
    const dates = historyRange(ctx.store.all(), ctx.today(), key);
    $("hist-from").value = key === "all" ? "" : dates.from;
    $("hist-to").value = key === "all" ? "" : dates.to;
    shown = episodesShown = PAGE;
  };
  $("history-presets").addEventListener("click", (e) => {
    const button = e.target.closest("[data-range]");
    if (button) {
      initialised = true;
      setRange(button.dataset.range);
      render();
    }
  });
  $("history-insights").addEventListener("click", (e) => {
    const b = e.target.closest("[data-symptom],[data-query]");
    if (!b) return;
    if (b.dataset.symptom) $("hist-symptom").value = b.dataset.symptom;
    else $("hist-query").value = b.dataset.query;
    shown = episodesShown = PAGE;
    openFilters();
    render();
    $("history-filters").scrollIntoView({ block: "start" });
    $(b.dataset.symptom ? "hist-symptom" : "hist-query").focus({ preventScroll: true });
  });
  const filters = () => ({
    from: $("hist-from").value,
    to: $("hist-to").value,
    status: $("hist-status").value,
    symptom: $("hist-symptom").value,
    ongoing: $("hist-ongoing").checked,
    query: $("hist-query").value,
  });
  const selectedDocs = () => {
    const selected = selectHistory(ctx.store.all(), filters());
    return Object.fromEntries([
      ...selected.days.map((d) => ["d-" + d.date, d]),
      ...selected.episodes,
    ]);
  };
  $("history-filters").addEventListener("submit", (e) => e.preventDefault());
  // Typing in the search box waits for a short pause before the whole view is recomputed, so a word is one update
  // rather than one per letter. The count line says so meanwhile. Dates, selects and buttons still update at once.
  let searchTimer = null;
  const SEARCH_PAUSE = 250;
  const renderNow = () => {
    clearTimeout(searchTimer);
    searchTimer = null;
    render();
  };
  $("history-filters").addEventListener("input", (e) => {
    initialised = true;
    if (["hist-from", "hist-to"].includes(e.target.id)) rangeMode = "custom";
    shown = episodesShown = PAGE;
    if (e.target.id === "hist-query") {
      $("history-count").textContent = "Updating…";
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderNow, SEARCH_PAUSE);
      return;
    }
    renderNow();
  });
  $("history-filters").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "hist-query" && searchTimer !== null) {
      e.preventDefault();
      renderNow();
    }
  });
  // Jump to Overview, Records or Share. This only scrolls and moves focus: the filters stay exactly as they are.
  $("history-shortcuts").addEventListener("click", (e) => {
    const target = e.target.closest("[data-history-target]");
    if (!target) return;
    const panel = $(target.dataset.historyTarget);
    panel.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    (panel.querySelector("h2[tabindex]") || panel.querySelector("h2"))?.focus({
      preventScroll: true,
    });
  });
  $("history-filters").addEventListener("reset", () =>
    setTimeout(() => {
      initialised = true;
      setRange("all");
      render();
    }, 0),
  );
  $("more-eps").addEventListener("click", () => {
    episodesShown += PAGE;
    render();
  });
  $("sum-preview").addEventListener("click", () => {
    renderSummary();
    $("summary-preview").innerHTML = $("print-view").innerHTML;
    $("summary-preview").hidden = !$("summary-preview").hidden;
  });
  $("sum-range").addEventListener("change", () => {
    if (!$("summary-preview").hidden) {
      renderSummary();
      $("summary-preview").innerHTML = $("print-view").innerHTML;
    }
  });
  $("sum-focus").addEventListener("change", () => {
    if (!$("summary-preview").hidden) {
      renderSummary();
      $("summary-preview").innerHTML = $("print-view").innerHTML;
    }
  });
  $("sum-notes").addEventListener("change", () => {
    if (!$("summary-preview").hidden) {
      renderSummary();
      $("summary-preview").innerHTML = $("print-view").innerHTML;
    }
  });
  setHTML(
    $("sum-range"),
    html`${RANGES.map(([v, label]) => html`<option value="${v}">${label}</option>`)}`,
  );

  $("more-days").addEventListener("click", () => {
    shown += PAGE;
    render();
  });
  $("days").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (b) ctx.openDay(b.dataset.day);
  });
  $("strip").addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (b) ctx.openDay(b.dataset.day);
  });

  $("eps").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const id = b.dataset.id;
    if (b.classList.contains("edit")) return ctx.editEpisode(id);
    if (b.classList.contains("del")) {
      const body = ctx.store.view(id);
      if (!body) return;
      ctx.store.dispatch({ id, type: "remove" });
      ctx.toast("Episode deleted.", {
        label: "Undo",
        fn: () => ctx.store.dispatch({ id, type: "replace", arg: body }),
      });
    }
  });

  $("csv-days").addEventListener("click", () =>
    download(
      `jiggered-days-${ctx.today()}.csv`,
      daysCsv(selectedDocs(), ctx.settings()),
      "text/csv;charset=utf-8",
    ),
  );
  $("csv-eps").addEventListener("click", () =>
    download(
      `jiggered-episodes-${ctx.today()}.csv`,
      episodesCsv(selectedDocs()),
      "text/csv;charset=utf-8",
    ),
  );
  $("sum-print").addEventListener("click", () => {
    renderSummary();
    document.body.classList.add("printing");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing"), {
      once: true,
    });
    window.print();
  });

  function renderSummary() {
    const S = ctx.settings(),
      L = S.locale;
    const range = $("sum-range").value,
      sm = summary(ctx.store.all(), S, range, ctx.today());
    const label = RANGES.find(([v]) => v === range)[1];
    const list = (pairs) =>
      pairs.length ? pairs.map(([n, c]) => `${n} (${c})`).join(", ") : "none recorded";
    setHTML(
      $("print-view"),
      html`
      <h1>Jiggered summary</h1>
      <p>${label}: ${fmtLongDay(sm.from, L)} to ${fmtLongDay(sm.to, L)}. Printed ${fmtLongDay(ctx.today(), L)}.</p>
      ${focus() && $("sum-focus").checked ? html`<p><b>What I'm tracking:</b> ${focus()}</p>` : ""}
      <h2>Check-ins</h2>
      <p>${plural(sm.days.filter((d) => d.status).length, "day")} with a check-in: ${sm.green} green, ${sm.amber} amber, ${sm.red} red.
        ${sm.avgUsed === null ? "" : `On the ${plural(sm.activityDays, "day")} with activities, the average net ${words().plural} were ${sm.avgUsed} (activities minus recovery; days with only a check-in are not counted).`}
        ${sm.poorSleepDays ? `Poor sleep was recorded on ${plural(sm.poorSleepDays, "day")}.` : ""}</p>
      <h2>Episodes (${sm.episodes.length})</h2>
      ${
        sm.episodes.length
          ? html`
        <p>Most often noticed: ${list(sm.topSymptoms)}.</p>
        <p>Most often in the day or two before: ${list(sm.topTriggers)}.</p>
        <table><thead><tr><th>Started</th><th>What was noticed</th><th>How it came on</th><th>Approximate duration</th><th>Ended (local)</th><th>Before</th><th>Notes</th></tr></thead><tbody>
        ${sm.episodes.map((e) => html`<tr><td>${fmtWhen(e.when, L)}</td><td>${(e.symptoms || []).join(", ")}</td><td>${e.onset || ""}</td><td>${e.duration || ""}</td><td>${e.endedAt ? fmtWhen(e.endedAt, L) : "Not recorded"}</td><td>${(e.before || []).join(", ")}</td><td>${$("sum-notes").checked ? e.notes || "" : "Omitted"}</td></tr>`)}
        </tbody></table>`
          : html`<p>None logged in this period.</p>`
      }
      <h2>Days</h2>
      ${
        sm.days.length
          ? html`<table><thead><tr><th>Day</th><th>Check-in</th><th>${words().title} spent</th><th>Poor sleep</th></tr></thead><tbody>
        ${sm.days.map((d) => html`<tr><td>${fmtDay(d.date, L)}</td><td>${d.status ? d.status[0].toUpperCase() + d.status.slice(1) : "none"}</td><td>${used(d)} of ${capOf(d, S)}</td><td>${d.poorSleep ? "yes" : ""}</td></tr>`)}
        </tbody></table>`
          : html`<p>No days logged in this period.</p>`
      }
      <p class="small-print">Times are local as recorded; CSV includes any recorded time-zone offsets. Older records may have none. This is a personal log kept by the person it belongs to. It is not a medical record or a medical device.</p>`,
    );
  }

  const focus = () => normaliseProfile(ctx.store.view("settings")?.profile).focus;
  // With fewer than 3 check-ins and no episodes, the graphs and patterns would only be empty boxes: one panel says
  // how close the person is instead, and the records and sharing stay just below it.
  const STARTER = 3;
  let lastActive = "";
  function renderStarter(docs) {
    const checkins = listDays(docs).filter((d) => d.status).length,
      thin = checkins < STARTER && !listEpisodes(docs).length;
    for (const id of [
      "history-filter-panel",
      "history-shortcuts",
      "trends-panel",
      "history-matrix",
      "history-graphs",
      "history-patterns",
    ])
      $(id).classList.toggle("starter-hidden", thin);
    $("history-starter").hidden = !thin;
    if (thin)
      setHTML(
        $("history-starter"),
        html`<h2>Your patterns appear after ${STARTER} check-ins</h2><p class="meta">You have ${plural(checkins, "check-in")} so far. Graphs, a calendar and patterns appear here once there's enough to show. Your days and sharing are below.</p><div class="starter-progress" role="img" aria-label="${checkins} of ${STARTER} check-ins">${Array.from({ length: STARTER }, (_, i) => html`<span class="${i < checkins ? "on" : ""}"></span>`)}</div><button class="secondary" data-go-today>Go to today's check-in</button>`,
      );
    return thin;
  }
  $("history-starter").addEventListener("click", (e) => {
    if (e.target.closest("[data-go-today]")) ctx.go("today");
  });

  function render() {
    const S = ctx.settings(),
      L = S.locale,
      docs = ctx.store.all(),
      today = ctx.today();
    renderStarter(docs);
    if (!$("summary-preview").hidden) {
      renderSummary();
      $("summary-preview").innerHTML = $("print-view").innerHTML;
    }
    const f = focus();
    $("history-lens").textContent = f
      ? `You wanted to notice: “${f}”`
      : "Explore what you've recorded, notice patterns, and take a clearer picture to your next conversation.";
    $("sum-focus-row").hidden = !f;
    $("sum-focus-text").textContent = f ? `“${f}”` : "";
    if (!initialised && ctx.store.status().loaded) {
      initialised = true;
      setRange(normaliseProfile(ctx.store.view("settings")?.profile).historyRange);
    }
    if (rangeMode !== "custom" && rangeToday !== today) setRange(rangeMode);
    $("hist-from").max = $("hist-to").max = today;
    for (const button of $("history-presets").querySelectorAll("[data-range]"))
      button.setAttribute("aria-pressed", button.dataset.range === rangeMode);
    const selected = selectHistory(docs, filters()),
      days = selected.days,
      byDate = Object.fromEntries(listDays(docs).map((d) => [d.date, d]));
    const symptom = $("hist-symptom").value,
      options = [...new Set([...S.symptoms, ...listEpisodes(docs).flatMap(([, e]) => e.symptoms)])];
    setHTML(
      $("hist-symptom"),
      html`<option value="">Any</option>${options.map((name) => html`<option value="${name}">${name}</option>`)}`,
    );
    $("hist-symptom").value = symptom;
    const active = [
      filters().status && `check-in: ${filters().status}`,
      filters().symptom && `symptom: ${filters().symptom}`,
      filters().ongoing && "ongoing only",
      filters().query.trim() && `“${filters().query.trim()}”`,
      rangeMode === "custom" && "custom dates",
    ].filter(Boolean);
    $("history-filter-summary").textContent = active.length ? active.join(" · ") : "None";
    if (active.join() !== lastActive && active.length) $("history-filter-panel").open = true; // a newly applied filter is never hidden
    lastActive = active.join();
    $("history-count").textContent =
      filters().from && filters().to && filters().from > filters().to
        ? "Choose an end date on or after the start date."
        : `${plural(days.length, "day")} and ${plural(selected.episodes.length, "episode")} match. Check-in filters apply to days; symptom/ongoing filters apply to episodes.`;

    setHTML(
      $("strip"),
      html`${Array.from({ length: 14 }, (_, i) => {
        const k = addDays(today, i - 13),
          s = byDate[k] && byDate[k].status;
        return html`<button class="${s || ""}" data-day="${k}" title="${k}" aria-label="${fmtDay(k, L)}: ${s || "no check-in"}"><span>${Number(k.slice(-2))}</span><b>${s ? s[0].toUpperCase() : "–"}</b></button>`;
      })}`,
    );

    const eps = selected.episodes,
      data = historyInsights(docs, S, today, filters());
    $("history-graphs").hidden =
      $("history-patterns").hidden =
      $("history-matrix").hidden =
        !!data.error;
    if (data.error) {
      $("history-count").textContent = data.error;
      $("history-period").textContent = "Adjust the dates to explore your history.";
      $("history-granularity").textContent = "Check dates";
      setHTML($("trends"), html`<p class="empty">${data.error}</p>`);
    } else {
      const m = data.metrics,
        p = data.prior,
        hasFilters = !!(
          filters().status ||
          filters().symptom ||
          filters().ongoing ||
          filters().query.trim()
        );
      $("history-period").textContent =
        `${fmtDay(data.from, L)} – ${fmtDay(data.to, L)} · ${plural(data.span, "calendar day")}${hasFilters ? " · filters active" : ""}`;
      $("history-granularity").textContent =
        data.bucketDays === 1 ? "Daily view" : `Up to ${data.bucketDays} days per point`;
      const avgChange =
        m.logged >= 3 && p.logged >= 3 ? Math.round((m.avgUsed - p.avgUsed) * 10) / 10 : null;
      const comparison =
        avgChange === null
          ? "Comparison needs 3 activity days in each period."
          : `${avgChange === 0 ? "Unchanged" : `${Math.abs(avgChange)} ${avgChange > 0 ? "more" : "fewer"} ${words().plural}/day`} than the previous period (${p.logged} activity days).`;
      setHTML(
        $("trends"),
        html`<div class="history-metrics">
        <div class="metric"><span class="label">${hasFilters ? "Matching check-ins" : "Check-ins"}</span><b>${m.checked}<small> / ${data.span}</small></b><span class="meta">${Math.round((m.checked / data.span) * 100)}% of calendar days</span></div>
        <div class="metric"><span class="label">Average net ${words().plural}</span><b>${m.avgUsed === null ? "—" : m.avgUsed}</b><span class="meta">${plural(m.logged, "day")} with activities</span></div>
        <div class="metric"><span class="label">Episodes recorded</span><b>${m.episodes}</b><span class="meta">${m.episodes - p.episodes === 0 ? "Same count as" : `${Math.abs(m.episodes - p.episodes)} ${m.episodes > p.episodes ? "more" : "fewer"} than`} previous period</span></div>
        <div class="metric"><span class="label">Past the allowance</span><b>${m.overBudget}<small> / ${m.logged}</small></b><span class="meta">Days with activities logged</span></div>
      </div>
      <div class="checkin-summary"><h3>Morning check-ins</h3><svg class="checkin-composition" viewBox="0 0 600 18" preserveAspectRatio="none" role="img" aria-label="${m.green} green, ${m.amber} amber, ${m.red} red, ${data.span - m.checked} days without a matching check-in"><rect class="composition-empty" width="600" height="18" rx="7"></rect>${["green", "amber", "red"].map((key, i, keys) => html`<rect class="composition-${key}" x="${(keys.slice(0, i).reduce((n, k) => n + m[k], 0) / data.span) * 600}" width="${(m[key] / data.span) * 600}" height="18"></rect>`)}</svg><div class="chart-legend">${["green", "amber", "red"].map((key) => html`<span><i class="legend-${key}"></i>${m[key]} ${key}</span>`)}<span>${data.span - m.checked} ${hasFilters ? "without a matching check-in" : "without a check-in"}</span></div></div>
      <p class="hint comparison-note">${comparison} Previous period: ${fmtDay(data.previousFrom, L)} – ${fmtDay(data.previousTo, L)}. Counts reflect your logging, including any filters.</p>`,
      );
      matrix.render(data, S);
      const nextChartWindow = `${data.from}:${data.to}`;
      const remembered =
        chartWindow === nextChartWindow
          ? [...$("history-charts").querySelectorAll("[data-chart]")].map((card) => [
              card.dataset.chart,
              card.querySelector("[data-inspect]").value,
            ])
          : [];
      chartWindow = nextChartWindow;
      setHTML(
        $("history-charts"),
        html`${chartMarkup(data, "energy", L, themeOf(ctx))}${chartMarkup(data, "episodes", L, themeOf(ctx))}`,
      );
      connectCharts(
        $("history-charts"),
        data,
        L,
        (bucket) => {
          if (bucket.from === bucket.to) ctx.openDay(bucket.from);
          else {
            $("hist-from").value = bucket.from;
            $("hist-to").value = bucket.to;
            rangeMode = "custom";
            shown = episodesShown = PAGE;
            openFilters();
            render();
            $("history-filters").scrollIntoView({ block: "start" });
            $("hist-from").focus({ preventScroll: true });
          }
        },
        themeOf(ctx),
      );
      for (const [kind, value] of remembered) {
        const select = $("history-charts").querySelector(`[data-chart="${kind}"] [data-inspect]`);
        if (select && Number(value) < data.buckets.length) {
          select.value = value;
          select.dispatchEvent(new Event("change"));
        }
      }
      renderPatterns(data, L);
    }

    setHTML(
      $("days"),
      html`${days.slice(0, shown).map((d) => html`<li><button class="dayrow" data-day="${d.date}"><span><span class="dot ${d.status || ""}"></span>${fmtDay(d.date, L)}${d.poorSleep ? html` <span class="meta">· poor sleep</span>` : ""}<span class="meta"> · ${d.status || "no check-in"}</span></span><span class="meta">${used(d)} of ${capOf(d, S)} ${words().plural} used</span></button></li>`)}`,
    );
    $("more-days").hidden = days.length <= shown;
    $("nodays").hidden = days.length > 0;

    setHTML(
      $("eps"),
      html`${eps.slice(0, episodesShown).map(
        ([id, x]) => html`<div class="ep"><b>${fmtWhen(x.when, L)}</b>
      <span>${(x.symptoms || []).join(", ") || "No symptoms ticked"}</span>
      <span class="meta">${[x.onset, x.duration].filter(Boolean).join(" · ")}</span>
      ${(x.before || []).length ? html`<span class="meta">Before: ${x.before.join(", ")}</span>` : ""}
      ${x.notes ? html`<span class="meta">${x.notes}</span>` : ""}
      <span class="actions"><button class="x edit" data-id="${id}">Edit</button> <button class="x del" data-id="${id}">Delete</button></span></div>`,
      )}`,
    );
    $("more-eps").hidden = eps.length <= episodesShown;
    $("noeps").hidden = eps.length > 0;
    $("noeps").textContent = listEpisodes(docs).length
      ? "No episodes match these filters. Clear filters to see everything."
      : "No episodes logged. Use Episode if one happens.";
    $("nodays").textContent = listDays(docs).length
      ? "No days match these filters. Clear filters to see everything."
      : "Your days appear here after a check-in or activity.";
  }

  function renderPatterns(data, locale) {
    const { metrics: m, sleep, weekdays, activities } = data;
    // With almost nothing to go on, a short note replaces the cards that would otherwise push the records far down.
    if (m.checked < 3 && m.logged < 3 && m.episodes < 3) {
      setHTML(
        $("history-insights"),
        html`<p class="empty">Patterns need at least a few check-ins, activity days or episodes in this view. Your records and sharing are just below; use the shortcuts above to jump to them.</p>`,
      );
      return;
    }
    const enoughSleep = sleep.poor.n >= 3 && sleep.other.n >= 3;
    const sampleWeekdays = weekdays
      .filter((w) => w.checked >= 3)
      .sort((a, b) => b.bad / b.checked - a.bad / a.checked || b.checked - a.checked);
    const weekday = sampleWeekdays[0],
      dayName = (w) =>
        new Date(Date.UTC(2024, 0, 7 + w.index)).toLocaleDateString(locale || undefined, {
          weekday: "long",
          timeZone: "UTC",
        });
    const ranking = (pairs, type) =>
      pairs.length
        ? html`<ul class="pattern-ranking">${pairs.map(([name, count]) => html`<li><button class="pattern-link" ${type === "symptom" ? html`data-symptom="${name}"` : html`data-query="${name}"`} data-tooltip="Filter history by ${name}"><span>${name}</span><b>${count}</b></button><meter min="0" max="${Math.max(1, m.episodes)}" value="${count}" aria-label="${name}: recorded in ${count} of ${m.episodes} episodes"></meter></li>`)}</ul>`
        : html`<p class="empty">No matching episode details recorded in this period.</p>`;
    setHTML(
      $("history-insights"),
      html`<p class="hint insights-note">Descriptions of your log, rather than explanations of why symptoms happen. Missing days and changes in logging affect the picture.</p><div class="patterns-grid">
      <article class="insight-card"><span class="label">Sleep &amp; check-ins</span><h3>${enoughSleep ? `${sleep.poor.percent}% after poor sleep` : "Build a clearer sleep picture"}</h3><p class="meta">${enoughSleep ? `Amber or red on ${sleep.poor.bad} of ${sleep.poor.n} checked-in days marked poor sleep, compared with ${sleep.other.percent}% (${sleep.other.bad} of ${sleep.other.n}) when sleep wasn't marked poor.` : `This comparison needs at least 3 checked-in days in each group. You have ${sleep.poor.n} marked poor sleep and ${sleep.other.n} not marked poor sleep.`}</p><p class="hint">A missing poor-sleep flag doesn't necessarily mean good sleep.</p></article>
      <article class="insight-card"><span class="label">Day of the week</span><h3>${weekday ? dayName(weekday) : "A little more history helps"}</h3><p class="meta">${weekday ? `Highest recorded share of amber/red check-ins among weekdays with at least 3 check-ins: ${weekday.bad} of ${weekday.checked} (${Math.round((weekday.bad / weekday.checked) * 100)}%).` : "Log at least 3 check-ins on a weekday to see its pattern here."}</p>${sampleWeekdays.length === 1 ? html`<p class="hint">Only one weekday has enough entries to compare so far.</p>` : ""}</article>
      <article class="insight-card"><span class="label">Most noticed</span><h3>Symptoms in your episodes</h3>${ranking(data.topSymptoms, "symptom")}<p class="hint">Each symptom counts once per episode. Tap to filter.</p></article>
      <article class="insight-card"><span class="label">Recorded beforehand</span><h3>In the day or two before</h3>${ranking(data.topTriggers, "query")}<p class="hint">What you recorded before episodes; this doesn't establish a cause.</p></article>
      <article class="insight-card activity-patterns"><span class="label">Your everyday rhythm</span><h3>Most logged activities</h3>${activities.length ? html`<ul class="pattern-ranking">${activities.map((a) => html`<li><button class="pattern-link" data-query="${a.name}" data-tooltip="Find records containing ${a.name}"><span>${a.name}</span><b>${a.count}×</b></button><span class="meta">${a.spent} ${words().plural} spent · ${a.recovery} recovery ${words().plural}</span></li>`)}</ul>` : html`<p class="empty">Activities you log will appear here. Historical costs stay as recorded.</p>`}</article>
      <article class="insight-card"><span class="label">Activity balance</span><h3>${m.recovery} recovery ${words().plural} recorded</h3><p class="meta">${m.spent} ${words().plural} spent on activities; ${m.recovery} recorded through negative-cost recovery entries.</p><p class="hint">These are your planning estimates. They don't measure physical recovery or tell you to do more.</p></article>
    </div>`,
    );
  }

  return {
    render,
    show() {
      render();
    },
  };
}
