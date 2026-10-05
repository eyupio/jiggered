import { $, html, setHTML, uid, fmtDay, signed } from "./util.js";
import { addDays, dayId, hhmm } from "./model.js";
import { DAY, slotText, suggestDuration, toMinutes, validDur } from "./calendar-model.js";
import { validDate } from "./history-model.js";
import { energyAmount, themeOf } from "./energy-theme.js";
import { forecast, planId, plannedEntryId } from "./planner-model.js";

const markupCache = new WeakMap();
function setStable(el, markup) {
  if (markupCache.get(el) === markup.s) return;
  markupCache.set(el, markup.s);
  setHTML(el, markup);
}
const amount = (ctx, n) => energyAmount(n, themeOf(ctx));
// When a planned activity is logged as done it started at its planned time if that has already passed, otherwise now.
// On a past day "now" would be wrong, so only the planned time (or none) is used.
function loggedStart(ctx, row, day) {
  if (day !== ctx.today()) return row.t || "";
  const now = hhmm(new Date());
  return row.t && row.t <= now ? row.t : now;
}
// Its planned length carries over, trimmed so the logged activity still ends by midnight.
function loggedLength(row, start) {
  const from = toMinutes(start),
    dur = from === null ? row.dur : Math.min(row.dur, DAY - from);
  return validDur(dur) ? { dur } : {};
}
const writable = (ctx) => !ctx.store.status().readOnly && !ctx.store.status().restoring;
const dispatch = (ctx, date, type, arg, before) =>
  ctx.store.dispatch({
    id: planId(date),
    type,
    arg,
    before,
    original: ctx.store.view(planId(date)),
  });

function rowsMarkup(ctx, f, date, todayOnly = false) {
  return html`<ul class="plan-activities">${f.rows.map((e) => {
    const done = f.done.includes(e);
    const actual = done ? f.day.entries.find((a) => a.id === plannedEntryId(date, e.id)) : null;
    return html`<li class="plan-activity ${done ? "is-done" : ""} ${e.c < 0 ? "is-recovery" : ""}">
      <div class="plan-activity-info"><b>${e.a}</b><span class="meta">${done ? `Logged · planned ${signed(e.c)}` : e.c < 0 ? "Recovery planned" : "Planned"}${slotText(e) ? ` · ${slotText(e)}` : ""}</span></div>
      <strong class="plan-cost">${signed(actual?.c ?? e.c)}<span class="sr-only"> ${amount(ctx, Math.abs(e.c)).split(" ").slice(1).join(" ")}</span></strong>
      <div class="plan-actions">${done ? html`<span class="plan-done">✓ Done</span>` : html`${date <= ctx.today() ? html`<button type="button" class="primary small" data-plan-action="complete" data-date="${date}" data-id="${e.id}" aria-label="Log ${e.a} as done">Done</button>` : ""}${todayOnly ? "" : html`<button type="button" class="secondary small" data-plan-action="edit" data-id="${e.id}" aria-label="Edit planned ${e.a}">Edit</button><button type="button" class="secondary small" data-plan-action="remove" data-id="${e.id}" aria-label="Remove planned ${e.a}">Remove</button>`}`}</div></li>`;
  })}</ul>`;
}

export function renderTodayPlan(ctx, date) {
  const root = $("today-plan"),
    f = forecast(ctx.store.all(), date, ctx.settings());
  setStable(
    root,
    html`<div class="plan-heading"><div><h3>${date === ctx.today() ? "Still to come today" : "Plan for this day"}</h3><p class="meta">${f.pending.length ? `${amount(ctx, f.committed)} committed · ${amount(ctx, f.recovery)} recovery planned` : "Make room for your workload and recovery."}</p></div><button type="button" class="secondary" data-open-plan="${date}">${f.rows.length ? "Review plan" : "Plan your day"}</button></div>
    ${f.pending.length ? html`<p class="plan-outlook ${f.afterWork < 0 ? "plan-warning" : ""}">${f.afterWork < 0 ? `${amount(ctx, -f.afterWork)} beyond your allowance before planned recovery.` : `${amount(ctx, f.afterWork)} uncommitted before planned recovery.`} After planned recovery: <b>${amount(ctx, f.projected)}</b>.</p>${rowsMarkup(ctx, { ...f, rows: f.pending }, date, true)}` : f.done.length ? html`<p class="hint">All ${f.done.length} planned activities are logged. Their actual costs are included above.</p>` : ""}`,
  );
}

export function init(ctx) {
  const root = $("plan-panel"),
    form = $("plan-form");
  const saved = ctx.ui?.get("plan") || {};
  let date = validDate(saved.date) ? saved.date : ctx.today(),
    span = [1, 3, 7].includes(saved.span) ? saved.span : 7,
    editing = null,
    completing = false;
  const model = () => forecast(ctx.store.all(), date, ctx.settings());
  const days = () => Array.from({ length: span }, (_, i) => addDays(ctx.today(), i));
  function openForm(entry = null, complete = false) {
    if (!writable(ctx)) return;
    editing = entry;
    completing = complete;
    form.hidden = false;
    $("plan-form-title").textContent = complete
      ? "Log what actually happened"
      : entry
        ? "Edit planned activity"
        : "Add to your plan";
    $("plan-name").value = entry?.a || "";
    $("plan-cost").value = entry?.c ?? 1;
    $("plan-time").value = complete ? loggedStart(ctx, entry, date) : entry?.t || "";
    $("plan-dur").value = entry?.dur ?? "";
    $("plan-repeat-row").hidden = !!entry || date < ctx.today();
    $("plan-repeat").value = 1;
    $("plan-repeat").max = Math.max(
      1,
      Math.min(7, days().at(-1) >= date ? days().filter((d) => d >= date).length : 1),
    );
    $("plan-submit").textContent = complete ? "Log activity" : "Save plan";
    $("plan-form-error").textContent = "";
    setStable(
      $("plan-presets"),
      html`<option value="">Choose from your activities…</option>${ctx.settings().activities.map((e, i) => html`<option value="${i}">${e.a} (${signed(e.c)})</option>`)}`,
    );
    $("plan-presets-row").hidden = complete;
    $("plan-name").focus();
  }
  function closeForm() {
    form.hidden = true;
    editing = null;
    completing = false;
  }
  function rememberDraft() {
    if (form.hidden || !writable(ctx)) return;
    ctx.drafts?.put(`plan:${date}`, {
      original: editing,
      completing,
      a: $("plan-name").value,
      c: $("plan-cost").value,
      t: $("plan-time").value,
      dur: $("plan-dur").value,
      repeat: $("plan-repeat").value,
    });
  }
  function restoreDraft() {
    if (!form.hidden || !writable(ctx)) return;
    const draft = ctx.drafts?.get(`plan:${date}`);
    if (!draft) return;
    openForm(draft.original, draft.completing === true);
    $("plan-name").value = draft.a;
    $("plan-cost").value = draft.c;
    $("plan-time").value = draft.t;
    $("plan-dur").value = draft.dur ?? "";
    $("plan-repeat").value = Math.min(Number(draft.repeat) || 1, Number($("plan-repeat").max));
    $("plan-form-error").textContent = "Unfinished planning draft restored.";
  }
  form.addEventListener("input", rememberDraft);
  form.addEventListener("change", rememberDraft);
  $("plan-presets").addEventListener("change", (e) => {
    if (e.target.value === "") return;
    const entry = ctx.settings().activities[Number(e.target.value)];
    $("plan-name").value = entry.a;
    $("plan-cost").value = entry.c;
    if (!$("plan-dur").value) $("plan-dur").value = suggestDuration(entry.a) ?? "";
  });
  $("plan-cancel").addEventListener("click", () => {
    ctx.drafts?.remove(`plan:${date}`);
    closeForm();
  });
  $("plan-add").addEventListener("click", () => openForm());
  $("plan-start-add").addEventListener("click", () => openForm());
  $("plan-span").addEventListener("change", (e) => {
    span = Number(e.target.value);
    date = ctx.today();
    closeForm();
    render();
  });
  $("plan-allowance").addEventListener("change", (e) => {
    const n = Number(e.target.value),
      f = model();
    if (!Number.isInteger(n) || n < 1 || n > 30 || f.logged || !writable(ctx)) {
      render();
      return;
    }
    dispatch(
      ctx,
      date,
      "patch",
      { date, allowance: n },
      { date: f.plan.date, allowance: f.plan.allowance },
    );
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const a = $("plan-name").value.trim(),
      c = Number($("plan-cost").value),
      t = $("plan-time").value;
    const repeat = Number($("plan-repeat").value);
    if (
      !a ||
      [...a].length > 60 ||
      !Number.isInteger(c) ||
      c < -10 ||
      c > 10 ||
      !Number.isInteger(repeat) ||
      repeat < 1 ||
      repeat > Number($("plan-repeat").max)
    ) {
      $("plan-form-error").textContent =
        "Use a name of 1–60 characters, a whole-number cost from −10 to 10 and a valid number of days.";
      return;
    }
    const durText = $("plan-dur").value.trim(),
      dur = durText === "" ? null : Number(durText);
    if (dur !== null && !validDur(dur)) {
      $("plan-form-error").textContent =
        "Use a whole number of minutes from 5 to 1440, or leave the duration empty.";
      return;
    }
    if (dur !== null && toMinutes(t) !== null && toMinutes(t) + dur > DAY) {
      $("plan-form-error").textContent =
        "That would run past midnight. Start earlier or shorten the duration.";
      return;
    }
    if (!writable(ctx)) return;
    const f = model();
    if (editing && !f.pending.some((row) => row.id === editing.id)) {
      $("plan-form-error").textContent =
        "This activity changed on another device. Close this form and review the plan.";
      return;
    }
    const entry = { a, c, t, id: editing?.id || uid(), ...(dur !== null ? { dur } : {}) };
    if (completing) {
      ctx.store.dispatch({
        id: dayId(date),
        type: "addEntry",
        arg: { ...entry, id: plannedEntryId(date, editing.id) },
        stamp: {
          budget: f.logged ? f.day.budget : f.allowance,
          sleepPenalty: ctx.settings().sleepPenalty,
        },
        original: ctx.store.view(dayId(date)),
      });
    } else if (editing)
      dispatch(
        ctx,
        date,
        "editEntry",
        {
          id: editing.id,
          changes: { a, c, t, ...(dur !== null || editing.dur != null ? { dur } : {}) },
        },
        editing,
      );
    else {
      for (let i = 0; i < repeat; i++) {
        if (forecast(ctx.store.all(), addDays(date, i), ctx.settings()).rows.length >= 200) {
          $("plan-form-error").textContent =
            "A selected day already has 200 planned activities. Shorten the repeat or remove an activity.";
          return;
        }
      }
      for (let i = 0; i < repeat; i++)
        dispatch(ctx, addDays(date, i), "addEntry", { ...entry, id: i ? uid() : entry.id });
    }
    ctx.drafts?.remove(`plan:${date}`);
    const wasCompleting = completing;
    closeForm();
    render();
    $("plan-add").focus();
    ctx.toast(wasCompleting ? "Activity queued." : "Plan update queued.");
  });
  root.addEventListener("click", (e) => {
    const day = e.target.closest("[data-plan-day]");
    if (day) {
      date = day.dataset.planDay;
      closeForm();
      render();
      return;
    }
    const recovery = e.target.closest("[data-plan-recovery]");
    if (recovery && writable(ctx)) {
      const preset = ctx
        .settings()
        .activities.find((row) => (row.id || row.a) === recovery.dataset.planRecovery);
      if (preset) {
        openForm();
        $("plan-name").value = preset.a;
        $("plan-cost").value = preset.c;
        $("plan-dur").value = suggestDuration(preset.a) ?? "";
      }
      return;
    }
    const button = e.target.closest("[data-plan-action]");
    if (!button || !writable(ctx)) return;
    const entry = model().pending.find((row) => row.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.planAction === "remove") {
      dispatch(ctx, date, "removeEntry", entry);
      ctx.toast("Removed from plan.", {
        label: "Undo",
        fn: () => dispatch(ctx, date, "addEntry", entry),
      });
    } else openForm(entry, button.dataset.planAction === "complete");
  });
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open-plan]");
    if (open) {
      date = open.dataset.openPlan;
      closeForm();
      ctx.go("plan");
      render();
    }
    const done = e.target.closest("#today-plan [data-plan-action='complete']");
    if (done) completePlanned(done.dataset.date, done.dataset.id);
  });
  // Done on Today logs the planned activity right there, as tapping an activity tile does, instead of sending the
  // person to Plan and a form. Undo takes it back; tapping it among the day's logged activities corrects it.
  // It started at its planned time if that has passed, otherwise now (see loggedStart), and keeps its planned length.
  function completePlanned(day, id) {
    if (!writable(ctx)) return;
    const f = forecast(ctx.store.all(), day, ctx.settings()),
      row = f.pending.find((r) => r.id === id);
    if (!row) return;
    const target = dayId(day),
      start = loggedStart(ctx, row, day),
      entry = {
        id: plannedEntryId(day, row.id),
        a: row.a,
        c: row.c,
        t: start,
        ...loggedLength(row, start),
      };
    ctx.store.dispatch({
      id: target,
      type: "addEntry",
      arg: entry,
      stamp: {
        budget: f.logged ? f.day.budget : f.allowance,
        sleepPenalty: ctx.settings().sleepPenalty,
      },
      original: ctx.store.view(target),
    });
    ctx.toast(`Logged ${row.a}.`, {
      label: "Undo",
      fn: () =>
        ctx.store.dispatch({
          id: target,
          type: "removeEntry",
          arg: entry,
          original: ctx.store.view(target),
        }),
    });
    // The row that held focus is gone; keep keyboard focus on the next one (or the card's own button).
    const card = $("today-plan");
    (
      card.querySelector("[data-plan-action='complete']") || card.querySelector("[data-open-plan]")
    )?.focus();
  }
  function render() {
    if (!validDate(date) || date > addDays(ctx.today(), 6)) date = ctx.today();
    $("plan-span").value = span;
    const f = model(),
      dates = days(),
      forecasts = dates.map((d) => forecast(ctx.store.all(), d, ctx.settings()));
    // With nothing planned in view, a phone leads with the way to start instead of a row of "No plan" days.
    $("plan-start").hidden = forecasts.some((m) => m.rows.length);
    $("plan-start-add").disabled = !writable(ctx);
    setStable(
      $("plan-days"),
      html`${dates.map((d, i) => {
        const m = forecasts[i];
        return html`<button type="button" class="plan-day ${m.afterWork < 0 ? "plan-warning" : ""}" data-plan-day="${d}" aria-pressed="${d === date}"><span>${d === ctx.today() ? "Today" : fmtDay(d, ctx.settings().locale).split(",")[0]}</span><b>${m.rows.length || m.logged ? m.projected : "—"}</b><small>${m.rows.length ? `${m.pending.length} planned` : "No plan"}</small><span class="sr-only">${m.rows.length ? `${amount(ctx, m.projected)} projected; ${amount(ctx, m.afterWork)} before recovery` : ""}</span></button>`;
      })}`,
    );
    $("plan-date-label").textContent = fmtDay(date, ctx.settings().locale);
    $("plan-allowance").value = f.allowance;
    $("plan-allowance").disabled = f.logged || !writable(ctx);
    $("plan-allowance-hint").textContent = f.logged
      ? "Uses this day’s logged allowance. Adjust check-in and sleep in Today."
      : "Your estimate for this day, including expected sleep or check-in effects. Each day starts fresh.";
    // Totals only mean something once there is a plan or a log; an empty day would show a wall of zeros.
    setStable(
      $("plan-forecast"),
      !f.rows.length && !f.logged
        ? html``
        : html`<div class="plan-metrics"><div><span>Available ${date === ctx.today() ? "now" : "for this day"}</span><b>${f.remaining}</b></div><div><span>Work still planned</span><b>${signed(f.committed)}</b></div><div><span>Uncommitted</span><b>${f.afterWork}</b></div><div class="is-recovery"><span>Planned recovery</span><b>${signed(-f.recovery)}</b></div><div><span>Projected balance</span><b>${f.projected}</b></div></div>
      <p class="plan-outlook ${f.shortfall ? "plan-warning" : ""}">${f.shortfall ? `${amount(ctx, f.shortfall)} recovery or less workload needed to stay within this allowance before recovery.` : `${amount(ctx, f.afterWork)} left after planned workload, before recovery.`}${f.recovery ? ` Your recovery plan adds an estimated ${amount(ctx, f.recovery)}; ${f.gap ? `${amount(ctx, f.gap)} still uncovered.` : "it is included only in the projected balance."}` : ""}</p>`,
    );
    setStable(
      $("plan-list"),
      f.rows.length
        ? rowsMarkup(ctx, f, date)
        : html`<div class="plan-empty"><h3>A little breathing room starts here.</h3><p>Add work, commitments or recovery. You’ll see how they fit before the day gets busy.</p></div>`,
    );
    setStable(
      $("plan-recovery-options"),
      f.shortfall
        ? html`<h3>Make room for recovery</h3><p class="hint">Choose something that helps you recover. These use your saved estimates.</p><div class="plan-recovery-options">${ctx
            .settings()
            .activities.filter((e) => e.c < 0)
            .slice(0, 4)
            .map(
              (e) =>
                html`<button type="button" class="secondary" data-plan-recovery="${e.id || e.a}">${e.a} · +${-e.c}</button>`,
            )}</div>${!ctx.settings().activities.some((e) => e.c < 0) ? html`<p class="hint">Add a recovery activity with a negative cost, or reduce a planned activity’s cost.</p>` : ""}`
        : html``,
    );
    $("plan-add").disabled = !writable(ctx) || f.rows.length >= 200;
    root
      .querySelectorAll("[data-plan-action],[data-plan-recovery]")
      .forEach((b) => (b.disabled = !writable(ctx)));
  }
  return {
    show() {
      render();
      restoreDraft();
    },
    render,
    hide() {
      rememberDraft();
      closeForm();
    },
    snapshot: () => ({ date, span }),
  };
}
