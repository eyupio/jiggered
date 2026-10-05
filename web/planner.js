import { $, html, setHTML, uid, fmtDay, signed, confirmDialog, sheetMode } from "./util.js";
import { addDays, dayId, hhmm } from "./model.js";
import {
  DAY,
  NEW_DUR,
  fromMinutes,
  formatDur,
  scaleCost,
  slotText,
  spanOf,
  suggestDuration,
  toMinutes,
  validDur,
} from "./calendar-model.js";
import { createTimeGrid } from "./calendar.js";
import { validDate } from "./history-model.js";
import { energyAmount, energyWords, themeOf } from "./energy-theme.js";
import { forecast, planId, plannedEntryId } from "./planner-model.js";

const markupCache = new WeakMap();
export function setStable(el, markup) {
  if (markupCache.get(el) === markup.s) return;
  markupCache.set(el, markup.s);
  setHTML(el, markup);
}
// Colours a person can give a planned block (stored as `col` on the entry); no `col` means the default by cost.
export const TONES = [
  { id: "sand", label: "Sand" },
  { id: "sage", label: "Sage" },
  { id: "sky", label: "Sky" },
  { id: "rose", label: "Rose" },
  { id: "plum", label: "Plum" },
  { id: "slate", label: "Slate" },
];
// A copy of an activity for the same day: beside the original if there is room after it, otherwise at the same time.
export function copyOf(row) {
  const span = spanOf(row),
    t = span && span.start + span.dur * 2 <= DAY ? fromMinutes(span.start + span.dur) : row.t;
  return { ...row, id: uid(), ...(t === undefined ? {} : { t }) };
}

// The right-click menu shared by the plan and Today timelines. `actions` does the work on the page's own document:
// edit(), duplicate(), patch(changes, message) for colour and points, remove().
let menu = null;
function closeBlockMenu() {
  if (!menu) return;
  const { el, away, node } = menu;
  node.remove();
  document.removeEventListener("pointerdown", away, true);
  menu = null;
  if (el?.isConnected) el.focus({ preventScroll: true });
}
export function showEntryMenu({ x, y, el, row, ...actions }) {
  closeBlockMenu();
  const span = spanOf(row),
    entries = [];
  const add = (label, action, { key = "", danger = false, disabled = false } = {}) =>
    entries.push({ label, action, key, danger, disabled });
  add(actions.editLabel || "Edit", actions.edit, { key: "Enter" });
  add("Duplicate", actions.duplicate);
  entries.push({ heading: "Colour" }, { swatches: true });
  entries.push({
    heading: span
      ? `Points for ${formatDur(span.dur)}: ${signed(row.c)}`
      : `Points: ${signed(row.c)}`,
  });
  const step = (by) => () =>
    actions.patch({ c: row.c + by }, `${row.a} now ${signed(row.c + by)}.`);
  add("Costs 1 more (−1 left)", step(1), { disabled: row.c >= 10 });
  add("Costs 1 less (+1 left)", step(-1), { disabled: row.c <= -10 });
  entries.push(null);
  add("Remove", actions.remove, { danger: true, key: "Del" });
  const node = document.createElement("div");
  node.className = "fb-menu";
  node.setAttribute("role", "menu");
  setHTML(
    node,
    html`${entries.map((e, i) =>
      e === null
        ? html`<hr />`
        : e.heading
          ? html`<p class="fb-menu-heading">${e.heading}</p>`
          : e.swatches
            ? html`<div class="fb-swatches" role="group" aria-label="Colour">${[{ id: "", label: "Automatic" }, ...TONES].map((t) => html`<button type="button" role="menuitemradio" class="fb-swatch cal-tone-${t.id || "auto"}" data-tone="${t.id}" aria-checked="${(row.col || "") === t.id ? "true" : "false"}" aria-label="${t.label}" title="${t.label}"></button>`)}</div>`
            : html`<button type="button" role="menuitem" class="${e.danger ? "is-danger" : ""}" data-menu="${i}" ${e.disabled ? "disabled" : ""}><span>${e.label}</span>${e.key ? html`<kbd>${e.key}</kbd>` : ""}</button>`,
    )}`,
  );
  document.body.append(node);
  const w = node.offsetWidth,
    h = node.offsetHeight;
  node.style.left = `${Math.max(8, Math.min(x, innerWidth - w - 8))}px`;
  node.style.top = `${Math.max(8, Math.min(y, innerHeight - h - 8))}px`;
  node.onclick = (e) => {
    const tone = e.target.closest("[data-tone]");
    const b = e.target.closest("[data-menu]");
    if (!tone && !b) return;
    closeBlockMenu();
    if (tone) {
      const col = tone.dataset.tone;
      if ((row.col || "") !== col)
        actions.patch({ col: col || null }, col ? `${row.a} coloured ${col}.` : "Colour cleared.");
    } else entries[Number(b.dataset.menu)].action();
  };
  node.onkeydown = (e) => {
    const buttons = [...node.querySelectorAll("button:not([disabled])")];
    const i = buttons.indexOf(document.activeElement);
    if (
      e.key === "ArrowDown" ||
      e.key === "ArrowUp" ||
      e.key === "ArrowRight" ||
      e.key === "ArrowLeft"
    ) {
      e.preventDefault();
      const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
      buttons[(i + dir + buttons.length) % buttons.length]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeBlockMenu();
    }
  };
  const away = (e) => {
    if (!node.contains(e.target)) closeBlockMenu();
  };
  document.addEventListener("pointerdown", away, true);
  menu = { node, away, el };
  node.querySelector("button:not([disabled])")?.focus();
}

const amount = (ctx, n) => energyAmount(n, themeOf(ctx));
// In a form, an activity's points follow its length once that is changed, until the points are typed over. It starts
// from an activity that already has a length (or a saved one whose name gives it); `set(cost, length)` says which.
export function followLength(ctx, durInput, costInput, hint) {
  let base = null,
    touched = false;
  costInput.addEventListener("input", () => {
    touched = true;
    hint.textContent = "";
  });
  durInput.addEventListener("change", () => {
    const dur = Number(durInput.value),
      next = base && !touched ? scaleCost(base.cost, base.dur, dur) : null;
    if (next === null || next === Number(costInput.value)) return;
    costInput.value = String(next);
    hint.textContent = `Points follow the length: ${signed(base.cost)} for ${formatDur(base.dur)}, so ${signed(next)} for ${formatDur(dur)}. Change them if you like.`;
  });
  return {
    set(cost, length) {
      base =
        Number.isInteger(cost) && cost !== 0 && validDur(length) ? { cost, dur: length } : null;
      touched = false;
      hint.textContent = "";
    },
  };
}
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

// Done on Today logs the planned activity right there, as tapping an activity tile does, instead of sending the
// person to Plan and a form. Undo takes it back; tapping it among the day's logged activities corrects it.
// It started at its planned time if that has passed, otherwise now (see loggedStart), and keeps its planned length.
export function completePlanned(ctx, day, id, { focus = true } = {}) {
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
      ...(row.col ? { col: row.col } : {}),
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
  if (!focus) return;
  const card = $("today-plan");
  (
    card.querySelector("[data-plan-action='complete']") || card.querySelector("[data-open-plan]")
  )?.focus();
}

// Taking a planned activity off its day, after asking (a block is easy to catch while dragging). Undo puts it back.
export async function removePlanned(ctx, day, id) {
  const find = () =>
    forecast(ctx.store.all(), day, ctx.settings()).pending.find((r) => r.id === id);
  const row = find();
  if (!row || !writable(ctx)) return;
  const when = slotText(row);
  const yes = await confirmDialog({
    title: "Remove from your plan?",
    body: `${row.a} (${signed(row.c)}${when ? `, ${when}` : ""}) will be taken off your plan. You can undo this straight afterwards.`,
  });
  // The plan can change while the question is open (another device, a sync): act only on what is still there.
  const current = find();
  if (!yes || !current || !writable(ctx)) return;
  dispatch(ctx, day, "removeEntry", current);
  ctx.toast("Removed from plan.", {
    label: "Undo",
    fn: () => dispatch(ctx, day, "addEntry", current),
  });
}

// Moving a planned activity on its own day (from the timeline on Today). Undo puts its time and length back.
export function reschedulePlanned(ctx, day, id, start, dur, scaled) {
  if (!writable(ctx)) return;
  const row = forecast(ctx.store.all(), day, ctx.settings()).pending.find((r) => r.id === id);
  if (!row) return;
  const t = fromMinutes(start),
    cost = scaled !== undefined && scaled !== row.c ? scaled : undefined,
    changes = { t, dur, ...(cost === undefined ? {} : { c: cost }) };
  dispatch(ctx, day, "editEntry", { id, changes }, row);
  ctx.toast(lengthToast(ctx, row, { t, dur }, cost), {
    label: "Undo",
    fn: () =>
      dispatch(
        ctx,
        day,
        "editEntry",
        {
          id,
          changes: {
            t: row.t ?? "",
            dur: row.dur ?? null,
            ...(cost === undefined ? {} : { c: row.c }),
          },
        },
        { ...row, ...changes },
      ),
  });
}
// What a change to an activity's time slot says, including what happened to its points when its length changed.
export function lengthToast(ctx, row, next, cost) {
  const words = energyWords(themeOf(ctx)).plural;
  return spanOf(row)?.dur === next.dur
    ? `Moved ${row.a} to ${slotText(next)}.`
    : `${row.a} now ${slotText(next)}${cost === undefined ? "" : `, ${signed(row.c)} to ${signed(cost)} ${words}`}.`;
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
  const lengthPoints = followLength(ctx, $("plan-dur"), $("plan-cost"), $("plan-length-hint"));
  const days = () => Array.from({ length: span }, (_, i) => addDays(ctx.today(), i));
  // Opened from the timeline, the form floats over it as a sheet; from the buttons and the list it stays where it is.
  const sheet = sheetMode(form, {
    onCancel: () => $("plan-cancel").click(),
    labelledBy: "plan-form-title",
  });
  function openForm(entry = null, complete = false, { floating = false } = {}) {
    if (!writable(ctx)) return;
    editing = entry;
    completing = complete;
    if (floating) sheet.on();
    else sheet.off();
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
    lengthPoints.set(entry?.c, entry?.dur);
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
    lengthPoints.set(entry.c, suggestDuration(entry.a));
  });
  $("plan-cancel").addEventListener("click", () => {
    ctx.drafts?.remove(`plan:${date}`);
    closeForm();
  });
  $("plan-add").addEventListener("click", () => openForm());
  $("plan-start-add").addEventListener("click", () => openForm(null, false, { floating: true }));
  $("plan-span").addEventListener("change", (e) => {
    span = Number(e.target.value);
    date = ctx.today();
    closeForm();
    render();
  });
  const planFields = (plan) =>
    plan.date
      ? {
          date: plan.date,
          allowance: plan.allowance,
          status: plan.status,
          poorSleep: plan.poorSleep,
        }
      : undefined;
  $("plan-allowance").addEventListener("change", (e) => {
    const n = Number(e.target.value),
      f = model();
    if (!Number.isInteger(n) || n < 1 || n > 30 || f.logged || !writable(ctx)) {
      e.target.value = f.allowance; // the field has focus, so render() would leave a rejected number in it
      render();
      return;
    }
    // A number typed by hand replaces the kind-of-day choice that produced the old one.
    const typed = f.plan.status || f.plan.poorSleep ? { status: null, poorSleep: false } : {};
    // Choosing a kind of day and typing a number are both "set it to this": the last one wins, so a quick run of
    // changes cannot be refused as a conflict with the one just before it.
    dispatch(
      ctx,
      date,
      "patch",
      { date, allowance: n, ...typed },
      Object.keys(typed).length ? undefined : planFields(f.plan),
    );
  });
  // Green, amber, red and poor sleep take the same amounts off the budget as a check-in does, so a planned
  // day starts from what that kind of day will really have.
  function setDayType(status, poorSleep) {
    const f = model();
    if (f.logged || !writable(ctx)) return;
    const S = ctx.settings(),
      took =
        (status === "amber" ? S.amberPenalty : status === "red" ? S.redPenalty : 0) +
        (poorSleep ? S.sleepPenalty : 0),
      allowance = Math.min(30, Math.max(1, S.budget - took));
    dispatch(ctx, date, "patch", { date, allowance, status, poorSleep }, undefined);
  }
  $("plan-daytype").addEventListener("click", (e) => {
    const b = e.target.closest("[data-daytype]");
    if (b) setDayType(b.dataset.daytype, model().plan.poorSleep === true);
  });
  $("plan-poorsleep").addEventListener("change", (e) =>
    setDayType(model().plan.status || "green", e.target.checked),
  );
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
    $("plan-add").focus({ preventScroll: true });
    ctx.toast(wasCompleting ? "Logged." : "Plan saved.");
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
        lengthPoints.set(preset.c, suggestDuration(preset.a));
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
  function openDay(day) {
    date = day;
    closeForm();
    ctx.go("plan");
    render();
  }
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open-plan]");
    if (open) openDay(open.dataset.openPlan);
    const done = e.target.closest("#today-plan [data-plan-action='complete']");
    if (done) completePlanned(ctx, done.dataset.date, done.dataset.id);
  });
  // ---- the timeline: what each gesture on the calendar means for the plan ----
  const narrow = matchMedia("(max-width: 700px)"); // a phone shows one day at a time
  narrow.addEventListener("change", () => (placing === null ? render() : setPlacing(null)));
  const dayLabel = (d) =>
    d === ctx.today()
      ? "Today"
      : `${fmtDay(d, ctx.settings().locale).split(",")[0]} ${Number(d.slice(8))}`;
  let burst = null; // the last change to a block, so a run of arrow-key moves undoes as one
  const grid = createTimeGrid($("plan-board"), {
    editable: () => writable(ctx),
    onSelectDay(d) {
      date = d;
      closeForm();
      render();
    },
    onOpen({ date: d, id }) {
      const row = forecast(ctx.store.all(), d, ctx.settings()).pending.find((r) => r.id === id);
      if (!row) return;
      date = d;
      closeForm();
      render();
      openForm(row, false, { floating: true });
    },
    onCreate({ date: d, start }) {
      if (placing !== null) return place(placing, d, start);
      date = d;
      closeForm();
      render();
      openForm(null, false, { floating: true });
      $("plan-time").value = fromMinutes(start);
      $("plan-dur").value = String(Math.min(NEW_DUR, DAY - start));
    },
    onChange: (change) => moveBlock(change),
    onRemove: ({ date: d, id }) => removePlanned(ctx, d, id),
    onMenu: (at) => openBlockMenu(at),
    onDrop: (payload, at) => addPreset(payload.preset, at),
  });
  // ---- the right-click menu on a block: edit, duplicate, colour, points, remove ----
  function patchBlock(d, row, changes, message) {
    const undo = Object.fromEntries(Object.keys(changes).map((k) => [k, row[k] ?? null]));
    dispatch(ctx, d, "editEntry", { id: row.id, changes }, row);
    ctx.toast(message, {
      label: "Undo",
      fn: () =>
        dispatch(ctx, d, "editEntry", { id: row.id, changes: undo }, { ...row, ...changes }),
    });
  }
  function duplicateBlock(d, row) {
    const f = forecast(ctx.store.all(), d, ctx.settings());
    if (f.rows.length >= 200) return ctx.toast("That day already has 200 planned activities.");
    const copy = copyOf(row);
    dispatch(ctx, d, "addEntry", copy);
    ctx.toast(`Duplicated ${row.a}.`, {
      label: "Undo",
      fn: () => dispatch(ctx, d, "removeEntry", copy),
    });
  }
  function openBlockMenu({ date: d, id, x, y, el }) {
    const row = forecast(ctx.store.all(), d, ctx.settings()).pending.find((r) => r.id === id);
    if (!row || !writable(ctx)) return;
    showEntryMenu({
      x,
      y,
      el,
      row,
      edit() {
        date = d;
        closeForm();
        render();
        openForm(row, false, { floating: true });
      },
      duplicate: () => duplicateBlock(d, row),
      patch: (changes, message) => patchBlock(d, row, changes, message),
      remove: () => removePlanned(ctx, d, id),
    });
  }
  function moveBlock(c) {
    if (!writable(ctx)) return;
    const row = forecast(ctx.store.all(), c.fromDate, ctx.settings()).pending.find(
      (r) => r.id === c.id,
    );
    if (!row) return;
    const t = fromMinutes(c.start),
      again = burst?.id === row.id && c.source === "keyboard" && Date.now() - burst.at < 1500,
      // A run of arrow-key presses is scaled from where it began, so the rounding of each step does not add up.
      fresh = again ? scaleCost(burst.origin.row.c, spanOf(burst.origin.row)?.dur, c.dur) : c.cost,
      cost = fresh !== undefined && fresh !== row.c ? fresh : undefined;
    let moved = { ...row, t, dur: c.dur, ...(cost === undefined ? {} : { c: cost }) };
    if (c.fromDate === c.toDate)
      dispatch(
        ctx,
        c.toDate,
        "editEntry",
        { id: row.id, changes: { t, dur: c.dur, ...(cost === undefined ? {} : { c: cost }) } },
        row,
      );
    else {
      const target = forecast(ctx.store.all(), c.toDate, ctx.settings());
      if (target.rows.length >= 200)
        return ctx.toast("That day already has 200 planned activities.");
      if (target.rows.some((r) => r.id === row.id)) moved = { ...moved, id: uid() };
      // Add to the new day before removing from the old one: if the second step fails you see a copy, not a loss.
      dispatch(ctx, c.toDate, "addEntry", moved);
      dispatch(ctx, c.fromDate, "removeEntry", row);
    }
    const origin = again ? burst.origin : { date: c.fromDate, row };
    burst = { id: moved.id, origin, at: Date.now() };
    ctx.toast(
      c.fromDate === c.toDate
        ? lengthToast(ctx, row, moved, cost)
        : `Moved ${row.a} to ${dayLabel(c.toDate)}, ${slotText(moved)}.`,
      {
        label: "Undo",
        fn: () => restoreBlock(origin, c.toDate, moved),
      },
    );
  }
  function restoreBlock(origin, nowDate, moved) {
    if (!writable(ctx)) return;
    burst = null;
    if (origin.date === nowDate)
      dispatch(
        ctx,
        nowDate,
        "editEntry",
        {
          id: moved.id,
          changes: {
            t: origin.row.t ?? "",
            dur: origin.row.dur ?? null,
            ...(origin.row.c === moved.c ? {} : { c: origin.row.c }),
          },
        },
        moved,
      );
    else {
      dispatch(ctx, origin.date, "addEntry", origin.row);
      dispatch(ctx, nowDate, "removeEntry", moved);
    }
  }
  function addPreset(preset, at) {
    if (!writable(ctx)) return;
    if (forecast(ctx.store.all(), at.date, ctx.settings()).rows.length >= 200)
      return ctx.toast("That day already has 200 planned activities.");
    const entry = { id: uid(), a: preset.a, c: preset.c, t: fromMinutes(at.start), dur: at.dur };
    dispatch(ctx, at.date, "addEntry", entry);
    ctx.toast(`Added ${preset.a} at ${entry.t}.`, {
      label: "Undo",
      fn: () => dispatch(ctx, at.date, "removeEntry", entry),
    });
  }
  // Saved activities can be dragged onto the timeline with a mouse or pen. A click fills the form; on a phone, where a
  // finger scrolls rather than drags, a tap picks the activity and the next tap on the timeline places it.
  let placing = null; // the index of the picked activity in the person's list
  const palette = $("plan-palette");
  const indexOf = (target) => {
    const i = target.closest("[data-preset]")?.dataset.preset;
    return i === undefined ? null : Number(i);
  };
  const presetOf = (e) => ctx.settings().activities[indexOf(e.target)];
  function setPlacing(i) {
    placing = i;
    $("plan-placing").hidden = i === null;
    $("plan-board").toggleAttribute("data-placing", i !== null);
    $("plan-placing-text").textContent =
      i === null ? "" : `Choose a time on the timeline for ${ctx.settings().activities[i]?.a}.`;
    render();
  }
  function place(i, day, start) {
    const preset = ctx.settings().activities[i];
    setPlacing(null);
    if (preset)
      addPreset(preset, {
        date: day,
        start,
        dur: Math.min(suggestDuration(preset.a) ?? NEW_DUR, DAY - start),
      });
  }
  $("plan-placing-cancel").addEventListener("click", () => setPlacing(null));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && placing !== null && !root.hidden) setPlacing(null);
  });
  palette.addEventListener("pointerdown", (e) => {
    const preset = e.pointerType === "touch" || e.button > 0 ? null : presetOf(e);
    if (preset) grid.beginExternalDrag(e, { preset, dur: suggestDuration(preset.a) ?? NEW_DUR });
  });
  palette.addEventListener("click", (e) => {
    const preset = presetOf(e);
    if (!preset || grid.justDropped() || !writable(ctx)) return;
    if (narrow.matches) {
      const i = indexOf(e.target);
      closeForm();
      setPlacing(placing === i ? null : i);
      if (placing !== null) $("plan-board").scrollIntoView({ block: "nearest" });
      return;
    }
    closeForm();
    openForm();
    $("plan-name").value = preset.a;
    $("plan-cost").value = preset.c;
    $("plan-dur").value = suggestDuration(preset.a) ?? "";
    lengthPoints.set(preset.c, suggestDuration(preset.a));
  });

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
    // A save landing while the number is being typed must not put the old value back under the cursor.
    if (document.activeElement !== $("plan-allowance")) $("plan-allowance").value = f.allowance;
    $("plan-allowance").disabled = f.logged || !writable(ctx);
    $("plan-allowance-hint").textContent = f.logged
      ? "Uses this day’s logged allowance. Adjust check-in and sleep in Today."
      : `Starts at your full ${ctx.settings().budget}. Pick the kind of day you expect to take off your Amber, Red or poor-sleep amount, or type your own number.`;
    {
      const S = ctx.settings(),
        shown = f.plan.status || (Number.isInteger(f.plan.allowance) ? "" : "green");
      $("plan-daytype").hidden = f.logged;
      for (const b of $("plan-daytype").querySelectorAll("[data-daytype]")) {
        b.setAttribute("aria-pressed", String(b.dataset.daytype === shown));
        b.disabled = !writable(ctx);
      }
      $("plan-day-amber").textContent = `Amber −${S.amberPenalty}`;
      $("plan-day-red").textContent = `Red −${S.redPenalty}`;
      $("plan-poorsleep").checked = f.plan.poorSleep === true;
      $("plan-poorsleep").disabled = !writable(ctx);
      $("plan-poorsleep-text").textContent = `Poor sleep −${S.sleepPenalty}`;
    }
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
    // The timeline: every planned activity of the days in view (just the chosen day on a phone).
    const forecastOf = (d) =>
      forecasts[dates.indexOf(d)] ?? forecast(ctx.store.all(), d, ctx.settings());
    grid.render({
      editable: writable(ctx),
      days: (narrow.matches ? [date] : dates).map((d) => {
        const m = forecastOf(d);
        return {
          date: d,
          label: dayLabel(d),
          value: m.rows.length || m.logged ? String(m.projected) : "—",
          today: d === ctx.today(),
          selected: d === date,
          warn: m.afterWork < 0,
          blocks: m.rows.map((e) => ({
            id: e.id,
            title: e.a,
            cost: e.c,
            t: e.t,
            dur: e.dur,
            kind: "plan",
            tone: TONES.some((t) => t.id === e.col) ? e.col : undefined,
            done: m.done.includes(e),
            editable: !m.done.includes(e),
            removable: !m.done.includes(e),
          })),
        };
      }),
    });
    const acts = ctx.settings().activities;
    $("plan-board-help").textContent = narrow.matches
      ? "Tap an activity, then a time to add it. Use the handle on a block to move it; to change how long it takes, press and hold its bottom edge, then drag: the points follow."
      : "Drag an activity to move it, or drag its edge to change how long it takes: the points follow. Click an empty space to add one.";
    setStable(
      $("plan-palette"),
      acts.length
        ? html`<h3 class="label">${narrow.matches ? "Tap one, then a time" : "Drag onto the timeline"}</h3>${acts.map((e, i) => html`<button type="button" class="cal-chip cal-preset${e.c < 0 ? " is-recovery" : ""}" data-preset="${i}"${narrow.matches ? html` aria-pressed="${placing === i ? "true" : "false"}"` : ""}>${e.a}<span>${signed(e.c)}</span></button>`)}`
        : html``,
    );
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
    openDay,
    hide() {
      rememberDraft();
      closeForm();
    },
    snapshot: () => ({ date, span }),
  };
}
