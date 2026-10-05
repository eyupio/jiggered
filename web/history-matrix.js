// A bounded calendar, inspired by the activity view: one tab stop, energy and symptom colour modes, pinned day details.
import { planComparison } from "./planner-model.js";
import { energyWords, themeOf } from "./energy-theme.js";
import { html, setHTML, fmtDay, fmtWhen } from "./util.js";
import { addDays, used, capOf, isDayId, isEpisodeId } from "./model.js";
import { validDate } from "./history-model.js";
import { slotText } from "./calendar-model.js";

export function calendarWindow(data, S, end = data.to, limit = 366) {
  end = end < data.from ? data.from : end > data.to ? data.to : end;
  const from = addDays(end, 1 - limit) < data.from ? data.from : addDays(end, 1 - limit);
  const days = new Map(data.days.map((d) => [d.date, d])),
    counts = new Map();
  for (const record of data.episodes) {
    const date = record[1].when.slice(0, 10);
    if (!counts.has(date)) counts.set(date, []);
    counts.get(date).push(record);
  }
  const cells = [];
  for (let date = from; date <= end; date = addDays(date, 1)) {
    const day = days.get(date),
      activity = !!day?.entries.length;
    cells.push({
      date,
      status: day?.status || null,
      logged: !!day,
      activity,
      poorSleep: !!day?.poorSleep,
      spent: activity ? day.entries.reduce((n, e) => n + Math.max(0, e.c), 0) : null,
      net: activity ? used(day) : null,
      allowance: day ? capOf(day, S) : null,
      episodes: counts.get(date)?.length || 0,
      day,
      episodeRecords: counts.get(date) || [],
    });
  }
  const offset = (new Date(from + "T12:00:00Z").getUTCDay() + 6) % 7;
  return { from, to: end, offset, cells, weeks: Math.ceil((offset + cells.length) / 7) };
}
export function describeCalendarDay(c, locale, theme = "points") {
  return `${fmtDay(c.date, locale)}. ${c.status ? c.status + " check-in" : "No matching check-in"}. ${c.net === null ? "No activities logged" : `${c.spent === undefined ? "" : `${c.spent} ${energyWords(theme).plural} used before recovery; `}${c.net} net ${energyWords(theme).plural} used, ${c.allowance} available`}. ${c.poorSleep ? "Sleep marked poor" : "Sleep not marked poor"}. ${c.episodes} matching ${c.episodes === 1 ? "episode" : "episodes"} recorded.`;
}
// How a period's days are laid out so they fill their panel. A week or less is a list of rows, a few weeks a calendar
// (Monday to Sunday across, a row per week) and anything longer a heatmap with a column per week. A phone keeps the
// heatmap past a week: seven columns would make each day narrower than a thumb.
export function matrixLayout(days, weeks, compact = false) {
  if (days <= 7) return "list";
  return !compact && weeks <= 10 ? "calendar" : "heatmap";
}
// The same keys move by the same step on screen: down the column in a list or heatmap, along the row in a calendar.
const STEPS = {
  list: { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -1, ArrowRight: 1 },
  heatmap: { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 },
  calendar: { ArrowUp: -7, ArrowDown: 7, ArrowLeft: -1, ArrowRight: 1 },
};
// One line for a day's row in the list; the button's accessible name carries the full sentence.
export function summariseCalendarDay(c, theme = "points") {
  if (!c.logged && !c.episodes) return "Nothing recorded";
  return [
    c.status ? `${c.status[0].toUpperCase()}${c.status.slice(1)} check-in` : "No check-in",
    c.net === null
      ? "No activities"
      : `${c.net} of ${c.allowance} ${energyWords(theme).plural} used`,
    c.poorSleep && "Poor sleep",
    c.episodes && `${c.episodes} ${c.episodes === 1 ? "episode" : "episodes"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}
export function calendarPaint(c, mode) {
  if (mode === "checkin") return [c.status || "empty", c.status ? c.status[0].toUpperCase() : "–"];
  if (mode === "sleep") return [c.poorSleep ? "amber" : "empty", c.poorSleep ? "!" : "–"];
  if (mode === "episodes")
    return [c.episodes ? "level-" + Math.min(4, c.episodes) : "empty", c.episodes || "–"];
  if (mode === "used")
    return c.spent === null
      ? ["empty", "–"]
      : ["level-" + Math.min(4, Math.max(1, Math.ceil(c.spent / 3))), c.spent];
  if (mode === "remaining") {
    if (c.net === null || c.allowance === null) return ["empty", "–"];
    const remaining = c.allowance - c.net;
    return [remaining < 0 ? "red" : remaining <= 3 ? "amber" : "green", remaining];
  }
  if (c.net === null) return ["empty", "–"];
  return [
    c.net < 0 ? "recovery" : "level-" + Math.min(4, Math.max(1, Math.ceil(c.net / 3))),
    c.net < 0 ? "−" : c.net,
  ];
}
export function initMatrix(root, ctx, explore) {
  const saved = ctx.ui?.get("history").matrix || {};
  let data,
    S,
    win,
    mode = ["checkin", "remaining", "used", "points", "sleep", "episodes"].includes(saved.mode)
      ? saved.mode
      : "checkin",
    end = validDate(saved.end) ? saved.end : null,
    chosen = validDate(saved.chosen) ? saved.chosen : null,
    cursor = 0,
    signature = saved.signature;
  let expanded = saved.expanded === true;
  let cursorDate = validDate(saved.cursorDate) ? saved.cursorDate : null;
  const compact = matchMedia("(max-width:700px)"),
    limit = () => 366;
  setHTML(
    root,
    html`<section class="panel matrix-overview" aria-labelledby="matrix-title">
      <div class="matrix-head"><div class="matrix-title"><h2 id="matrix-title">Your days at a glance</h2><p class="hint" data-matrix-hint>Select a day to see what you recorded.</p></div><label class="field matrix-mode">Colour by<select data-matrix-mode><option value="checkin">Morning check-in</option><option value="episodes">Episodes recorded</option><option value="remaining" data-energy-copy="Points remaining">Points remaining</option><option value="used" data-energy-copy="Activity points used">Activity points used</option><option value="points" data-energy-copy="Net activity points">Net activity points</option><option value="sleep">Poor sleep marked</option></select></label></div>
      <div class="matrix-period" data-matrix-bar hidden><span class="meta" data-matrix-period></span><div class="row"><button class="secondary small" data-matrix-earlier>Earlier days</button><button class="secondary small" data-matrix-later>Later days</button></div></div>
      <div class="matrix-body"><div class="matrix-calendar" data-matrix-calendar><div class="matrix-months" data-matrix-months aria-hidden="true"></div><div class="matrix-weekdays" data-matrix-weekdays aria-hidden="true"></div><div class="matrix-grid" data-matrix-grid role="group" aria-label="Daily calendar. Arrow keys move between days; Enter selects; Escape clears selection."></div></div>
      <div class="chart-legend matrix-legend" data-matrix-legend></div></div>
      <div class="matrix-foot"><div class="matrix-facts" data-matrix-facts></div><label class="field matrix-day">Choose a day<select data-matrix-day></select></label></div>
    </section>
    <aside class="panel matrix-reading" data-matrix-reading aria-label="Selected day"></aside>`,
  );
  const get = (selector) => root.querySelector(selector),
    grid = get("[data-matrix-grid]");
  get("[data-matrix-mode]").value = mode;
  function detail(index, select = false) {
    const c = win.cells[index];
    cursor = index;
    cursorDate = c.date;
    if (select) chosen = c.date;
    get("[data-matrix-day]").value = String(index);
    for (const b of grid.querySelectorAll("button")) {
      b.tabIndex = Number(b.dataset.cell) === cursor ? 0 : -1;
      b.setAttribute("aria-pressed", b.dataset.date === chosen);
    }
    const words = energyWords(themeOf(ctx)),
      day = c.day,
      entries = day?.entries || [],
      remaining = c.net === null || c.allowance === null ? null : c.allowance - c.net;
    const comparison = planComparison(ctx.store.all(), c.date);
    setHTML(
      get("[data-matrix-reading]"),
      html`<div class="matrix-day-heading"><div><span class="label">${chosen === c.date ? "Selected day" : "Day detail"}</span><h3>${fmtDay(c.date, S.locale)}</h3></div><div class="row"><button class="secondary small" data-matrix-prev aria-label="Previous day" ${index === 0 ? html`disabled` : ""}>←</button><button class="secondary small" data-matrix-next aria-label="Next day" ${index === win.cells.length - 1 ? html`disabled` : ""}>→</button></div></div>
      <dl><div><dt>Morning check-in</dt><dd><span class="dot ${c.status || ""}"></span>${c.status || "No matching check-in"}</dd></div><div><dt>Sleep</dt><dd>${!day ? "No matching day log" : c.poorSleep ? "Marked poor" : "Not marked poor"}</dd></div><div><dt>Episodes</dt><dd>${c.episodes} recorded</dd></div></dl>
      ${day ? html`<div class="matrix-balance"><span class="label">${words.title} remaining</span><b>${remaining === null ? "—" : remaining}</b><span class="meta">${entries.length ? `${c.net} net used of ${c.allowance} available` : `${c.allowance} available · no activities logged`}</span></div>` : html`<p class="empty">No matching day log. Review this day to see or add records.</p>`}
      ${entries.length ? html`<div><h4>Activities</h4><ul class="matrix-activities">${entries.slice(0, expanded ? entries.length : 5).map((e) => html`<li><span>${e.a}${slotText(e) ? html`<time class="meta">${slotText(e)}</time>` : ""}</span><b class="${e.c < 0 ? "recovery" : ""}">${e.c > 0 ? "−" + e.c : e.c < 0 ? "+" + Math.abs(e.c) : "0"}<span class="sr-only"> ${words.plural} ${e.c < 0 ? "recovered" : "used"}</span></b></li>`)}</ul>${!expanded && entries.length > 5 ? html`<p class="hint">Showing 5 of ${entries.length} activities. Choose Show all records below for the full log.</p>` : ""}</div>` : ""}
      ${c.episodes ? html`<div><h4>Episodes</h4><ul class="matrix-episodes">${c.episodeRecords.slice(0, expanded ? c.episodes : 3).map(([id, e]) => html`<li><button class="x" data-matrix-edit="${id}"><span>${e.symptoms.join(", ") || "No symptoms ticked"}<span class="meta">${fmtWhen(e.when, S.locale)}${e.duration === "Still going" && !e.endedAt ? " · ongoing" : ""}</span></span><span aria-hidden="true">→</span></button></li>`)}</ul>${!expanded && c.episodes > 3 ? html`<button class="x" data-matrix-episodes>View all ${c.episodes} episodes</button>` : ""}</div>` : ""}
      ${comparison ? html`<div class="plan-history"><div class="plan-history-head"><h4>Plan and actual</h4><button type="button" class="secondary" data-open-plan="${c.date}">Review this plan</button></div><p>${comparison.completed} of ${comparison.total} planned activities logged · ${comparison.estimated} net ${words.plural} estimated for completed activities · ${comparison.actual} actually used.</p><p class="hint">Unfinished plans are excluded from reported usage.</p></div>` : ""}
      ${day || c.episodes ? html`<div class="row"><button class="secondary" data-matrix-open>Edit day</button><button class="secondary" data-matrix-all>${expanded ? "Show fewer records" : "Show all records for this day"}</button><button class="primary" data-matrix-share>Share this day</button></div>` : html`<div class="row"><button class="primary" data-matrix-open>${c.date === ctx.today() ? "Log today" : "Log this day"}</button></div>`}`,
    );
  }
  function paint() {
    win = calendarWindow(data, S, end || data.to, limit());
    // An account with no days or episodes at all (not just an empty period) is told what this calendar will become.
    const firstRun = !Object.entries(ctx.store.all()).some(
      ([id, doc]) => doc && (isDayId(id) || isEpisodeId(id)),
    );
    get("[data-matrix-hint]").textContent = firstRun
      ? "Nothing logged yet. Each day you check in or record an activity fills in a square, so you can see how your days compare."
      : "Select a day to see what you recorded.";
    const layout = matrixLayout(win.cells.length, win.weeks, compact.matches),
      heatmap = layout === "heatmap";
    get("[data-matrix-calendar]").dataset.layout = layout;
    root.style.setProperty("--weeks", win.weeks);
    // Past this many columns a heatmap cell is too small to carry its number.
    root.classList.toggle("matrix-dense", heatmap && win.weeks > (compact.matches ? 13 : 16));
    const oldCursor = win.cells.findIndex((c) => c.date === (cursorDate || chosen));
    cursor =
      oldCursor >= 0
        ? oldCursor
        : (() => {
            const latest = win.cells.findLastIndex((c) => c.logged || c.episodes);
            return latest < 0 ? win.cells.length - 1 : latest;
          })();
    const theme = themeOf(ctx),
      format = (options) =>
        new Intl.DateTimeFormat(S.locale || undefined, { timeZone: "UTC", ...options }),
      weekday = format({ weekday: "short" }),
      monthName = format({ month: "short" }),
      noon = (date) => new Date(date + "T12:00:00Z"),
      dayOfMonth = (date) => Number(date.slice(8));
    // What each button shows beyond its colour: the whole day in a list row, the date in a calendar square, nothing
    // in a heatmap (its columns and the weekday letters say which day it is).
    const dayLabel = (c, i) =>
      layout === "list"
        ? html`<span class="matrix-when" aria-hidden="true"><b>${weekday.format(noon(c.date))}</b><span>${dayOfMonth(c.date)} ${monthName.format(noon(c.date))}</span></span>`
        : layout === "calendar"
          ? html`<span class="matrix-when" aria-hidden="true">${dayOfMonth(c.date)}${i === 0 || dayOfMonth(c.date) === 1 ? ` ${monthName.format(noon(c.date))}` : ""}</span>`
          : "";
    // A list needs no padding. A calendar's rows and a heatmap's columns are whole weeks, so they are completed with
    // empty squares rather than records invented outside the selected range.
    const padded = layout !== "list",
      blank = html`<span class="matrix-blank" aria-hidden="true"></span>`;
    setHTML(
      grid,
      html`${padded ? Array.from({ length: win.offset }, () => blank) : ""}${win.cells.map(
        (c, i) => {
          const [tone, mark] = calendarPaint(c, mode),
            description = describeCalendarDay(c, S.locale, theme);
          return html`<button type="button" class="matrix-cell ${tone}" data-cell="${i}" data-date="${c.date}" tabindex="${i === cursor ? 0 : -1}" aria-pressed="${c.date === chosen}" aria-label="${description}" ${layout === "list" ? "" : html`data-tooltip="${description}"`}>${dayLabel(c, i)}<span class="matrix-mark" aria-hidden="true">${mark}</span>${c.episodes && mode !== "episodes" ? html`<i class="matrix-ep" aria-hidden="true"></i>` : ""}${layout === "list" ? html`<span class="matrix-note" aria-hidden="true">${summariseCalendarDay(c, theme)}</span>` : ""}</button>`;
        },
      )}${padded ? Array.from({ length: win.weeks * 7 - win.offset - win.cells.length }, () => blank) : ""}`,
    );
    // Monday to Sunday, from the week of 1 January 2024 (a Monday).
    const letters = (style) => {
      const name = format({ weekday: style });
      return Array.from({ length: 7 }, (_, i) =>
        name.format(new Date(Date.UTC(2024, 0, 1 + i, 12))),
      );
    };
    setHTML(
      get("[data-matrix-weekdays]"),
      layout === "list"
        ? html``
        : html`${letters(layout === "calendar" ? "short" : "narrow").map((name) => html`<span>${name}</span>`)}`,
    );
    const month = (date) => format({ month: "short", year: "numeric" }).format(noon(date));
    setHTML(
      get("[data-matrix-months]"),
      heatmap
        ? html`<span>${month(win.from)}</span>${month(win.from) !== month(win.to) ? html`<span>${month(win.to)}</span>` : ""}`
        : html``,
    );
    get("[data-matrix-bar]").hidden = data.span <= limit();
    get("[data-matrix-period]").textContent =
      `${fmtDay(win.from, S.locale)} – ${fmtDay(win.to, S.locale)} · ${win.cells.length} of ${data.span} days. Use Earlier/Later for the rest.`;
    get("[data-matrix-earlier]").hidden = win.from === data.from;
    get("[data-matrix-later]").hidden = win.to === data.to;
    const legend =
      mode === "checkin"
        ? html`<span><i class="legend-green"></i>G · Green</span><span><i class="legend-amber"></i>A · Amber</span><span><i class="legend-red"></i>R · Red</span>`
        : mode === "remaining"
          ? html`<span><i class="legend-green"></i>More than 3 left</span><span><i class="legend-amber"></i>0–3 left</span><span><i class="legend-red"></i>Past allowance</span>`
          : mode === "sleep"
            ? html`<span><i class="legend-amber"></i>! · Sleep marked poor</span><span>Unmarked sleep is not necessarily good sleep</span>`
            : html`<span>Less</span>${[1, 2, 3, 4].map((level) => html`<i class="matrix-key level-${level}" aria-hidden="true"></i>`)}<span>More ${mode === "episodes" ? "recorded episodes" : `${mode === "used" ? "activity" : "net"} ${energyWords(themeOf(ctx)).plural} used`}</span>${mode === "points" ? html`<span><i class="legend-green"></i>− · Negative net ${energyWords(themeOf(ctx)).plural} / recovery</span>` : ""}`;
    setHTML(
      get("[data-matrix-legend]"),
      html`${legend}${mode === "episodes" ? "" : html`<span><i class="matrix-ep matrix-ep-key"></i>Episode recorded</span>`}<span><i></i>No matching record / unmarked</span>`,
    );
    setHTML(
      get("[data-matrix-day]"),
      html`${win.cells.map((c, i) => html`<option value="${i}">${fmtDay(c.date, S.locale)}</option>`)}`,
    );
    setHTML(
      get("[data-matrix-facts]"),
      html`<div><b>${data.metrics.checked}</b><span>Check-ins</span></div><div><b>${data.metrics.episodes}</b><span>Episodes</span></div><div><b>${data.metrics.poorSleep}</b><span>Poor-sleep days</span></div>`,
    );
    detail(cursor, !cursorDate);
  }
  get("[data-matrix-mode]").addEventListener("change", (e) => {
    mode = e.target.value;
    paint();
  });
  get("[data-matrix-day]").addEventListener("change", (e) => detail(Number(e.target.value), true));
  grid.addEventListener("click", (e) => {
    const b = e.target.closest("[data-cell]");
    if (b) detail(Number(b.dataset.cell), true);
  });
  grid.addEventListener("focusin", (e) => {
    const b = e.target.closest("[data-cell]");
    if (b) detail(Number(b.dataset.cell));
  });
  grid.addEventListener("keydown", (e) => {
    const changes = STEPS[get("[data-matrix-calendar]").dataset.layout] || STEPS.heatmap;
    if (e.key === "Escape") {
      chosen = null;
      detail(cursor);
      return;
    }
    if (!(e.key in changes) && !["Home", "End"].includes(e.key)) return;
    e.preventDefault();
    cursor =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? win.cells.length - 1
          : Math.max(0, Math.min(win.cells.length - 1, cursor + changes[e.key]));
    detail(cursor);
    grid.querySelector(`[data-cell="${cursor}"]`).focus();
  });
  root.addEventListener("click", (e) => {
    if (e.target.closest("[data-matrix-earlier]")) {
      end = addDays(win.from, -1);
      chosen = null;
      paint();
    }
    if (e.target.closest("[data-matrix-later]")) {
      end = addDays(win.to, limit()) > data.to ? data.to : addDays(win.to, limit());
      chosen = null;
      paint();
    }
    const step = e.target.closest("[data-matrix-prev],[data-matrix-next]");
    if (step) {
      const direction = step.hasAttribute("data-matrix-prev") ? -1 : 1;
      detail(Math.max(0, Math.min(win.cells.length - 1, cursor + direction)), true);
      const next = get(direction < 0 ? "[data-matrix-prev]" : "[data-matrix-next]");
      (next.disabled
        ? get(direction < 0 ? "[data-matrix-next]" : "[data-matrix-prev]")
        : next
      ).focus({ preventScroll: true });
    }
    const episode = e.target.closest("[data-matrix-edit]");
    if (episode) ctx.editEpisode(episode.dataset.matrixEdit);
    if (e.target.closest("[data-matrix-all]")) {
      expanded = !expanded;
      detail(cursor, true);
      get("[data-matrix-all]").focus({ preventScroll: true });
    }
    if (e.target.closest("[data-matrix-share]")) explore(win.cells[cursor].date, true);
    if (e.target.closest("[data-matrix-open]")) ctx.openDay(win.cells[cursor].date);
    if (e.target.closest("[data-matrix-episodes]")) explore(win.cells[cursor].date);
  });
  compact.addEventListener("change", () => {
    if (data) paint();
  });
  return {
    render(next, settings) {
      const key = `${next.from}:${next.to}`;
      if (key !== signature) {
        end = null;
        chosen = null;
        cursorDate = null;
        signature = key;
      }
      data = next;
      S = settings;
      paint();
    },
    restoreSelection(value) {
      end = validDate(value?.end) ? value.end : null;
      chosen = validDate(value?.chosen) ? value.chosen : null;
      cursorDate = validDate(value?.cursorDate) ? value.cursorDate : null;
      signature = value?.signature;
      expanded = value?.expanded === true;
    },
    snapshot: () => ({
      expanded,
      mode,
      end,
      chosen,
      cursorDate,
      signature,
    }),
  };
}
