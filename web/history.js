// History: a calendar and one selected day, with records, patterns and sharing available when wanted.

import { energyAmount, energyWords, themeOf } from "./energy-theme.js";
import { $, html, setHTML, fmtDay, fmtWhen, fmtLongDay } from "./util.js";
import {
  listDays,
  listEpisodes,
  used,
  capOf,
  daysCsv,
  episodesCsv,
  activitiesCsv,
  summary,
} from "./model.js";

import { historyRange, historyInsights, HISTORY_RANGES } from "./history-model.js";
import { chartMarkup, connectCharts } from "./history-charts.js";
import { normaliseProfile } from "./profile.js";
import { initMatrix } from "./history-matrix.js";
import { savedCount, savedText } from "./view-state.js";

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
  const exportFile = (...args) => {
    download(...args);
    ctx.measure("export_created");
  };
  const words = () => energyWords(themeOf(ctx));
  const saved = ctx.ui?.get("history") || {};
  let shown = savedCount(saved.shown, PAGE),
    episodesShown = savedCount(saved.episodesShown, PAGE),
    rangeMode = "30",
    initialised = false,
    rangeToday = ctx.today(),
    chartWindow = savedText(saved.chartWindow),
    currentData;
  let restoredCharts = (Array.isArray(saved.charts) ? saved.charts : []).filter(
    (row) =>
      Array.isArray(row) &&
      ["energy", "episodes", "combined"].includes(row[0]) &&
      /^\d{1,2}$/.test(String(row[1])) &&
      Number(row[1]) < 60,
  );
  let restoredSymptom = savedText(saved.filters?.symptom);
  let previousSelection = saved.previousSelection || null;
  const returnButton = document.createElement("button");
  returnButton.type = "button";
  returnButton.className = "secondary";
  returnButton.id = "history-return-period";
  returnButton.textContent = "Return to previous period";
  $("history-matrix").before(returnButton);
  returnButton.hidden = !previousSelection;
  // The same way back where the person is working: the Prepare panel can be far below the first copy.
  const returnCopy = returnButton.cloneNode(true);
  returnCopy.id = "history-return-period-2";
  returnCopy.hidden = !previousSelection;
  $("history-share").querySelector("summary")?.after(returnCopy);
  returnCopy.addEventListener("click", () => returnButton.click());
  returnButton.addEventListener("click", () => {
    if (!previousSelection) return;
    const prior = previousSelection;
    previousSelection = null;
    rangeMode = prior.rangeMode;
    for (const [key, id] of Object.entries({
      from: "hist-from",
      to: "hist-to",
      status: "hist-status",
      symptom: "hist-symptom",
      query: "hist-query",
    }))
      $(id).value = prior.filters[key] || "";
    $("hist-ongoing").checked = prior.filters.ongoing === true;
    shown = prior.shown;
    episodesShown = prior.episodesShown;
    matrix.restoreSelection(prior.matrix);
    render();
    window.scrollTo(0, prior.scroll || 0);
  });
  const matrix = initMatrix($("history-matrix"), ctx, (date, share = false) => {
    if (!previousSelection)
      previousSelection = {
        rangeMode,
        filters: filters(),
        shown,
        episodesShown,
        matrix: matrix.snapshot(),
        scroll: window.scrollY,
      };
    $("hist-from").value = $("hist-to").value = date;
    rangeMode = "custom";
    shown = episodesShown = PAGE;
    openFilters();
    render();
    $("history-records").open = true;
    $("eps").scrollIntoView({ block: "start" });
    $("hist-from").focus({ preventScroll: true });
    if (share) $("history-prepare").click();
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
  $("history-range").addEventListener("change", (e) => {
    initialised = true;
    setRange(e.target.value);
    render();
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
  for (const [name, id] of Object.entries({
    from: "hist-from",
    to: "hist-to",
    status: "hist-status",
    query: "hist-query",
  }))
    $(id).value = savedText(saved.filters?.[name]);
  $("hist-ongoing").checked = saved.filters?.ongoing === true;
  if (saved.rangeMode === "custom" || HISTORY_RANGES.some(([key]) => key === saved.rangeMode)) {
    rangeMode = saved.rangeMode;
    initialised = true;
    if (rangeMode !== "custom") {
      const dates = historyRange(ctx.store.all(), ctx.today(), rangeMode);
      $("hist-from").value = rangeMode === "all" ? "" : dates.from;
      $("hist-to").value = rangeMode === "all" ? "" : dates.to;
    }
  }
  const selectedDocs = () => {
    return Object.fromEntries([
      ...(currentData?.days || []).map((d) => ["d-" + d.date, d]),
      ...(currentData?.episodes || []),
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
  const flushSearch = () => {
    if (searchTimer !== null) renderNow();
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
  $("history-filters").addEventListener("reset", (e) => {
    e.preventDefault();
    // Clearing a search does not silently change the selected period or custom dates.
    for (const id of ["hist-query", "hist-status", "hist-symptom"]) $(id).value = "";
    $("hist-ongoing").checked = false;
    shown = episodesShown = PAGE;
    renderNow();
  });
  $("history-prepare").addEventListener("click", () => {
    flushSearch();
    $("history-share").open = true;
    $("summary-preview").hidden = false;
    updatePreview();
    $("history-share").scrollIntoView({ block: "start" });
    $("history-share").querySelector("h2").focus({ preventScroll: true });
  });
  $("more-eps").addEventListener("click", () => {
    episodesShown += PAGE;
    render();
  });
  function updatePreview() {
    renderSummary();
    $("summary-preview").innerHTML = $("print-view").innerHTML;
    $("sum-preview").textContent = $("summary-preview").hidden ? "Preview summary" : "Hide preview";
    $("sum-preview").setAttribute("aria-expanded", !$("summary-preview").hidden);
  }
  $("sum-preview").addEventListener("click", () => {
    flushSearch();
    $("summary-preview").hidden = !$("summary-preview").hidden;
    updatePreview();
  });
  for (const id of ["sum-focus", "sum-notes", "sum-activities"])
    $(id).addEventListener("change", () => {
      render();
      if (!$("summary-preview").hidden) updatePreview();
    });
  for (const [name, id] of [
    ["notes", "sum-notes"],
    ["focus", "sum-focus"],
    ["activities", "sum-activities"],
  ])
    if (typeof saved.summary?.[name] === "boolean") $(id).checked = saved.summary[name];
  $("summary-preview").hidden = saved.summary?.preview !== true;

  $("more-days").addEventListener("click", () => {
    shown += PAGE;
    render();
  });
  $("days").addEventListener("click", (e) => {
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

  $("csv-days").addEventListener("click", () => {
    flushSearch();
    exportFile(
      `jiggered-days-${ctx.today()}.csv`,
      daysCsv(selectedDocs(), ctx.settings()),
      "text/csv;charset=utf-8",
    );
  });
  $("csv-activities").addEventListener("click", () => {
    flushSearch();
    exportFile(
      `jiggered-activities-${ctx.today()}.csv`,
      activitiesCsv(selectedDocs()),
      "text/csv;charset=utf-8",
    );
  });
  $("csv-eps").addEventListener("click", () => {
    flushSearch();
    exportFile(
      `jiggered-episodes-${ctx.today()}.csv`,
      episodesCsv(selectedDocs(), { includeNotes: $("sum-notes").checked }),
      "text/csv;charset=utf-8",
    );
  });
  $("sum-print").addEventListener("click", () => {
    flushSearch();
    renderSummary();
    document.body.classList.add("printing");
    window.addEventListener("afterprint", () => document.body.classList.remove("printing"), {
      once: true,
    });
    ctx.measure("print_requested");
    window.print();
  });

  function renderSummary() {
    const S = ctx.settings(),
      L = S.locale;
    if (!currentData || currentData.error) {
      setHTML(
        $("print-view"),
        html`<p>${currentData?.error || "Choose a period to prepare your summary."}</p>`,
      );
      return;
    }
    const sm = summary(
      selectedDocs(),
      S,
      { ...filters(), from: currentData.from, to: currentData.to },
      ctx.today(),
    );
    const label = HISTORY_RANGES.find(([v]) => v === rangeMode)?.[1] || "Custom dates";
    const active = activeFilters();
    const list = (pairs) =>
      pairs.length ? pairs.map(([n, c]) => `${n} (${c})`).join(", ") : "none recorded";
    // "Most often" only means something for things that happened more than once.
    const often = (pairs) => pairs.filter(([, c]) => c >= 2);
    const oftenLine = (pairs, label, once) =>
      often(pairs).length
        ? `${label} ${list(often(pairs))}.`
        : pairs.length
          ? `${once} ${list(pairs)}.`
          : `${label} none recorded.`;
    setHTML(
      $("print-view"),
      html`
      <h1>Jiggered summary</h1>
      <p>${label}: ${fmtLongDay(sm.from, L)} to ${fmtLongDay(sm.to, L)}. Printed ${fmtLongDay(ctx.today(), L)}.</p>
      ${active.length ? html`<p><b>Filters:</b> ${active.join(" · ")}. Check-in filters apply to days; symptom and ongoing filters apply to episodes.</p>` : ""}
      ${focus() && $("sum-focus").checked ? html`<p><b>What I'm tracking:</b> ${focus()}</p>` : ""}
      <h2>Check-ins</h2>
      <p>${plural(sm.days.filter((d) => d.status).length, "day")} with a check-in: ${sm.green} green, ${sm.amber} amber, ${sm.red} red.
        ${sm.avgUsed === null ? "" : `On the ${plural(sm.activityDays, "day")} with activities, the average net ${words().plural} were ${sm.avgUsed} (activities minus recovery; days with only a check-in are not counted).`}
        ${sm.poorSleepDays ? `Poor sleep was recorded on ${plural(sm.poorSleepDays, "day")}.` : ""}</p>
      <h2>Episodes (${sm.episodes.length})</h2>
      ${
        sm.episodes.length
          ? html`
        <p>${oftenLine(sm.topSymptoms, "Most often noticed:", "Each noticed once:")}</p>
        <p>${oftenLine(sm.topTriggers, "Most often in the day or two before:", "Each recorded once in the day or two before:")}</p>
        <table><thead><tr><th>Started</th><th>What was noticed</th><th>How it came on</th><th>Approximate duration</th><th>Ended (local)</th><th>Before</th><th>Notes</th></tr></thead><tbody>
        ${sm.episodes.map((e) => html`<tr><td data-label="Started">${fmtWhen(e.when, L)}</td><td data-label="What was noticed">${(e.symptoms || []).join(", ")}</td><td data-label="How it came on">${e.onset || ""}</td><td data-label="Approximate duration">${e.duration || ""}</td><td data-label="Ended (local)">${e.endedAt ? fmtWhen(e.endedAt, L) : "Not recorded"}</td><td data-label="Before">${(e.before || []).join(", ")}</td><td data-label="Notes">${$("sum-notes").checked ? e.notes || "" : "Omitted"}</td></tr>`)}
        </tbody></table>`
          : html`<p>None logged in this period.</p>`
      }
      <h2>Days</h2>
      ${
        sm.days.length
          ? html`<table><thead><tr><th>Day</th><th>Check-in</th><th>Net ${words().plural} used</th><th>Poor sleep</th></tr></thead><tbody>
        ${sm.days.map((d) => html`<tr><td data-label="Day">${fmtDay(d.date, L)}</td><td data-label="Check-in">${d.status ? d.status[0].toUpperCase() + d.status.slice(1) : "none"}</td><td data-label="Net ${words().plural} used">${d.entries.length ? `${used(d)} of ${capOf(d, S)}` : "No activity log"}</td><td data-label="Poor sleep">${d.poorSleep ? "yes" : ""}</td></tr>`)}
        </tbody></table>`
          : html`<p>No days logged in this period.</p>`
      }
      ${$("sum-activities").checked ? html`<h2>Activities</h2><table><thead><tr><th>Day</th><th>Local time</th><th>Activity</th><th>Effect on your balance</th></tr></thead><tbody>${sm.days.flatMap((d) => d.entries.map((e) => html`<tr><td data-label="Day">${fmtDay(d.date, L)}</td><td data-label="Local time">${e.t || "Not recorded"}</td><td data-label="Activity">${e.a}</td><td data-label="Effect on your balance">${e.c > 0 ? `Used ${energyAmount(e.c, themeOf(ctx))}` : e.c < 0 ? `Recovered ${energyAmount(-e.c, themeOf(ctx))}` : "No change"}</td></tr>`))}</tbody></table>` : ""}
      <p class="small-print">Green, amber and red are the person's own rating of their energy at the start of the day (green is good, red is low). ${words().title} are the person's own daily energy budget, not a medical measure; net used is the energy spent minus the energy recovered. Times are local as recorded; CSV includes any recorded time-zone offsets. Older records may have none. This is a personal log kept by the person it belongs to. It is not a medical record or a medical device.</p>`,
    );
  }

  const focus = () => normaliseProfile(ctx.store.view("settings")?.profile).focus;
  let lastActive = "";
  const activeFilters = () =>
    [
      filters().status && `check-in: ${filters().status}`,
      filters().symptom && `symptom: ${filters().symptom}`,
      filters().ongoing && "ongoing only",
      filters().query.trim() && `“${filters().query.trim()}”`,
    ].filter(Boolean);

  // Charts are drawn narrower on a phone so their labels keep a readable size; turning the phone redraws them.
  const narrowCharts = matchMedia("(max-width:700px)");
  narrowCharts.addEventListener("change", () => {
    if (!$("history-panel").hidden) render();
  });
  function render() {
    returnButton.hidden = returnCopy.hidden = !previousSelection;
    const S = ctx.settings(),
      L = S.locale,
      docs = ctx.store.all(),
      today = ctx.today();
    const f = focus();
    $("history-lens").hidden = !f;
    $("history-lens").textContent = f
      ? `You wanted to notice: “${f}”`
      : "Look back, one day at a time.";
    $("sum-focus-row").hidden = !f;
    $("sum-focus-text").textContent = f ? `“${f}”` : "";
    if (!initialised && ctx.store.status().loaded) {
      initialised = true;
      setRange(normaliseProfile(ctx.store.view("settings")?.profile).historyRange);
    }
    if (rangeMode !== "custom" && rangeToday !== today) setRange(rangeMode);
    $("hist-from").max = $("hist-to").max = today;
    $("history-range").value = rangeMode;
    const symptom = restoredSymptom || $("hist-symptom").value,
      options = [...new Set([...S.symptoms, ...listEpisodes(docs).flatMap(([, e]) => e.symptoms)])];
    setHTML(
      $("hist-symptom"),
      html`<option value="">Any</option>${options.map((name) => html`<option value="${name}">${name}</option>`)}`,
    );
    $("hist-symptom").value = symptom;
    if ($("hist-symptom").selectedIndex < 0) $("hist-symptom").value = "";
    restoredSymptom = "";
    const data = historyInsights(docs, S, today, filters());
    currentData = data;
    const days = data.days || [],
      eps = data.episodes || [];
    const active = [...activeFilters(), ...(rangeMode === "custom" ? ["custom dates"] : [])];
    $("history-filter-summary").textContent = active.length ? active.join(" · ") : "None";
    // A newly applied filter is never hidden. Dates alone are shown by the Period selector, so they don't open the panel.
    if (active.join() !== lastActive && activeFilters().length)
      $("history-filter-panel").open = true;
    lastActive = active.join();
    $("history-count").textContent =
      filters().from && filters().to && filters().from > filters().to
        ? "Choose an end date on or after the start date."
        : `${plural(days.length, "day")} and ${plural(eps.length, "episode")} match. Check-in filters apply to days; symptom/ongoing filters apply to episodes.`;
    for (const id of [
      "history-prepare",
      "sum-preview",
      "sum-print",
      "csv-days",
      "csv-eps",
      "csv-activities",
    ])
      $(id).disabled =
        !!data.error ||
        (id === "csv-days"
          ? !days.length
          : id === "csv-eps"
            ? !eps.length
            : id === "csv-activities"
              ? !days.some((d) => d.entries.length)
              : !days.length && !eps.length);
    // A disabled button that does not say why reads as broken.
    $("history-prepare-why").textContent = data.error
      ? "Fix the dates first."
      : !days.length && !eps.length
        ? active.length
          ? "Nothing matches these filters yet."
          : "Nothing to summarise yet. Log a check-in first."
        : "";
    $("sharing-counts").textContent =
      `${plural(days.length, "day")} · ${plural(eps.length, "episode")} · private notes ${$("sum-notes").checked ? "included" : "omitted"}. ${!days.length && !eps.length ? "No matching records: clear search and filters or change the period above." : "Empty record types cannot be exported."}`;
    $("summary-period").textContent =
      data.error ||
      `${fmtDay(data.from, L)} – ${fmtDay(data.to, L)} · ${plural(days.length, "day")} · ${plural(eps.length, "episode")}${active.length ? " · filters active" : ""}`;
    $("history-record-count").textContent =
      `${plural(days.length, "day")} · ${plural(eps.length, "episode")}`;
    $("history-explore").hidden = !!data.error;
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
        <div class="metric"><span class="label">Episodes recorded</span><b>${m.episodes}</b><span class="meta">${m.episodes} recorded versus ${p.episodes} previously. ${p.checked < 3 ? "Previous period has limited check-in records." : `${m.checked}/${data.span} check-in days now; ${p.checked}/${data.span} previously.`}</span></div>
        <div class="metric"><span class="label">Past the allowance</span><b>${m.overBudget}<small> / ${m.logged}</small></b><span class="meta">Days with activities logged</span></div>
      </div>
      <p class="energy-report">${m.logged ? `${m.spent} ${words().plural} used before recovery · ${m.recovery} recovered · ${m.spent - m.recovery} net across ${plural(m.logged, "activity day")}.` : "No activities recorded in this period."} Totals cover matching records only.</p>
      <div class="checkin-summary"><h3>Morning check-ins</h3><svg class="checkin-composition" viewBox="0 0 600 18" preserveAspectRatio="none" role="img" aria-label="${m.green} green, ${m.amber} amber, ${m.red} red, ${data.span - m.checked} days without a matching check-in"><rect class="composition-empty" width="600" height="18" rx="7"></rect>${["green", "amber", "red"].map((key, i, keys) => html`<rect class="composition-${key}" x="${(keys.slice(0, i).reduce((n, k) => n + m[k], 0) / data.span) * 600}" width="${(m[key] / data.span) * 600}" height="18"></rect>`)}</svg><div class="chart-legend">${["green", "amber", "red"].map((key) => html`<span><i class="legend-${key}"></i>${m[key]} ${key}</span>`)}<span>${data.span - m.checked} ${hasFilters ? "without a matching check-in" : "without a check-in"}</span></div></div>
      <p class="hint comparison-note">${comparison} Previous period: ${fmtDay(data.previousFrom, L)} – ${fmtDay(data.previousTo, L)}. Counts reflect your logging, including any filters.</p>`,
      );
      matrix.render({ ...data, filtered: hasFilters }, S);
      const nextChartWindow = `${data.from}:${data.to}`;
      const remembered =
        chartWindow === nextChartWindow
          ? restoredCharts.length
            ? restoredCharts
            : [...$("history-charts").querySelectorAll("[data-chart]")].map((card) => [
                card.dataset.chart,
                card.querySelector("[data-inspect]").value,
              ])
          : [];
      chartWindow = nextChartWindow;
      restoredCharts = [];
      ctx.ui?.details($("history-charts"));
      setHTML(
        $("history-charts"),
        html`${chartMarkup(data, "energy", L, themeOf(ctx), narrowCharts.matches)}${chartMarkup(data, "episodes", L, themeOf(ctx), narrowCharts.matches)}${chartMarkup(data, "combined", L, themeOf(ctx), narrowCharts.matches)}`,
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
      ctx.ui?.details($("history-charts"), true);
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
      html`${days.slice(0, shown).map((d) => html`<li><button class="dayrow" data-day="${d.date}"><span><span class="dot ${d.status || ""}"></span>${fmtDay(d.date, L)}${d.poorSleep ? html` <span class="meta">· poor sleep</span>` : ""}<span class="meta"> · ${d.status || "no check-in"}</span></span><span class="meta">${d.entries.length ? `${used(d)} of ${capOf(d, S)} ${words().plural} used` : "No activities logged"}</span></button></li>`)}`,
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
      ? "No episodes match this period and filters. Try a wider period or clear search and filters."
      : "No episodes logged. Use Episode if one happens.";
    $("nodays").textContent = listDays(docs).length
      ? "No days match this period and filters. Try a wider period or clear search and filters."
      : "Your days appear here after a check-in or activity.";
    if (!$("summary-preview").hidden) updatePreview();
  }

  function renderPatterns(data, locale) {
    const { metrics: m, sleep, weekdays, activities } = data;
    // With almost nothing to go on, a short note replaces the cards that would otherwise push the records far down.
    if (m.checked < 3 && m.logged < 3 && m.episodes < 3) {
      setHTML(
        $("history-insights"),
        html`<p class="empty">Patterns need at least a few check-ins, activity days or episodes in this view. Keep recording what matters to you, then return here when you want a closer look.</p>`,
      );
      return;
    }
    // Small groups make big-looking percentages out of chance, so the cards wait for more days and lead with the counts.
    const enoughSleep = sleep.poor.n >= 5 && sleep.other.n >= 5;
    const allWeekdays = weekdays.length === 7 && weekdays.every((w) => w.checked >= 4);
    const enoughWeekdays = weekdays.filter((w) => w.checked >= 4).length;
    const dayName = (w) =>
      new Date(Date.UTC(2024, 0, 7 + w.index)).toLocaleDateString(locale || undefined, {
        weekday: "long",
        timeZone: "UTC",
      });
    const noticed = data.topSymptoms.filter(([, count]) => count >= 2),
      beforehand = data.topTriggers.filter(([, count]) => count >= 2);
    const ranking = (pairs, type) =>
      pairs.length
        ? html`<ul class="pattern-ranking">${pairs.map(([name, count]) => html`<li><button class="pattern-link" ${type === "symptom" ? html`data-symptom="${name}"` : html`data-query="${name}"`} data-tooltip="Filter history by ${name}"><span>${name}</span><b>${count}</b></button><meter min="0" max="${Math.max(1, m.episodes)}" value="${count}" aria-label="${name}: recorded in ${count} of ${m.episodes} episodes"></meter></li>`)}</ul>`
        : html`<p class="empty">No matching episode details recorded in this period.</p>`;
    setHTML(
      $("history-insights"),
      html`<p class="hint insights-note">Descriptions of your log, rather than explanations of why symptoms happen. Missing days and changes in logging affect the picture.</p><div class="patterns-grid">
      <article class="insight-card"><span class="label">Sleep &amp; check-ins</span><h3>${enoughSleep ? `${sleep.poor.bad} of ${sleep.poor.n} poor-sleep days were amber or red` : "Build a clearer sleep picture"}</h3><p class="meta">${enoughSleep ? `Compared with ${sleep.other.bad} of ${sleep.other.n} checked-in days when sleep wasn't marked poor (${sleep.poor.percent}% against ${sleep.other.percent}%).` : `This comparison needs at least 5 checked-in days in each group. You have ${sleep.poor.n} marked poor sleep and ${sleep.other.n} not marked poor sleep.`}</p><p class="hint">A missing poor-sleep flag doesn't necessarily mean good sleep.</p></article>
      <article class="insight-card"><span class="label">Day of the week</span><h3>${allWeekdays ? "Amber or red days, by weekday" : "A little more history helps"}</h3>${allWeekdays ? html`<ul class="pattern-ranking">${weekdays.map((w) => html`<li><span class="pattern-row"><span>${dayName(w)}</span><b>${w.bad} of ${w.checked}</b></span><meter min="0" max="${w.checked}" value="${w.bad}" aria-label="${dayName(w)}: amber or red on ${w.bad} of ${w.checked} checked-in days"></meter></li>`)}</ul><p class="hint">With this few days each, a higher weekday is often chance.</p>` : html`<p class="meta">Weekdays are compared once each has at least 4 check-ins (${enoughWeekdays} of 7 so far).</p>`}</article>
      <article class="insight-card"><span class="label">Most noticed</span><h3>${noticed.length || !data.topSymptoms.length ? "Symptoms in your episodes" : "Recorded once"}</h3>${ranking(noticed.length ? noticed : data.topSymptoms, "symptom")}<p class="hint">Each symptom counts once per episode. Tap to filter.</p></article>
      <article class="insight-card"><span class="label">Recorded beforehand</span><h3>${beforehand.length || !data.topTriggers.length ? "In the day or two before" : "Recorded once, in the day or two before"}</h3>${ranking(beforehand.length ? beforehand : data.topTriggers, "query")}<p class="hint">What you recorded before episodes; this doesn't establish a cause.</p></article>
      <article class="insight-card activity-patterns"><span class="label">Your everyday rhythm</span><h3>Most logged activities</h3>${activities.length ? html`<ul class="pattern-ranking">${activities.map((a) => html`<li><button class="pattern-link" data-query="${a.name}" data-tooltip="Find records containing ${a.name}"><span>${a.name}</span><b>${a.count}×</b></button><span class="meta">${a.spent} ${words().plural} spent · ${a.recovery} recovery ${words().plural}</span></li>`)}</ul>` : html`<p class="empty">Activities you log will appear here. Historical costs stay as recorded.</p>`}</article>
      <article class="insight-card"><span class="label">Activity balance</span><h3>${m.recovery} recovery ${words().plural} recorded</h3><p class="meta">${m.spent} ${words().plural} spent on activities; ${m.recovery} recorded through negative-cost recovery entries.</p><p class="hint">These are your planning estimates. They don't measure physical recovery or tell you to do more.</p></article>
    </div>`,
    );
  }

  return {
    render,
    snapshot: () => ({
      rangeMode,
      filters: filters(),
      shown,
      episodesShown,
      chartWindow,
      charts: [...$("history-charts").querySelectorAll("[data-chart]")].map((card) => [
        card.dataset.chart,
        card.querySelector("[data-inspect]").value,
      ]),
      previousSelection,
      matrix: matrix.snapshot(),
      summary: {
        activities: $("sum-activities").checked,
        notes: $("sum-notes").checked,
        focus: $("sum-focus").checked,
        preview: !$("summary-preview").hidden,
      },
    }),
    openPeriod(from, to) {
      $("hist-from").value = from;
      $("hist-to").value = to;
      $("hist-query").value = $("hist-status").value = $("hist-symptom").value = "";
      $("hist-ongoing").checked = false;
      rangeMode = "custom";
      initialised = true;
      shown = episodesShown = PAGE;
      render();
      $("history-matrix").scrollIntoView({ block: "start" }); // the calendar, not a form of date boxes
    },
    show() {
      ctx.measure("history_viewed");
      render();
    },
  };
}
