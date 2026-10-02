// A bounded calendar, inspired by the activity view: one tab stop, four colour modes, pinned day details.
import { html, setHTML, fmtDay } from "./util.js";
import { addDays, used, capOf } from "./model.js";

export function calendarWindow(data, S, end = data.to, limit = 366) {
  end = end < data.from ? data.from : end > data.to ? data.to : end;
  const from = addDays(end, 1 - limit) < data.from ? data.from : addDays(end, 1 - limit);
  const days = new Map(data.days.map((d) => [d.date, d])),
    counts = new Map();
  for (const [, e] of data.episodes) {
    const date = e.when.slice(0, 10);
    counts.set(date, (counts.get(date) || 0) + 1);
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
      net: activity ? used(day) : null,
      allowance: day ? capOf(day, S) : null,
      episodes: counts.get(date) || 0,
    });
  }
  const offset = (new Date(from + "T12:00:00Z").getUTCDay() + 6) % 7;
  return { from, to: end, offset, cells, weeks: Math.ceil((offset + cells.length) / 7) };
}
export function describeCalendarDay(c, locale) {
  return `${fmtDay(c.date, locale)}. ${c.status ? c.status + " check-in" : "No matching check-in"}. ${c.net === null ? "No activities logged" : `${c.net} net points used, ${c.allowance} available`}. ${c.poorSleep ? "Sleep marked poor" : "Sleep not marked poor"}. ${c.episodes} matching ${c.episodes === 1 ? "episode" : "episodes"} recorded.`;
}
export function calendarPaint(c, mode) {
  if (mode === "checkin") return [c.status || "empty", c.status ? c.status[0].toUpperCase() : "–"];
  if (mode === "sleep") return [c.poorSleep ? "amber" : "empty", c.poorSleep ? "!" : "–"];
  if (mode === "episodes")
    return [c.episodes ? "level-" + Math.min(4, c.episodes) : "empty", c.episodes || "–"];
  if (c.net === null) return ["empty", "–"];
  return [
    c.net < 0 ? "recovery" : "level-" + Math.min(4, Math.max(1, Math.ceil(c.net / 3))),
    c.net < 0 ? "−" : c.net,
  ];
}
export function initMatrix(root, ctx, explore) {
  let data,
    S,
    win,
    mode = "checkin",
    end = null,
    chosen = null,
    cursor = 0,
    signature;
  const compact = matchMedia("(max-width:700px)"),
    limit = () => 366;
  setHTML(
    root,
    html`<div class="label-row"><div><h2>Your days at a glance</h2><p class="hint">A calendar of what you've recorded. Choose a colour view, then select a day.</p></div><label class="field matrix-mode">Colour days by<select data-matrix-mode><option value="checkin">Morning check-in</option><option value="points">Net activity points</option><option value="sleep">Poor sleep marked</option><option value="episodes">Episodes recorded</option></select></label></div><div class="matrix-period"><span class="meta" data-matrix-period></span><div class="row"><button class="secondary small" data-matrix-earlier>Earlier days</button><button class="secondary small" data-matrix-later>Later days</button></div></div><div class="matrix-layout"><div class="matrix-calendar"><div class="matrix-months" data-matrix-months aria-hidden="true"></div><div class="matrix-weekdays" aria-hidden="true"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div><div class="matrix-grid" data-matrix-grid role="group" aria-label="Daily calendar. Arrow keys move between days; Enter selects; Escape clears selection."></div></div><aside class="matrix-reading" data-matrix-reading aria-label="Selected day"></aside></div><div class="chart-legend matrix-legend" data-matrix-legend></div><p class="hint">Arrow keys move through days; Enter selects, Escape clears. On a small screen, use the day selector for an easier target. Grey means no matching record for the chosen view.</p><label class="field matrix-day">Choose a day<select data-matrix-day></select></label>`,
  );
  const get = (selector) => root.querySelector(selector),
    grid = get("[data-matrix-grid]");
  function detail(index, select = false) {
    const c = win.cells[index];
    cursor = index;
    if (select) chosen = c.date;
    get("[data-matrix-day]").value = String(index);
    for (const b of grid.querySelectorAll("button")) {
      b.tabIndex = Number(b.dataset.cell) === cursor ? 0 : -1;
      b.setAttribute("aria-pressed", b.dataset.date === chosen);
    }
    setHTML(
      get("[data-matrix-reading]"),
      html`<span class="label">${chosen === c.date ? "Selected day" : "Day detail"}</span><h3>${fmtDay(c.date, S.locale)}</h3><dl><div><dt>Check-in</dt><dd>${c.status || "Not recorded"}</dd></div><div><dt>Net points</dt><dd>${c.net === null ? "No activity log" : c.net}</dd></div><div><dt>Allowance</dt><dd>${c.allowance === null ? "No day log" : c.allowance}</dd></div><div><dt>Sleep</dt><dd>${c.poorSleep ? "Marked poor" : "Not marked poor"}</dd></div><div><dt>Episodes</dt><dd>${c.episodes} recorded</dd></div></dl><div class="row"><button class="secondary small" data-matrix-open>Open day</button>${c.episodes ? html`<button class="secondary small" data-matrix-episodes>View episodes</button>` : ""}</div>`,
    );
  }
  function paint() {
    win = calendarWindow(data, S, end || data.to, limit());
    root.style.setProperty("--weeks", win.weeks);
    root.classList.toggle("matrix-dense", win.weeks > 13);
    root.classList.toggle("matrix-year", win.weeks > 26);
    const oldCursor = chosen ? win.cells.findIndex((c) => c.date === chosen) : -1;
    cursor =
      oldCursor >= 0
        ? oldCursor
        : Math.max(
            0,
            win.cells.findLastIndex((c) => c.logged || c.episodes),
          );
    setHTML(
      grid,
      html`${Array.from({ length: win.offset }, () => html`<span class="matrix-blank" aria-hidden="true"></span>`)}${win.cells.map(
        (c, i) => {
          const [tone, mark] = calendarPaint(c, mode);
          return html`<button type="button" class="matrix-cell ${tone}" data-cell="${i}" data-date="${c.date}" tabindex="${i === cursor ? 0 : -1}" aria-pressed="${c.date === chosen}" aria-label="${describeCalendarDay(c, S.locale)}" data-tooltip="${describeCalendarDay(c, S.locale)}"><span aria-hidden="true">${mark}</span></button>`;
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
      html`<span>${month(win.from)}</span><span>${month(win.to)}</span>`,
    );
    get("[data-matrix-period]").textContent =
      `${fmtDay(win.from, S.locale)} – ${fmtDay(win.to, S.locale)} · ${win.cells.length} days${data.span > limit() ? ` shown of ${data.span}; use Earlier/Later to explore the rest` : ""}`;
    get("[data-matrix-earlier]").hidden = win.from === data.from;
    get("[data-matrix-later]").hidden = win.to === data.to;
    const legend =
      mode === "checkin"
        ? html`<span><i class="legend-green"></i>G · Green</span><span><i class="legend-amber"></i>A · Amber</span><span><i class="legend-red"></i>R · Red</span>`
        : mode === "sleep"
          ? html`<span><i class="legend-amber"></i>! · Sleep marked poor</span><span>Unmarked sleep is not necessarily good sleep</span>`
          : html`<span>Less</span>${[1, 2, 3, 4].map((level) => html`<i class="matrix-key level-${level}" aria-hidden="true"></i>`)}<span>More ${mode === "episodes" ? "recorded episodes" : "net points used"}</span>${mode === "points" ? html`<span><i class="legend-green"></i>− · Negative net points / recovery</span>` : ""}`;
    setHTML(
      get("[data-matrix-legend]"),
      html`${legend}<span><i></i>No matching record / unmarked</span>`,
    );
    setHTML(
      get("[data-matrix-day]"),
      html`${win.cells.map((c, i) => html`<option value="${i}">${fmtDay(c.date, S.locale)}</option>`)}`,
    );
    detail(cursor);
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
        signature = key;
      }
      data = next;
      S = settings;
      paint();
    },
  };
}
