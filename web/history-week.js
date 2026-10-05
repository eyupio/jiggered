// The week on a timeline, read-only: what was logged (solid), what was planned and not done (dashed) and the episodes
// (a strip down the right of each day). It draws the whole account, not the period and filters chosen above it: it is the
// "what did my week look like" view, and the filters are for searching records.
import { html, setHTML, fmtDay, fmtLongDay } from "./util.js";
import { addDays, listEpisodes, nowLocal, used } from "./model.js";
import { forecast } from "./planner-model.js";
import { createTimeGrid } from "./calendar.js";
import { weekDays, episodeBlocks } from "./week-model.js";
import { validDate } from "./history-model.js";

export function initWeek(root, ctx) {
  const saved = ctx.ui?.get("history")?.week || {};
  // The day shown (its week on a wide screen). A remembered one is only kept for the day it was left on.
  let focus = saved.at === ctx.today() && validDate(saved.focus) ? saved.focus : null;
  const narrow = matchMedia("(max-width: 700px)"); // a phone shows one day at a time
  setHTML(
    root,
    html`<section class="panel history-week" aria-labelledby="week-title">
      <div class="label-row"><h2 id="week-title" tabindex="-1">Your week on a timeline</h2></div>
      <p class="hint">Logged activities are solid, planned ones you did not log are dashed, and episodes are the red bars down the right of each day. Select one to open it.</p>
      <div class="week-nav"><button type="button" class="secondary small" data-week-prev aria-label="Previous week">←</button><span class="meta" data-week-range role="status"></span><button type="button" class="secondary small" data-week-next aria-label="Next week">→</button><button type="button" class="secondary small" data-week-today>Today</button></div>
      <p class="empty" data-week-empty hidden>Nothing logged, planned or recorded for this week. Log an activity on Today, or plan ahead on Plan.</p>
      <div id="history-board" class="cal"></div>
      <div class="week-actions" data-week-actions></div>
    </section>`,
  );
  const get = (selector) => root.querySelector(selector);
  const dayLabel = (d) =>
    d === ctx.today()
      ? "Today"
      : `${fmtDay(d, ctx.settings().locale).split(",")[0]} ${Number(d.slice(8))}`;
  const grid = createTimeGrid(get("#history-board"), {
    editable: () => false,
    onSelectDay(d) {
      focus = d;
      paint();
    },
    onOpen({ date, id }) {
      const [kind, ...rest] = id.split(":");
      if (kind === "log") ctx.openDay(date);
      else if (kind === "plan") ctx.openPlan(date);
      else if (kind === "ep") ctx.editEpisode(rest.join(":"));
    },
    onCreate() {},
    onChange() {},
    onDrop() {},
  });

  function paint() {
    const S = ctx.settings(),
      docs = ctx.store.all(),
      today = ctx.today(),
      at = focus || today,
      dates = narrow.matches ? [at] : weekDays(at),
      episodes = listEpisodes(docs),
      now = nowLocal();
    const days = dates.map((date) => {
      const f = forecast(docs, date, S),
        net = used(f.day);
      return {
        date,
        label: dayLabel(date),
        value: f.day.entries.length
          ? `${Math.abs(net)} ${net < 0 ? "recovered" : "used"}`
          : f.pending.length
            ? `${f.committed} planned`
            : "—",
        today: date === today,
        selected: date === at,
        warn: f.day.entries.length > 0 && net > f.allowance,
        blocks: [
          ...f.day.entries.map((e, i) => ({
            id: "log:" + (e.id ?? i),
            title: e.a,
            cost: e.c,
            t: e.t,
            dur: e.dur,
            kind: "logged",
          })),
          ...f.pending.map((r) => ({
            id: "plan:" + r.id,
            title: r.a,
            cost: r.c,
            t: r.t,
            dur: r.dur,
            kind: "plan",
            hint: date < today ? "planned, not logged" : "",
          })),
          ...episodeBlocks(episodes, date, now),
        ],
      };
    });
    grid.render({
      editable: false,
      strip: true,
      help: "Enter opens a logged activity on its day, a planned one on the plan, or an episode to read or change it.",
      days,
    });
    get("[data-week-range]").textContent = narrow.matches
      ? fmtLongDay(at, S.locale)
      : `${fmtDay(dates[0], S.locale)} – ${fmtDay(dates[6], S.locale)}`;
    const unit = narrow.matches ? "day" : "week";
    get("[data-week-prev]").setAttribute("aria-label", `Previous ${unit}`);
    get("[data-week-next]").setAttribute("aria-label", `Next ${unit}`);
    get("[data-week-today]").disabled = dates.includes(today);
    get("[data-week-empty]").hidden = days.some((d) => d.blocks.length);
    setHTML(
      get("[data-week-actions]"),
      html`<button type="button" class="secondary" data-week-edit="${at}">${at === today ? "Edit today" : `Edit ${dayLabel(at)}`}</button><button type="button" class="secondary" data-open-plan="${at}">${at < today ? `See the plan for ${dayLabel(at)}` : at === today ? "Plan today" : `Plan ${dayLabel(at)}`}</button>`,
    );
  }
  root.addEventListener("click", (e) => {
    const step = e.target.closest("[data-week-prev],[data-week-next]");
    if (step) {
      const by = (narrow.matches ? 1 : 7) * (step.hasAttribute("data-week-prev") ? -1 : 1);
      focus = addDays(focus || ctx.today(), by);
      paint();
    }
    if (e.target.closest("[data-week-today]")) {
      focus = null;
      paint();
    }
    const edit = e.target.closest("[data-week-edit]");
    if (edit) ctx.openDay(edit.dataset.weekEdit);
  });
  narrow.addEventListener("change", paint);
  return {
    render: paint,
    // Called from the month overview: bring this day's week (or the day, on a phone) into view.
    show(date) {
      focus = date;
      paint();
      const title = get("#week-title");
      title.scrollIntoView({ block: "start" });
      title.focus({ preventScroll: true });
    },
    snapshot: () => ({ focus, at: ctx.today() }),
  };
}
