// A bounded calendar, inspired by the activity view: one tab stop, energy and symptom colour modes, pinned day details.
import { energyWords, themeOf } from "./energy-theme.js";
import { html, setHTML, fmtDay, fmtWhen } from "./util.js";
import { addDays, used, capOf } from "./model.js";
import { validDate } from "./history-model.js";

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
      <div class="label-row"><h2 id="matrix-title">Your days at a glance</h2><label class="field matrix-mode">Colour by<select data-matrix-mode><option value="checkin">Morning check-in</option><option value="episodes">Episodes recorded</option><option value="remaining" data-energy-copy="Points remaining">Points remaining</option><option value="used" data-energy-copy="Activity points used">Activity points used</option><option value="points" data-energy-copy="Net activity points">Net activity points</option><option value="sleep">Poor sleep marked</option></select></label></div>
      <p class="hint">Select a day to see what you recorded.</p>
      <div class="matrix-period"><span class="meta" data-matrix-period></span><div class="row"><button class="secondary small" data-matrix-earlier>Earlier days</button><button class="secondary small" data-matrix-later>Later days</button></div></div>
      <div class="matrix-calendar"><div class="matrix-months" data-matrix-months aria-hidden="true"></div><div class="matrix-weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="matrix-grid" data-matrix-grid role="group" aria-label="Daily calendar. Arrow keys move between days; Enter selects; Escape clears selection."></div></div>
      <div class="chart-legend matrix-legend" data-matrix-legend></div>
      <label class="field matrix-day">Choose a day<select data-matrix-day></select></label>
      <div class="matrix-facts" data-matrix-facts></div>
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
    setHTML(
      get("[data-matrix-reading]"),
      html`<div class="matrix-day-heading"><span class="label">${chosen === c.date ? "Selected day" : "Day detail"}</span><div class="row"><button class="secondary small" data-matrix-prev aria-label="Previous day" ${index === 0 ? html`disabled` : ""}>←</button><button class="secondary small" data-matrix-next aria-label="Next day" ${index === win.cells.length - 1 ? html`disabled` : ""}>→</button></div></div>
      <h3>${fmtDay(c.date, S.locale)}</h3>
      <dl><div><dt>Morning check-in</dt><dd><span class="dot ${c.status || ""}"></span>${c.status || "No matching check-in"}</dd></div><div><dt>Sleep</dt><dd>${!day ? "No matching day log" : c.poorSleep ? "Marked poor" : "Not marked poor"}</dd></div><div><dt>Episodes</dt><dd>${c.episodes} recorded</dd></div></dl>
      ${day ? html`<div class="matrix-balance"><span class="label">${words.title} remaining</span><b>${remaining === null ? "—" : remaining}</b><span class="meta">${entries.length ? `${c.net} net used of ${c.allowance} available` : `${c.allowance} available · no activities logged`}</span></div>` : html`<p class="empty">No matching day log. Review this day to see or add records.</p>`}
      ${entries.length ? html`<div><h4>Activities</h4><ul class="matrix-activities">${entries.slice(0, expanded ? entries.length : 5).map((e) => html`<li><span>${e.a}${e.t ? html`<time class="meta">${e.t}</time>` : ""}</span><b class="${e.c < 0 ? "recovery" : ""}">${e.c > 0 ? "−" + e.c : e.c < 0 ? "+" + Math.abs(e.c) : "0"}<span class="sr-only"> ${words.plural} ${e.c < 0 ? "recovered" : "used"}</span></b></li>`)}</ul>${!expanded && entries.length > 5 ? html`<p class="hint">Showing 5 of ${entries.length} activities. Choose Show all records below for the full log.</p>` : ""}</div>` : ""}
      ${c.episodes ? html`<div><h4>Episodes</h4><ul class="matrix-episodes">${c.episodeRecords.slice(0, expanded ? c.episodes : 3).map(([id, e]) => html`<li><button class="x" data-matrix-edit="${id}"><span>${e.symptoms.join(", ") || "No symptoms ticked"}<span class="meta">${fmtWhen(e.when, S.locale)}${e.duration === "Still going" && !e.endedAt ? " · ongoing" : ""}</span></span><span aria-hidden="true">→</span></button></li>`)}</ul>${!expanded && c.episodes > 3 ? html`<button class="x" data-matrix-episodes>View all ${c.episodes} episodes</button>` : ""}</div>` : ""}
      <div class="row"><button class="secondary" data-matrix-open>Edit day</button><button class="secondary" data-matrix-all>${expanded ? "Show fewer records" : "Show all records for this day"}</button><button class="primary" data-matrix-share>Share this day</button></div>`,
    );
  }
  function paint() {
    win = calendarWindow(data, S, end || data.to, limit());
    root.style.setProperty("--weeks", win.weeks);
    root.classList.toggle("matrix-dense", win.weeks > 13);
    root.classList.toggle("matrix-year", win.weeks > 26);
    const oldCursor = win.cells.findIndex((c) => c.date === (cursorDate || chosen));
    cursor =
      oldCursor >= 0
        ? oldCursor
        : (() => {
            const latest = win.cells.findLastIndex((c) => c.logged || c.episodes);
            return latest < 0 ? win.cells.length - 1 : latest;
          })();
    setHTML(
      grid,
      html`${Array.from({ length: win.offset }, () => html`<span class="matrix-blank" aria-hidden="true"></span>`)}${win.cells.map(
        (c, i) => {
          const [tone, mark] = calendarPaint(c, mode);
          return html`<button type="button" class="matrix-cell ${tone}" data-cell="${i}" data-date="${c.date}" tabindex="${i === cursor ? 0 : -1}" aria-pressed="${c.date === chosen}" aria-label="${describeCalendarDay(c, S.locale, themeOf(ctx))}" data-tooltip="${describeCalendarDay(c, S.locale, themeOf(ctx))}"><span aria-hidden="true">${mark}</span></button>`;
        },
      )}`,
    );
    // Complete the final week without inventing records outside the selected range.
    for (let i = win.offset + win.cells.length; i < win.weeks * 7; i++) {
      const blank = document.createElement("span");
      blank.className = "matrix-blank";
      blank.setAttribute("aria-hidden", "true");
      grid.append(blank);
    }
    const month = (date) =>
      new Date(date + "T12:00:00Z").toLocaleDateString(S.locale || undefined, {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
    setHTML(
      get("[data-matrix-months]"),
      html`<span>${month(win.from)}</span>${month(win.from) !== month(win.to) ? html`<span>${month(win.to)}</span>` : ""}`,
    );
    get("[data-matrix-period]").hidden = data.span <= limit();
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
      html`${legend}<span><i></i>No matching record / unmarked</span>`,
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
    const changes = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 };
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
