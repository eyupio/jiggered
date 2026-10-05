// The Today tab: morning check-in, the points gauge, tapping activities. It can also show and edit a past day.

import { renderEnergyFlow } from "./energy-flow.js";
import {
  renderTodayPlan,
  completePlanned,
  reschedulePlanned,
  followLength,
  lengthToast,
  setStable,
} from "./planner.js";
import { createTimeGrid } from "./calendar.js";
import { forecast } from "./planner-model.js";
import { energyWords, energyAmount, energyCopy, themeOf, SPOON_PATH } from "./energy-theme.js";
import { $, html, setHTML, uid, fmtLongDay, signed } from "./util.js";
import {
  DAY,
  NEW_DUR,
  fromMinutes,
  scaleCost,
  slotText,
  spanOf,
  suggestDuration,
  toMinutes,
  validDur,
} from "./calendar-model.js";
import { normaliseProfile } from "./profile.js";
import { historyInsights } from "./history-model.js";
import { renderOngoing } from "./episodes.js";
import { PICKER, usage, favourites, groupItems, matches, selection } from "./picker.js";
import { savedText, savedCount } from "./view-state.js";
import { validDate } from "./history-model.js";
import {
  LIMITS,
  readableDay,
  identifyEntries,
  balanceLabel,
  ADVICE,
  dayId,
  used,
  capOf,
  hhmm,
  addDays,
  listDays,
} from "./model.js";

const named = (s) => s[0].toUpperCase() + s.slice(1);

export function init(ctx) {
  const saved = ctx.ui?.get("today") || {};
  const points = (n) => energyAmount(n, themeOf(ctx));
  const copy = (text) => energyCopy(text, themeOf(ctx));
  let viewDate = validDate(saved.day) && saved.day < ctx.today() ? saved.day : null; // null follows midnight
  let actsKey = "",
    editing = null,
    editingDate = "",
    query = savedText(saved.query),
    groupFilter = savedText(saved.groupFilter); // "" shows every group
  const more = new Map(
      (Array.isArray(saved.more) ? saved.more : [])
        .filter((row) => Array.isArray(row) && typeof row[0] === "string")
        .map(([key, count]) => [key, savedCount(count, PICKER.page)]),
    ),
    closed = new Set(
      (Array.isArray(saved.closed) ? saved.closed : []).filter((s) => typeof s === "string"),
    );
  $("act-search").value = query;
  if (/^\d{2}:\d{2}$/.test(saved.time || "")) $("act-time").value = saved.time;
  let changing = false,
    onboardingSeen = false; // re-choosing a check-in that is set; whether the first-run checklist showed this session
  const entryForm = $("entry-form");
  let pillsKey = "";

  const key = () => viewDate ?? ctx.today();
  const id = () => dayId(key());
  const day = () => {
    const d = readableDay(ctx.store.view(id()), key());
    return { ...d, entries: identifyEntries(d.entries) };
  };
  // Each change is an operation on the day, stamped with the budget in force so history keeps its own numbers.
  const op = (type, arg, before, target = id()) => {
    const S = ctx.settings();
    return ctx.store.dispatch({
      id: target,
      type,
      arg,
      before,
      original: ctx.store.view(id()),
      stamp: {
        budget: S.budget,
        sleepPenalty: S.sleepPenalty,
        amberPenalty: S.amberPenalty,
        redPenalty: S.redPenalty,
      },
    });
  };

  function open(date) {
    viewDate = date === ctx.today() ? null : date;
    editing = null;
    changing = false;
    entryForm.hidden = true;
    restoreDraft();
    render();
  }

  $("checkin").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    const was = day().status,
      next = was === b.dataset.s ? null : b.dataset.s,
      target = id();
    changing = false;
    op("setStatus", next);
    // A cleared or changed check-in changes the day's points, so it can always be taken back.
    if (was)
      ctx.toast(next ? `Changed to ${named(next)}.` : "Check-in cleared.", {
        label: "Undo",
        fn: () => op("setStatus", was, undefined, target),
      });
  });
  $("checkin-change").addEventListener("click", () => {
    changing = true;
    render();
    $("checkin").querySelector('[aria-pressed="true"]')?.focus();
  });
  // First-run checklist: the first two steps tick themselves from what is logged; the budget is set right here.
  function patchSettings(arg) {
    const raw = ctx.store.view("settings");
    if (!raw) return;
    return ctx.store.dispatch({
      id: "settings",
      type: "settingsPatch",
      arg,
      before: Object.fromEntries(Object.keys(arg).map((k) => [k, raw[k]])),
      original: raw,
    });
  }
  $("onboarding-keep").addEventListener("click", () => {
    patchSettings({
      onboarding: { ...(ctx.store.view("settings")?.onboarding || {}), budget: true },
    });
    render();
  });
  $("onboarding-dismiss").addEventListener("click", () => {
    patchSettings({
      onboarding: { ...(ctx.store.view("settings")?.onboarding || {}), dismissed: true },
    });
    onboardingSeen = false;
    render();
  });
  $("onboarding-budget").addEventListener("change", (e) => {
    const n = Math.round(Number(e.target.value)),
      S = ctx.settings();
    if (!Number.isInteger(n) || n < 1 || n > 30) {
      e.target.value = S.budget;
      return;
    }
    if (n === S.budget) return;
    // Penalties may not exceed the budget, so they shrink with it.
    patchSettings({
      budget: n,
      sleepPenalty: Math.min(S.sleepPenalty, n),
      amberPenalty: Math.min(S.amberPenalty, n),
      redPenalty: Math.min(S.redPenalty, n),
      onboarding: { ...(ctx.store.view("settings")?.onboarding || {}), budget: true },
    });
    const today = dayId(ctx.today());
    if (ctx.store.view(today))
      ctx.store.dispatch({
        id: today,
        type: "restamp",
        arg: { budget: n, sleepPenalty: Math.min(S.sleepPenalty, n) },
      });
    ctx.toast(
      `Daily ${energyWords(themeOf(ctx)).plural} set to ${n}. Change it any time in Account.`,
    );
  });
  $("act-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-filter]");
    if (!b) return;
    groupFilter = b.dataset.filter === groupFilter ? "" : b.dataset.filter;
    more.clear();
    render();
  });
  $("act-search").addEventListener("input", (e) => {
    query = e.target.value;
    more.clear();
    render();
  });
  $("acts").addEventListener("click", (e) => {
    const m = e.target.closest("[data-more]");
    if (m) {
      const s = m.dataset.more;
      more.set(
        s,
        (more.get(s) ?? PICKER.page) + (s === "search" ? PICKER.searchPage : PICKER.page),
      );
      render();
    }
  });
  $("acts").addEventListener(
    "toggle",
    (e) => {
      const g = e.target.dataset?.group;
      if (!g) return;
      if (e.target.open) closed.delete(g);
      else closed.add(g);
    },
    true,
  );
  $("sleep").addEventListener("change", (e) => op("setPoorSleep", e.target.checked));
  const logOne = (x) =>
    op("addEntry", {
      id: uid(),
      a: x.a,
      c: x.c,
      t: key() !== ctx.today() ? $("act-time").value : hhmm(new Date()),
    });
  // Takes the latest entry of that name off the day (what "−" does), with the same Undo as the entries list.
  function removeEntry(entry) {
    const index = day().entries.findIndex((x) => x.id === entry.id),
      target = id();
    op("removeEntry", entry);
    ctx.toast("Activity removed.", {
      label: "Undo removal",
      fn: () => ctx.store.dispatch({ id: target, type: "restoreEntry", arg: { entry, index } }),
    });
  }
  $("acts").addEventListener("click", (e) => {
    if (board.justDropped()) return;
    const step = e.target.closest("[data-step]");
    const b = step || e.target.closest("button.act");
    if (!b) return;
    const x = ctx.settings().activities[b.dataset.i];
    if (!x) return;
    if (!step || step.dataset.step === "1") {
      logOne(x);
      return;
    }
    const latest = day().entries.findLast((en) => en.a === x.a);
    if (latest) removeEntry(latest);
  });
  // ---- the day on a timeline: what each gesture on it means for the day ----
  const writable = () => !ctx.store.status().readOnly && !ctx.store.status().restoring;
  let burst = null; // the last change to a logged block, so a run of arrow-key moves undoes as one
  function moveLogged(entry, t, dur, keyboard, scaled) {
    const target = id(),
      again = keyboard && burst?.id === entry.id && Date.now() - burst.at < 1500,
      origin = again ? burst.origin : { t: entry.t, dur: entry.dur, c: entry.c },
      // A run of arrow-key presses is scaled from where it began, so the rounding of each step does not add up.
      fresh = again ? scaleCost(origin.c, spanOf(origin)?.dur, dur) : scaled,
      cost = fresh !== undefined && fresh !== entry.c ? fresh : undefined;
    op(
      "editEntry",
      { id: entry.id, changes: { t, dur, ...(cost === undefined ? {} : { c: cost }) } },
      entry,
    );
    burst = { id: entry.id, origin, at: Date.now() };
    ctx.toast(lengthToast(ctx, entry, { t, dur }, cost), {
      label: "Undo",
      fn: () => {
        burst = null;
        op(
          "editEntry",
          {
            id: entry.id,
            changes: { t: origin.t ?? "", dur: origin.dur ?? null, c: origin.c },
          },
          { ...entry, t, dur, ...(cost === undefined ? {} : { c: cost }) },
          target,
        );
      },
    });
  }
  const board = createTimeGrid($("today-board"), {
    editable: writable,
    onSelectDay() {},
    onOpen({ id: blockId }) {
      if (blockId.startsWith("plan:")) return completePlanned(ctx, key(), blockId.slice(5));
      const entry = day().entries.find((e) => e.id === blockId.slice(4));
      if (entry) fromTimeline(() => edit(entry));
    },
    // Clicking an empty space logs something at that time (the way to record what already happened): the activity
    // picked from the list above the timeline if there is one, otherwise a form.
    onCreate({ start }) {
      if (placing !== null) return place(placing, start);
      fromTimeline(() => {
        edit();
        $("entry-time").value = fromMinutes(start);
        $("entry-dur").value = String(Math.min(NEW_DUR, DAY - start));
      });
    },
    onChange(c) {
      if (c.id.startsWith("plan:"))
        return reschedulePlanned(ctx, key(), c.id.slice(5), c.start, c.dur, c.cost);
      const entry = day().entries.find((e) => e.id === c.id.slice(4));
      if (entry) moveLogged(entry, fromMinutes(c.start), c.dur, c.source === "keyboard", c.cost);
    },
    // An activity dragged here from the list is logged at the time it is dropped on.
    onDrop: (payload, at) => logAt(payload.preset, at.start, at.dur),
  });
  function logAt(preset, start, dur) {
    const target = id(),
      entry = { id: uid(), a: preset.a, c: preset.c, t: fromMinutes(start), dur };
    op("addEntry", entry);
    ctx.toast(`Logged ${entry.a} at ${entry.t}.`, {
      label: "Undo",
      fn: () => op("removeEntry", entry, undefined, target),
    });
  }
  // Open the form for something done from the timeline and, when it is finished, come back to the timeline.
  let returnTo = null;
  function fromTimeline(open) {
    const y = window.scrollY;
    open();
    returnTo = y;
  }
  function backToTimeline() {
    if (returnTo === null) return;
    window.scrollTo({ top: returnTo });
    returnTo = null;
  }

  // ---- placing an activity: pick it from the list above the timeline, then pick a time ----
  let placing = null; // the index of the picked activity in the person's list
  const palette = $("today-palette");
  const indexAt = (target) => {
    const i = target.closest("[data-preset]")?.dataset.preset;
    return i === undefined ? null : Number(i);
  };
  const activity = (i) => ctx.settings().activities[i];
  const lengthOf = (preset, start) => Math.min(suggestDuration(preset.a) ?? NEW_DUR, DAY - start);
  function setPlacing(i) {
    placing = i;
    $("today-placing").hidden = i === null;
    $("today-board").toggleAttribute("data-placing", i !== null);
    $("today-placing-text").textContent =
      i === null ? "" : `Choose a time on the timeline for ${activity(i)?.a}.`;
    renderTimeline(...timelineArgs);
  }
  function place(i, start) {
    const preset = activity(i);
    setPlacing(null);
    if (preset) logAt(preset, start, lengthOf(preset, start));
  }
  palette.addEventListener("pointerdown", (e) => {
    const preset = e.pointerType === "touch" || e.button > 0 ? null : activity(indexAt(e.target));
    if (preset) board.beginExternalDrag(e, { preset, dur: suggestDuration(preset.a) ?? NEW_DUR });
  });
  palette.addEventListener("click", (e) => {
    const i = indexAt(e.target);
    if (i === null || board.justDropped() || !writable()) return;
    setPlacing(placing === i ? null : i);
    if (placing !== null) $("today-board").scrollIntoView({ block: "nearest" });
  });
  $("today-placing-cancel").addEventListener("click", () => setPlacing(null));
  $("today-placing-now").addEventListener("click", () => {
    const preset = activity(placing);
    setPlacing(null);
    if (!preset) return;
    const nowAt = new Date();
    const start = Math.min(nowAt.getHours() * 60 + nowAt.getMinutes(), DAY - NEW_DUR);
    logAt(preset, start, lengthOf(preset, start));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && placing !== null && !$("today-panel").hidden) setPlacing(null);
  });
  // A mouse or pen can pick an activity up from the list; a tap still records it now.
  $("acts").addEventListener("pointerdown", (e) => {
    const tile = e.target.closest("button.act");
    const preset =
      tile && e.pointerType !== "touch" && e.button === 0
        ? ctx.settings().activities[tile.dataset.i]
        : null;
    if (preset) board.beginExternalDrag(e, { preset, dur: suggestDuration(preset.a) ?? NEW_DUR });
  });
  // A grid inside a closed disclosure cannot be measured, so it is drawn again when the disclosure is opened.
  const timeline = $("today-timeline-panel");
  let timelineArgs = null;
  timeline.addEventListener("toggle", () => {
    if (timeline.open && timelineArgs) renderTimeline(...timelineArgs);
  });
  function renderTimeline(d, S, left) {
    timelineArgs = [d, S, left];
    const k = key(),
      past = k !== ctx.today(),
      pending = forecast(ctx.store.all(), k, S).pending;
    const coarse = matchMedia("(pointer: coarse)").matches;
    $("today-timeline-help").textContent = coarse
      ? "What you have logged is solid; what is still planned is dashed. Tap an activity, then a time. Use the handle on a block to move it, and drag its bottom edge to change how long it took: the points follow."
      : "What you have logged is solid; what is still planned is dashed. Drag an activity onto the timeline, or click one and then a time. Drag a block to move it, or its edge to change how long it took: the points follow.";
    setStable(
      palette,
      S.activities.length
        ? html`<h3 class="label">Your activities</h3>${S.activities.map((a, i) => html`<button type="button" class="cal-chip cal-preset${a.c < 0 ? " is-recovery" : ""}" data-preset="${i}" aria-pressed="${placing === i}">${a.a}<span>${signed(a.c)}</span></button>`)}`
        : html``,
    );
    $("today-timeline-summary").textContent = pending.length
      ? `${d.entries.length} logged · ${pending.length} to do`
      : `${d.entries.length} logged`;
    board.render({
      editable: writable(),
      help: "Enter opens a logged activity to edit it, or marks a planned one as done. Up and down arrows move a block by 15 minutes, and Shift with Up or Down changes how long it lasts.",
      days: [
        {
          date: k,
          label: past ? fmtLongDay(k, S.locale) : "Today",
          value: `${left} left`,
          today: !past,
          selected: true,
          warn: left < 0,
          blocks: [
            ...d.entries.map((e) => ({
              id: "log:" + e.id,
              title: e.a,
              cost: e.c,
              t: e.t,
              dur: e.dur,
              kind: "logged",
              editable: true,
            })),
            ...pending.map((r) => ({
              id: "plan:" + r.id,
              title: r.a,
              cost: r.c,
              t: r.t,
              dur: r.dur,
              kind: "plan",
              editable: true,
              hint: "tap to finish",
            })),
          ],
        },
      ],
    });
  }
  function nameCount() {
    const count = [...$("entry-name").value.trim()].length;
    $("entry-name-count").textContent = `${count} / 60 characters`;
    $("entry-name-count").classList.toggle("err", count > 60);
    $("entry-name").setAttribute("aria-invalid", String(count > 60));
    $("entry-name").setCustomValidity(count > 60 ? "Use at most 60 characters." : "");
  }
  $("entry-name").addEventListener("input", nameCount);
  $("entry-save-choice").addEventListener(
    "change",
    () => ($("entry-group-row").hidden = !$("entry-save-choice").checked),
  );
  const lengthPoints = followLength(ctx, $("entry-dur"), $("entry-cost"), $("entry-length-hint"));
  function edit(entry = null) {
    editing = entry;
    editingDate = key();
    entryForm.hidden = false;
    $("entry-heading").textContent = entry ? "Edit activity" : "Other activity";
    $("entry-name").value = entry?.a || "";
    $("entry-cost").value = entry?.c ?? 1;
    $("entry-time").value = entry?.t ?? (key() === ctx.today() ? hhmm(new Date()) : "");
    $("entry-dur").value = entry?.dur ?? "";
    lengthPoints.set(entry?.c, entry?.dur);
    $("entry-msg").textContent = "";
    $("entry-save-choice-row").hidden = !!entry;
    $("entry-save-choice").checked = false;
    $("entry-group-row").hidden = true;
    $("entry-group").value = "";
    nameCount();
    $("entry-name").focus();
  }
  function restoreDraft() {
    const draft = ctx.drafts?.get(`activity:${id()}`);
    if (!draft) return;
    edit(draft.original);
    $("entry-name").value = draft.a;
    $("entry-cost").value = draft.c;
    $("entry-time").value = draft.t;
    $("entry-dur").value = draft.dur ?? "";
    $("entry-save-choice").checked = draft.saveChoice === true;
    $("entry-group").value = draft.group || "";
    $("entry-group-row").hidden = !$("entry-save-choice").checked;
    nameCount();
    $("entry-msg").textContent = "Unfinished activity draft restored.";
  }
  $("other-activity").addEventListener("click", () => edit());
  $("entry-cancel").addEventListener("click", () => {
    ctx.drafts?.remove(`activity:${id()}`);
    editing = null;
    entryForm.hidden = true;
    backToTimeline();
  });
  entryForm.addEventListener("input", () =>
    ctx.drafts?.put(`activity:${id()}`, {
      original: editing,
      a: $("entry-name").value,
      c: $("entry-cost").value,
      t: $("entry-time").value,
      dur: $("entry-dur").value,
      saveChoice: $("entry-save-choice").checked,
      group: $("entry-group").value,
    }),
  );
  entryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (editingDate !== key()) {
      render();
      ctx.toast("The day changed. Your unfinished activity is kept on the previous day.");
      return;
    }
    const original = ctx.store.view(id());
    const changes = {
      a: $("entry-name").value.trim(),
      c: Number($("entry-cost").value),
      t: $("entry-time").value,
    };
    if (
      !changes.a ||
      [...changes.a].length > 60 ||
      !Number.isInteger(changes.c) ||
      changes.c < -10 ||
      changes.c > 10
    ) {
      $("entry-msg").textContent = copy(
        "Use a name of 1–60 characters and whole-number points from −10 to 10.",
      );
      return;
    }
    const durText = $("entry-dur").value.trim(),
      dur = durText === "" ? null : Number(durText);
    if (dur !== null && !validDur(dur)) {
      $("entry-msg").textContent =
        "Use a whole number of minutes from 5 to 1440, or leave the duration empty.";
      return;
    }
    if (dur !== null && toMinutes(changes.t) !== null && toMinutes(changes.t) + dur > DAY) {
      $("entry-msg").textContent =
        "That would run past midnight. Start earlier or shorten the duration.";
      return;
    }
    if (dur !== null || editing?.dur != null) changes.dur = dur;
    const saveChoice = !editing && $("entry-save-choice").checked;
    const group = $("entry-group").value.trim();
    const settings = ctx.store.view("settings"),
      activities = ctx.settings().activities;
    if (
      saveChoice &&
      (activities.some((x) => x.a.toLowerCase() === changes.a.toLowerCase()) ||
        activities.length >= LIMITS.items)
    ) {
      $("entry-msg").textContent =
        "This name already exists, or your activity list is full. Untick Also add to record it once, or edit your list in Account.";
      return;
    }
    const previous = editing,
      target = id(),
      stamp = { budget: ctx.settings().budget, sleepPenalty: ctx.settings().sleepPenalty };
    if (previous && !day().entries.some((x) => x.id === previous.id)) {
      $("entry-msg").textContent =
        "This activity was removed. Cancel or log it as an Other activity.";
      return;
    }
    const changed = previous
      ? Object.fromEntries(Object.entries(changes).filter(([k, v]) => v !== previous[k]))
      : changes;
    const arg = previous ? { id: previous.id, changes: changed } : { id: uid(), ...changes };
    const ticket = op(previous ? "editEntry" : "addEntry", arg, previous);
    ctx.drafts?.remove(`activity:${target}`);
    editing = null;
    entryForm.hidden = true;
    backToTimeline();
    ctx.toast(
      previous ? "Activity correction queued." : "Activity queued.",
      previous
        ? {
            label: "Undo correction",
            fn: () =>
              ctx.store.dispatch({
                id: target,
                type: "editEntry",
                arg: {
                  id: previous.id,
                  changes: Object.fromEntries(
                    Object.keys(changed).map((k) => [
                      k,
                      previous[k] === undefined && k === "dur" ? null : previous[k],
                    ]),
                  ),
                },
                before: changes,
                original,
                stamp,
              }),
          }
        : undefined,
    );
    if (saveChoice) {
      const added = { id: uid(), a: changes.a, c: changes.c, ...(group ? { g: group } : {}) };
      const choice = ctx.store.dispatch({
        id: "settings",
        type: "settingsPatch",
        arg: { activities: [...activities, added] },
        before: { activities: settings?.activities },
        original: settings,
      });
      choice.then(() => {
        const failed = ctx.store.failures().some((f) => f.id === "settings");
        ctx.toast(
          failed
            ? "Activity captured separately. Your reusable choice needs attention in Recovery."
            : "Reusable activity choice queued separately; check saving status.",
        );
      });
    }
    await ticket;
  });
  function entryAction(e) {
    const b = e.target.closest("[data-entry]");
    if (!b) return;
    const entries = day().entries,
      index = entries.findIndex((x) => x.id === b.dataset.entry),
      entry = entries[index];
    if (!entry) return;
    if (b.dataset.action === "edit") {
      edit(entry);
      return;
    }
    removeEntry(entry);
    if (e.currentTarget.id === "energy-activity-pills") {
      const buttons = $("energy-activity-pills").querySelectorAll('[data-action="edit"]');
      (buttons[Math.min(index, buttons.length - 1)] || $("other-activity")).focus();
    }
  }
  $("entries").addEventListener("click", entryAction);
  $("energy-activity-pills").addEventListener("click", entryAction);

  $("day-prev").addEventListener("click", () => open(addDays(key(), -1)));
  $("day-next").addEventListener("click", () => {
    if (key() < ctx.today()) open(addDays(key(), 1));
  });
  $("day-back").addEventListener("click", () => open(ctx.today()));
  // The date reads in the person's own format; tapping it opens the native picker underneath.
  $("day-date")
    .closest("label")
    .addEventListener("click", (e) => {
      if (e.target === $("day-pick")) return;
      e.preventDefault();
      try {
        $("day-pick").showPicker();
      } catch {
        $("day-pick").focus();
      }
    });
  $("day-pick").addEventListener("change", (e) => {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= ctx.today()) open(v);
    else render();
  });

  const actButton = ({ item: x, i }) =>
    html`<button class="act${x.c < 0 ? " rec" : ""}" data-i="${i}"><span>${x.a}</span><span class="c">${signed(x.c)}<span class="sr-only"> ${energyWords(themeOf(ctx)).plural}</span></span><span class="activity-add" aria-hidden="true"><span>Record</span><b>+</b></span></button>`;
  // An activity already logged on this day: green, how many times, and − / + to take one off or add another.
  const selectedCard = (count, { item: x, i }) =>
    html`<div class="act on${x.c < 0 ? " rec" : ""}"><span class="name">${x.a}</span><span class="c">${signed(x.c)}<span class="sr-only"> ${energyWords(themeOf(ctx)).plural}</span></span><span class="stepper"><button type="button" class="step" data-step="-1" data-i="${i}" aria-label="Remove one ${x.a}">−</button><b class="count" aria-label="${count} ${count === 1 ? "time" : "times"} logged">×${count}</b><button type="button" class="step" data-step="1" data-i="${i}" aria-label="Add one more ${x.a}">+</button></span></div>`;
  // Long lists get a search box, a favourites row (most and latest used), sections by group and "Show more" paging.
  // Short lists look exactly as before. Buttons keep their index into the settings list, so tapping is unchanged.
  function renderActivities(S) {
    const all = groupItems(S.activities),
      names =
        all.length > 1 || all[0].name ? all.map((g) => ({ name: g.name, n: g.rows.length })) : [];
    if (groupFilter && !names.some((g) => g.name === groupFilter)) groupFilter = ""; // that group no longer exists
    const rows = groupFilter
        ? all.find((g) => g.name === groupFilter).rows
        : S.activities.map((item, i) => ({ item, i })),
      long = S.activities.length > PICKER.searchFrom;
    $("act-search-row").hidden = !long;
    const q = long ? query.trim() : "";
    // Favourites come from other days, so the row stays put while you log today.
    // A logged activity changes in place (green, ×count, − and +) rather than moving, so nothing shifts under a finger.
    const { count, selected } = selection(
      S.activities.map((item, i) => ({ item, i })),
      day().entries,
    );
    const favs =
      !q && !groupFilter && long
        ? favourites(
            rows.map((r) => r.item.a),
            usage(
              Object.fromEntries(Object.entries(ctx.store.all()).filter(([k]) => k !== id())),
              ctx.today(),
            ).acts,
          ).map((n) => rows.find((r) => r.item.a === n))
        : [];
    const found = q ? rows.filter((r) => matches(q, r.item.a + " " + (r.item.g || ""))) : rows;
    const sections = (
      q
        ? [{ key: "search", name: "", rows: found, size: PICKER.searchPage }]
        : groupFilter
          ? [{ key: "g:" + groupFilter, name: "", rows, size: PICKER.searchPage }]
          : all.map((g) => ({ key: "g:" + g.name, name: g.name, rows: g.rows, size: PICKER.page }))
    ).filter((s) => s.rows.length || (!q && !groupFilter && !s.name));
    const listKey = JSON.stringify([
      S.activities,
      themeOf(ctx),
      q,
      groupFilter,
      favs.map((f) => f.i),
      [...more],
      [...closed],
      long,
      selected.map((r) => [r.i, count.get(r.item.a)]),
    ]);
    if (listKey === actsKey) return; // only rebuild the buttons when something shown has changed
    actsKey = listKey;
    // One tap on a group narrows the list to it; tapping it again, or "All", brings everything back.
    $("act-filter").hidden = names.length < 2;
    setHTML(
      $("act-filter"),
      html`<button type="button" class="pill" data-filter="" aria-pressed="${!groupFilter}">All <span class="meta">${S.activities.length}</span></button>${names.map((g) => html`<button type="button" class="pill" data-filter="${g.name}" aria-pressed="${groupFilter === g.name}">${g.name} <span class="meta">${g.n}</span></button>`)}`,
    );
    const tile = (r) => (count.get(r.item.a) ? selectedCard(count.get(r.item.a), r) : actButton(r));
    const grid = (list) => html`<div class="acts">${list.map(tile)}</div>`;
    const part = (s) => {
      const shown = more.get(s.key) ?? s.size,
        hide = s.rows.length - shown;
      const body = html`${grid(s.rows.slice(0, shown))}${hide > 0 ? html`<button class="secondary small" data-more="${s.key}">Show ${Math.min(hide, s.size)} more of ${s.rows.length}</button>` : ""}`;
      return s.name
        ? html`<details class="act-group" data-group="${s.key}"${closed.has(s.key) ? "" : " open"}><summary>${s.name} <span class="meta">${s.rows.length}</span></summary>${body}</details>`
        : body;
    };
    setHTML(
      $("acts"),
      html`${favs.length ? html`<div class="act-fav"><h3 class="label">Frequent and recent</h3>${grid(favs)}</div>` : ""}${sections.map(part)}${q && !found.length ? html`<p class="empty">No activity matches${groupFilter ? ` in ${groupFilter}. Choose All to search every group` : ""}. Use Other activity to log it once.</p>` : ""}`,
    );
    $("noacts").hidden = S.activities.length > 0;
  }

  function render() {
    if (!entryForm.hidden && editingDate !== key()) {
      editing = null;
      entryForm.hidden = true;
    }
    const S = ctx.settings(),
      d = day(),
      k = key(),
      past = k !== ctx.today();
    const budget = d.budget ?? S.budget,
      spent = used(d),
      cap = capOf(d, S),
      left = cap - spent;

    $("day-label").textContent = past ? fmtLongDay(k, S.locale) : "Today";
    $("day-pick").value = k;
    $("day-date").textContent = past ? "Change day" : fmtLongDay(k, S.locale); // the person's date format, not the browser's
    $("day-pick").max = ctx.today();
    $("day-next").disabled = !past;
    $("day-notice").hidden = !past;
    $("act-time-row").hidden = !past;

    const collapsed = !!d.status && !changing;
    $("checkin").hidden = collapsed;
    $("checkin-done").hidden = !collapsed;
    if (collapsed) {
      const c = d.statusPenalty || 0;
      setHTML(
        $("checkin-done-text"),
        html`<span class="dot ${d.status}"></span><b>${named(d.status)}</b> · ${c ? `−${points(c)}` : copy("full points")}`,
      );
    }
    document.querySelectorAll("#checkin button").forEach((b) => {
      b.setAttribute("aria-pressed", b.dataset.s === d.status);
      const cost = S[b.dataset.s + "Penalty"] || 0; // green never costs anything
      b.querySelector(".cost").textContent = cost ? `−${points(cost)}` : copy("Full points");
    });
    const took = d.statusPenalty || 0;
    $("advice").textContent = d.status
      ? ADVICE[d.status] +
        (took
          ? ` ${d.status[0].toUpperCase() + d.status.slice(1)} takes ${points(took)} off ${past ? "this day" : "today"}.`
          : "")
      : past
        ? "No check-in for this day."
        : "How are you starting today? Pick one.";
    $("sleep").checked = !!d.poorSleep;
    const sleepCost = d.sleepPenalty ?? S.sleepPenalty,
      when = past ? "this day" : "today";
    $("sleep-title").textContent = past ? "Slept badly that night" : "Slept badly last night";
    $("sleep-label").textContent = !sleepCost
      ? copy("Recorded only: costs no points")
      : d.poorSleep
        ? `Taking ${points(sleepCost)} off ${when}`
        : `Takes ${points(sleepCost)} off ${when}`;
    setHTML($("left"), html`${left} <small>of ${cap}</small>`);
    $("balance-label").textContent = copy(balanceLabel(left, cap));
    document.querySelector(".energy-spoon").toggleAttribute("hidden", themeOf(ctx) !== "spoons");
    renderOngoing(ctx, $("today-ongoing"));
    $("spentline").textContent = spent >= 0 ? `${spent} net used` : `${-spent} net recovered`;

    // The ring is a view of the saved allowance, not a target. Keep the actual
    // number unbounded when recovery takes it above the allowance or spending below zero.
    const fraction = cap > 0 ? Math.max(0, Math.min(1, left / cap)) : 0;
    $("energy-progress").setAttribute("stroke-dasharray", `${fraction * 100} 100`);
    $("energy-visual").dataset.level =
      left < 0 ? "over" : left === 0 ? "empty" : left <= 3 ? "low" : "ready";
    $("energy-caption").textContent =
      left < 0
        ? "Beyond your planned allowance"
        : left > cap
          ? copy("Recovery added points back")
          : left === 0
            ? "Your balance, without judgement"
            : "Your own planning aid";
    $("energy-entry-count").textContent =
      `${d.entries.length} ${d.entries.length === 1 ? "activity" : "activities"} logged`;

    renderEnergyFlow(ctx, d, S);
    renderTodayPlan(ctx, k);
    const reserved = forecast(ctx.store.all(), k, S).committed;
    const cells = $("cells");
    // Updated in place so the bar eases between states instead of being rebuilt (which looked like a flash).
    cells.style.gridTemplateColumns = `repeat(${Math.min(budget, 15)},1fr)`;
    while (cells.children.length < budget)
      cells.append(Object.assign(document.createElement("div"), { className: "cell" }));
    while (cells.children.length > budget) cells.lastChild.remove();
    [...cells.children].forEach((c, i) => {
      if (themeOf(ctx) === "spoons" && !c.firstChild)
        setHTML(c, html`<svg viewBox="0 0 24 24"><path d="${SPOON_PATH}"/></svg>`);
      else if (themeOf(ctx) !== "spoons") c.replaceChildren();
      c.className =
        i >= cap
          ? "cell lost"
          : i >= Math.max(0, left)
            ? "cell spent"
            : i >= Math.max(0, left - reserved)
              ? "cell reserved"
              : "cell";
    });
    cells.className = "cells" + (left <= 0 ? " out" : left <= 3 ? " low" : "");

    renderActivities(S);
    renderOnboarding(S, past);
    renderWeekly(past);
    renderTimeline(d, S, left);

    $("activity-log").hidden = !d.entries.length;
    $("energy-activities").hidden = !d.entries.length;
    // Keep keyboard focus on unchanged pills when background sync re-renders Today.
    const nextPillsKey = JSON.stringify([key(), d.entries, themeOf(ctx)]);
    if (pillsKey !== nextPillsKey) {
      pillsKey = nextPillsKey;
      setHTML(
        $("energy-activity-pills"),
        html`${d.entries.map((e) => html`<li class="energy-activity-pill${e.c < 0 ? " recovery" : ""}"><button type="button" class="energy-activity-edit" data-entry="${e.id}" data-action="edit" aria-label="Edit ${e.a}${e.t ? ` at ${e.t}` : ""}" title="Edit ${e.a}"><span class="energy-activity-name">${e.a}</span><span class="energy-activity-detail">${slotText(e) ? html`<time>${slotText(e)}</time>` : ""}<b>${signed(e.c)}<span class="sr-only"> ${energyWords(themeOf(ctx)).plural}</span></b></span></button><button type="button" class="energy-activity-remove" data-entry="${e.id}" data-action="remove" aria-label="Remove ${e.a}${e.t ? ` at ${e.t}` : ""}" title="Remove ${e.a}"><span aria-hidden="true">×</span></button></li>`)}`,
      );
    }
    setHTML(
      $("entries"),
      html`${d.entries.map((e, i) => html`<li><div class="logged-activity"><span class="meta logged-time">${slotText(e) || "Time not set"}</span><span class="logged-name">${e.a}</span><b class="logged-cost">${signed(e.c)}<span class="sr-only"> ${energyWords(themeOf(ctx)).plural}</span></b></div><div class="logged-actions"><button type="button" class="secondary logged-edit" data-entry="${e.id}" data-action="edit" aria-label="Edit ${e.a}">Edit</button><button type="button" class="secondary logged-remove" data-entry="${e.id}" data-action="remove" aria-label="Remove ${e.a}">Remove</button></div></li>`)}`,
    );
  }

  function renderWeekly(past) {
    const raw = ctx.store.view("settings"),
      profile = normaliseProfile(raw?.profile),
      today = ctx.today();
    const weekday = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7,
      week = addDays(today, -weekday);
    const to = addDays(today, -1),
      from = addDays(to, -6),
      data = historyInsights(ctx.store.all(), ctx.settings(), today, { from, to });
    const visible =
      !past &&
      profile.weeklyReview &&
      profile.reviewDismissedWeek !== week &&
      data.metrics.checked >= 3;
    $("weekly-review").hidden = !visible;
    if (visible)
      setHTML(
        $("weekly-review"),
        html`<h2>Look back at your week</h2><p>${data.metrics.checked} of 7 days with check-ins · ${data.metrics.episodes} episodes · ${data.days.reduce((n, d) => n + d.entries.length, 0)} activities recorded. ${data.metrics.checked < 5 ? "Limited records for this period. " : ""}These counts describe your log.</p><div class="row"><button class="primary" data-review-open>Review these seven days</button><button class="secondary" data-review-dismiss>Not this week</button><button class="secondary" data-review-disable>Turn off weekly reviews</button></div>`,
      );
  }
  $("weekly-review").addEventListener("click", (e) => {
    const raw = ctx.store.view("settings"),
      profile = normaliseProfile(raw?.profile),
      today = ctx.today();
    const weekday = (new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7;
    if (e.target.closest("[data-review-open]")) {
      ctx.store.dispatch({
        id: "settings",
        type: "settingsPatch",
        arg: { profile: { ...profile, reviewDismissedWeek: addDays(today, -weekday) } },
        before: { profile: raw?.profile },
        original: raw,
      });
      const to = addDays(today, -1);
      ctx.openHistoryPeriod(addDays(to, -6), to);
    } else if (e.target.closest("[data-review-dismiss],[data-review-disable]")) {
      const next = {
        ...profile,
        ...(e.target.closest("[data-review-disable]")
          ? { weeklyReview: false }
          : { reviewDismissedWeek: addDays(today, -weekday) }),
      };
      ctx.store.dispatch({
        id: "settings",
        type: "settingsPatch",
        arg: { profile: next },
        before: { profile: raw?.profile },
        original: raw,
      });
    }
  });
  function renderOnboarding(S, past) {
    const raw = ctx.store.view("settings"),
      ob = raw?.onboarding || {},
      days = listDays(ctx.store.all());
    const checked = days.some((x) => x.status),
      logged = days.some((x) => x.entries.length),
      done = checked && logged;
    // Shown to an account that hasn't made its first check-in and log yet; once both are done it stays up, all ticked,
    // until the app is next opened, so it doesn't vanish under the person's finger.
    const show = !!raw && !ob.dismissed && !past && (!done || onboardingSeen);
    $("onboarding").hidden = !show;
    if (!show) return;
    onboardingSeen = true;
    $("onboarding-title").textContent = done
      ? "Your first records are ready. Allowance review is optional."
      : "Get started in under a minute";
    $("step-checkin").classList.toggle("done", checked);
    $("step-activity").classList.toggle("done", logged);
    $("step-budget").classList.toggle("done", !!ob.budget);
    if (document.activeElement !== $("onboarding-budget")) $("onboarding-budget").value = S.budget;
  }

  return {
    render,
    reopenSetup() {
      patchSettings({
        onboarding: { ...(ctx.store.view("settings")?.onboarding || {}), dismissed: false },
      });
      onboardingSeen = true;
      open(ctx.today());
    },
    open,
    day: () => viewDate,
    snapshot: () => ({
      day: viewDate,
      query,
      groupFilter,
      more: [...more],
      closed: [...closed],
      time: $("act-time").value,
    }),
    show() {
      if (entryForm.hidden) restoreDraft();
      render();
    },
  };
}
