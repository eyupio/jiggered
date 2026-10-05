// New captures and edits have separate device drafts; a server acknowledgement completes a save.
import { $, html, setHTML, saveFeedback, fmtWhen } from "./util.js";
import { PICKER, usage, favourites, matches } from "./picker.js";
import {
  ONSET,
  DURATIONS,
  nowLocal,
  readableEpisode,
  ongoingEpisodes,
  validateEpisodeTimes,
} from "./model.js";

export function renderOngoing(ctx, el) {
  const items = ongoingEpisodes(ctx.store.all());
  el.hidden = !items.length;
  setHTML(
    el,
    html`<h2>Still going (${items.length})</h2>${items.slice(0, 10).map(([id, e]) => html`<div class="ongoing-item"><p>${fmtWhen(e.when, ctx.settings().locale)} · ${e.symptoms.join(", ") || "Episode"}</p><div class="row"><button class="secondary" data-end-episode-now="${id}">Ended just now</button><button class="secondary" data-finish-episode="${id}">Ended earlier…</button></div></div>`)}${items.length > 10 ? html`<p>More ongoing episodes are in History.</p>` : ""}`,
  );
}

// The usual way an episode ends is "it just stopped": one tap, with the length worked out from when it started.
// Anything more exact goes through the form ("Ended earlier…").
export function endEpisodeNow(ctx, id) {
  const e = ctx.store.view(id);
  if (!e) return;
  const now = new Date(),
    start = Number.isFinite(e.whenOffset)
      ? Date.parse(e.when + "Z") - e.whenOffset * 60000
      : new Date(e.when).getTime(),
    minutes = (now.getTime() - start) / 60000;
  if (!Number.isFinite(minutes) || minutes < 0) return;
  const duration =
    minutes < 15
      ? "Under 15 min"
      : minutes < 60
        ? "15–60 min"
        : minutes < 240
          ? "1–4 hours"
          : minutes < 720
            ? "4–12 hours"
            : minutes < 1440
              ? "Most of a day"
              : "Over a day";
  const patch = {
    duration,
    endedAt: nowLocal(),
    endZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    endOffset: -now.getTimezoneOffset(),
  };
  // What the server copy has now, for conflict checks (missing stays missing), and what an Undo writes back.
  const was = {
    duration: e.duration,
    endedAt: e.endedAt,
    endZone: e.endZone,
    endOffset: e.endOffset,
  };
  const undo = { duration: "Still going", endedAt: "", endZone: "", endOffset: null };
  const change = (arg, from) =>
    ctx.store.dispatch({
      id,
      type: "patch",
      arg,
      original: ctx.store.view(id),
      before: Object.fromEntries(Object.keys(arg).map((k) => [k, from[k]])),
    });
  change(patch, was);
  ctx.toast(`Episode ended (${duration.toLowerCase()}).`, {
    label: "Undo",
    fn: () => change(undo, patch),
  });
}

// "Still going" is only a sensible default for something that started just now; for anything older the person chooses.
export function defaultDuration(when, now = new Date()) {
  const start = new Date(when);
  return Number.isFinite(start.getTime()) && now - start >= -60_000 && now - start <= 30 * 60_000
    ? "Still going"
    : "";
}

export function init(ctx) {
  const saved = ctx.ui?.get("episode") || {};
  const find = { sym: { q: "", all: false, group: "" }, trig: { q: "", all: false, group: "" } }; // search text, "show all" and chosen group per long list
  let durChosen = false; // the person picked a duration themselves, so a changed start time no longer re-defaults it
  let editing = null,
    dirty = false,
    chipsKey = "",
    ticket = null,
    original = {},
    submitted = null,
    origin = ""; // the tab an edit was started from; its back button returns there
  // Drafts are dropped seven days after the last change (see createDrafts in device.js).
  const keepUntil = (at) =>
    new Date(at + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(ctx.settings().locale || undefined, {
      day: "numeric",
      month: "short",
    });
  const TAB_NAMES = { history: "History", today: "Today", plan: "Plan", account: "Account" };
  const form = $("epform"),
    drafts = ctx.drafts;
  const slot = () => (editing ? `episode-edit:${editing}` : "episode-new");
  const picked = (name) =>
    [...form.querySelectorAll(`input[name=${name}]:checked`)].map((i) => i.value);
  const body = () => ({
    when: $("ep-when").value,
    symptoms: picked("sym"),
    onset: picked("onset")[0] || "",
    duration: $("ep-dur").value,
    endedAt: $("ep-ended").value,
    before: picked("trig"),
    notes: $("ep-notes").value,
  });
  const remember = () => {
    if (dirty) drafts?.put(slot(), { body: body(), original, submitted });
  };
  // Long lists: the most and latest used come first, the rest wait behind "Show all" or a search. Chips that are
  // selected always stay visible, and every chip stays in the form so nothing selected is ever lost.
  function chips(el, list, name, type, extra = [], keep = picked(name), favs = [], groups = {}) {
    const names = [...new Set([...list, ...extra, ...keep])],
      ordered = [
        ...favs.filter((f) => names.includes(f)),
        ...names.filter((f) => !favs.includes(f)),
      ];
    setHTML(
      $(el),
      html`${ordered.map((t, i) => html`<label class="chip${favs.includes(t) ? " fav" : ""}" data-group="${Object.hasOwn(groups, t) ? groups[t] : ""}"><input type="${type}" name="${name}" id="${name}-${i}" value="${t}"${keep.includes(t) ? " checked" : ""}><span>${t}</span></label>`)}`,
    );
    if (type === "checkbox") narrow(name);
  }
  function narrow(name) {
    const box = $("ep-" + name),
      all = [...box.querySelectorAll(".chip")],
      st = find[name],
      long = all.length > PICKER.searchFrom,
      collapsible = all.length > PICKER.chipsAll;
    $(`ep-${name}-q-row`).hidden = !long;
    const q = long ? st.q.trim() : "";
    // Group buttons, like Today's: one tap narrows the list to a group. Ungrouped items gather under "Other".
    const groupOf = (c) => c.dataset.group || "Other",
      counts = new Map();
    for (const c of all) counts.set(groupOf(c), (counts.get(groupOf(c)) || 0) + 1);
    if (st.group && !counts.has(st.group)) st.group = "";
    const g = counts.size > 1 ? st.group : "",
      names = [...counts].sort(([a], [b]) => (a === "Other") - (b === "Other"));
    const bar = $(`ep-${name}-filter`),
      sig = JSON.stringify([names, g]);
    bar.hidden = counts.size < 2;
    if (bar.dataset.sig !== sig) {
      bar.dataset.sig = sig;
      setHTML(
        bar,
        html`<button type="button" class="pill" data-filter="" aria-pressed="${!g}">All <span class="meta">${all.length}</span></button>${names.map(([n, c]) => html`<button type="button" class="pill" data-filter="${n}" aria-pressed="${g === n}">${n} <span class="meta">${c}</span></button>`)}`,
      );
    }
    let shown = 0;
    for (const c of all) {
      const on =
        c.querySelector("input").checked ||
        (q
          ? matches(q, c.textContent) && (!g || groupOf(c) === g)
          : g
            ? groupOf(c) === g
            : !collapsible || st.all || shown < PICKER.chipPage);
      c.hidden = !on;
      if (on) shown++; // selected chips use up page slots too, so ticking one never makes another appear
    }
    const hiddenCount = all.filter((c) => c.hidden).length,
      more = $(`ep-${name}-more`),
      noun = name === "sym" ? "symptoms" : "triggers";
    more.hidden = !collapsible || q || g || (!st.all && !hiddenCount);
    more.textContent = st.all
      ? "Show fewer"
      : `Show all ${all.length} ${noun} (${hiddenCount} more)`;
    box.dataset.empty = q && all.every((c) => c.hidden) ? "1" : "";
    // One line that says what is on screen, so a long list never feels like items have gone missing.
    const picked = all.filter((c) => c.querySelector("input").checked).length,
      visible = all.length - hiddenCount;
    const where = q
      ? `${visible - picked} ${visible - picked === 1 ? "match" : "matches"} for “${q}”${g ? ` in ${g}` : ""}`
      : g
        ? `${g}: ${counts.get(g)} of ${all.length} ${noun}`
        : collapsible && !st.all
          ? `Showing ${visible} of ${all.length}`
          : `${all.length} ${noun}`;
    $(`ep-${name}-status`).hidden = !long && !picked;
    $(`ep-${name}-count`).textContent = long
      ? where + (picked ? ` · ${picked} selected` : "")
      : `${picked} selected`;
    $(`ep-${name}-clear`).hidden = !picked;
  }
  function build(ep = null) {
    const S = ctx.settings(),
      use = usage(ctx.store.all(), ctx.today()),
      fs = favourites(S.symptoms, use.sym),
      ft = favourites(S.triggers, use.trig),
      k = JSON.stringify([
        S.symptoms,
        S.triggers,
        S.symptomGroups,
        S.triggerGroups,
        fs,
        ft,
        editing,
        ep?.symptoms,
        ep?.before,
      ]);
    if (k === chipsKey) return;
    chipsKey = k;
    chips(
      "ep-sym",
      S.symptoms,
      "sym",
      "checkbox",
      ep?.symptoms || [],
      undefined,
      fs,
      S.symptomGroups,
    );
    chips("ep-onset", ONSET, "onset", "radio");
    chips(
      "ep-trig",
      S.triggers,
      "trig",
      "checkbox",
      ep?.before || [],
      undefined,
      ft,
      S.triggerGroups,
    );
    const current = $("ep-dur").value;
    setHTML(
      $("ep-dur"),
      html`<option value="" disabled>Choose how long it lasted</option>${[...new Set([...DURATIONS, ...(ep?.duration ? [ep.duration] : [])])].map((d) => html`<option>${d}</option>`)}`,
    );
    $("ep-dur").value = current;
  }
  function fill(value) {
    const ep = readableEpisode(value);
    chipsKey = "";
    build(ep);
    $("ep-when").value = ep.when || nowLocal();
    for (const name of ["sym", "onset", "trig"]) {
      const values = name === "sym" ? ep.symptoms : name === "trig" ? ep.before : [ep.onset];
      form.querySelectorAll(`input[name=${name}]`).forEach((i) => {
        i.checked = values.includes(i.value);
      });
    }
    $("ep-dur").value = ep.duration || defaultDuration($("ep-when").value);
    $("ep-ended").value = ep.endedAt || "";
    $("ep-notes").value = ep.notes;
    narrow("sym");
    narrow("trig");
  }
  function restore(id = null) {
    editing = id;
    ticket = null;
    submitted = null;
    durChosen = false;
    for (const name of ["sym", "trig"]) {
      find[name].q = "";
      find[name].all = false;
      find[name].group = "";
    }
    const draft = drafts?.get(slot());
    original = draft?.original || (id ? ctx.store.view(id) || {} : {});
    dirty = !!draft;
    form.reset();
    fill(draft?.body || original);
    durProblem("");
    submitted = draft?.submitted || null;
    if (submitted) ticket = { n: submitted.n };
    const savedAt = drafts?.list().find((d) => d.name === slot())?.at;
    $("eptoast").textContent =
      draft && !submitted
        ? `Unfinished draft restored from this device.${savedAt ? ` It stays until ${keepUntil(savedAt)}, seven days after your last change.` : ""}`
        : "";
    render();
  }
  function edit(id, recovered = null, finish = false) {
    const from = ctx.tab();
    remember();
    if (!ctx.store.view(id) && !recovered && !drafts?.get(`episode-edit:${id}`)) return;
    restore(id);
    if (recovered) {
      fill(recovered);
      dirty = true;
      submitted = ticket = null;
      remember();
    }
    origin = from !== "episode" && TAB_NAMES[from] ? from : "";
    ctx.go("episode");
    if (finish) {
      $("ep-dur").focus();
      $("eptoast").textContent =
        "Choose a duration, or Ended (duration unknown). An exact end time is optional.";
    }
  }
  function finishSave() {
    if (!ticket) return;
    const result = saveFeedback(ctx.store, ticket, $("eptoast"));
    $("ep-save").disabled = result === "pending" || result === "failed";
    if (result === "discarded") {
      ticket = submitted = null;
      remember();
      return;
    }
    if (result !== "saved") return;
    drafts?.remove(slot());
    dirty = false;
    const record = submitted ? ctx.store.view(submitted.id) : null;
    submitted = ticket = null;
    if (editing) {
      $("ep-save").disabled = false;
      original = ctx.store.view(editing) || original;
    } else {
      form.reset();
      chipsKey = "";
      fill({});
      $("ep-save").disabled = false;
      // Say what was recorded, and bring the person back to where the message and the new "Still going" panel are.
      if (record)
        $("eptoast").textContent =
          `Saved. ${fmtWhen(record.when, ctx.settings().locale)} · ${(record.symptoms || []).join(", ") || "no symptoms ticked"}.`;
      window.scrollTo({ top: 0 });
    }
  }
  for (const name of ["sym", "trig"]) {
    $(`ep-${name}-q`).addEventListener("input", (e) => {
      find[name].q = e.target.value;
      narrow(name);
    });
    $(`ep-${name}-q`).addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    }); // Enter must not save the episode
    $(`ep-${name}-filter`).addEventListener("click", (e) => {
      const b = e.target.closest("[data-filter]");
      if (!b) return;
      find[name].group = b.dataset.filter === find[name].group ? "" : b.dataset.filter;
      narrow(name);
      [...$(`ep-${name}-filter`).children]
        .find((x) => x.dataset.filter === find[name].group)
        ?.focus(); // keep keyboard position after the buttons are rebuilt
    });
    $(`ep-${name}-clear`).addEventListener("click", () => {
      const boxes = [...form.querySelectorAll(`input[name=${name}]:checked`)];
      boxes.forEach((i) => {
        i.checked = false;
      });
      boxes[0]?.dispatchEvent(new Event("input", { bubbles: true })); // marks the draft as changed
      narrow(name);
      $(`ep-${name}-q`).focus();
    });
    $(`ep-${name}-more`).addEventListener("click", () => {
      find[name].all = !find[name].all;
      narrow(name);
    });
  }
  $("ep-dur").addEventListener("change", () => {
    durChosen = true;
  });
  const durProblem = (text) => {
    $("ep-dur-hint").textContent = text;
    if (text) $("ep-dur").setAttribute("aria-invalid", "true");
    else $("ep-dur").removeAttribute("aria-invalid");
  };
  $("ep-when").addEventListener("change", () => {
    if (!editing && !durChosen) {
      const had = $("ep-dur").value;
      $("ep-dur").value = defaultDuration($("ep-when").value);
      // Moving the start back clears "Still going"; say so, or Save looks as if it does nothing.
      if (had && !$("ep-dur").value)
        durProblem("You changed the start time, so choose how long it lasted.");
      renderEnd();
    }
  });
  $("ep-dur").addEventListener("change", () => durProblem(""));
  form.addEventListener("change", (e) => {
    if (e.target.name === "sym" || e.target.name === "trig") narrow(e.target.name);
  });
  form.addEventListener("input", (e) => {
    if (e.target.type === "search") return;
    // A complaint is about the form as it was: once it is being corrected it goes, rather than turning green.
    if ($("eptoast").classList.contains("err")) $("eptoast").textContent = "";
    $("eptoast").classList.remove("err");
    if (ticket && ctx.store.outcome(ticket.n) === "failed") ticket = submitted = null;
    dirty = true;
    remember();
    render();
  });
  $("episode-draft-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-draft]");
    if (!b) return;
    remember();
    restore(b.dataset.draft === "episode-new" ? null : b.dataset.draft.slice(13));
  });
  // Single-answer chips can be cleared: pressing the one that is already ticked unticks it.
  const onset = $("ep-onset");
  const onsetInput = (e) => e.target.closest("input[name=onset]");
  let wasTicked = null;
  onset.addEventListener("pointerdown", (e) => {
    const i = onsetInput(e) || e.target.closest("label")?.querySelector("input[name=onset]");
    wasTicked = i?.checked ? i : null;
  });
  onset.addEventListener("click", (e) => {
    const i = onsetInput(e);
    if (i && i === wasTicked) {
      i.checked = false;
      i.dispatchEvent(new Event("change", { bubbles: true }));
    }
    wasTicked = null;
  });
  onset.addEventListener("keydown", (e) => {
    const i = onsetInput(e);
    if (e.key === " " && i?.checked) {
      e.preventDefault();
      i.checked = false;
      i.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  $("ep-cancel").addEventListener("click", () => {
    remember();
    restore(null);
    if (origin) {
      const back = origin;
      origin = "";
      ctx.go(back); // an edit that began in History or Today ends there
    }
  });
  $("ep-discard").addEventListener("click", () => {
    if (dirty && !confirm("Delete this draft? It has not been saved to your account yet.")) return;
    drafts?.remove(slot());
    restore(null);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const note = (text, bad = true) => {
      $("eptoast").textContent = text;
      $("eptoast").classList.toggle("err", bad);
    };
    $("eptoast").classList.remove("err");
    if (ticket) return;
    if (!editing && !dirty)
      return note("Nothing to save yet. Tick what you noticed or add a note.");
    const value = body();
    if (!editing && !value.symptoms.length && !value.notes.trim())
      return note(
        "Tick at least one symptom or write a note, so this episode means something later.",
      );
    if (!value.duration) {
      note("Choose how long it lasted, or Still going if it hasn't stopped.");
      durProblem("Choose how long it lasted, or Still going.");
      $("ep-dur").focus();
      return;
    }
    if (value.duration === "Still going") value.endedAt = "";
    const timeError = validateEpisodeTimes(value, original);
    if (timeError) {
      note(timeError[1]);
      $(timeError[0]).focus();
      return;
    }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!editing || value.when !== original.when) {
      value.whenZone = zone;
      value.whenOffset = -new Date(value.when).getTimezoneOffset();
    }
    if (value.endedAt && value.endedAt !== original.endedAt) {
      value.endZone = zone;
      value.endOffset = -new Date(value.endedAt).getTimezoneOffset();
    }
    if (!value.endedAt) {
      value.endZone = "";
      value.endOffset = null;
    }
    const id =
      editing || "e-" + Date.now() + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const patch = editing
      ? Object.fromEntries(
          Object.entries(value).filter(
            ([key, v]) => JSON.stringify(v) !== JSON.stringify(original[key]),
          ),
        )
      : value;
    if (editing && !Object.keys(patch).length) {
      note("No changes to save.", false);
      return;
    }
    // onChange runs during dispatch; ticket is available once dispatch returns.
    ticket = ctx.store.dispatch({
      id,
      type: editing ? "patch" : "replace",
      arg: patch,
      ...(editing
        ? { original, before: Object.fromEntries(Object.keys(patch).map((k) => [k, original[k]])) }
        : {}),
    });
    submitted = { id, n: ticket.n };
    remember();
    render();
    ticket.then(() => render());
  });
  function renderEnd() {
    $("ep-ended-row").hidden = !$("ep-dur").value || $("ep-dur").value === "Still going";
  }
  function render() {
    build(editing ? original : null);
    renderEnd();
    $("ep-when").max = !editing || !Number.isFinite(original.whenOffset) ? nowLocal() : "";
    $("ep-ended").max = !editing || !Number.isFinite(original.endOffset) ? nowLocal() : "";
    // The page heading already says "Log a symptom episode"; this one only appears to say it is an edit.
    $("ep-title").textContent = editing ? "Edit episode" : "Log an episode";
    $("ep-title").hidden = !editing;
    $("ep-save").textContent = editing ? "Save changes" : "Save episode";
    $("ep-cancel").hidden = !editing;
    $("ep-cancel").textContent = origin ? `Back to ${TAB_NAMES[origin]}` : "Back to new episode";
    $("ep-discard").hidden = !dirty;
    finishSave();
    const waiting = ticket && ctx.store.outcome(ticket.n) === "pending";
    form.querySelectorAll("input,select,textarea").forEach((el) => {
      el.disabled = !!waiting;
    });
    const unfinished = (drafts?.list() || []).filter(
      (d) => d.name.startsWith("episode-") && d.name !== slot(),
    );
    $("episode-drafts").hidden = !unfinished.length;
    setHTML(
      $("episode-draft-list"),
      html`${unfinished.map((d) => html`<p><button class="secondary" data-draft="${d.name}">${d.name === "episode-new" ? "Continue new episode" : "Continue edit"}</button> <span class="meta">${new Date(d.at).toLocaleString(ctx.settings().locale || undefined)} · kept until ${keepUntil(d.at)}</span></p>`)}`,
    );
    renderOngoing(ctx, $("episode-ongoing"));
  }
  const savedEditing =
    typeof saved.editing === "string" &&
    /^e-\d+$/.test(saved.editing) &&
    (ctx.store.view(saved.editing) || drafts?.get(`episode-edit:${saved.editing}`))
      ? saved.editing
      : null;
  restore(savedEditing);
  for (const name of ["sym", "trig"]) {
    const value = saved.find?.[name];
    if (!value) continue;
    find[name] = {
      q: typeof value.q === "string" ? value.q.slice(0, 2000) : "",
      group: typeof value.group === "string" ? value.group : "",
      all: value.all === true,
    };
    $(`ep-${name}-q`).value = find[name].q;
    narrow(name);
  }
  return {
    render,
    snapshot: () => ({ find, editing }),
    edit,
    recover: (id, value) => edit(id, value),
    show() {
      if (!editing && !dirty) {
        $("ep-when").value = nowLocal();
        if (!durChosen) $("ep-dur").value = defaultDuration($("ep-when").value);
      }
      render();
    },
    hide: remember,
  };
}
