// The Episode tab: log a symptom episode, or edit one (for instance to record when it ended).

import { $, html, setHTML } from "./util.js";
import { ONSET, DURATIONS, nowLocal } from "./model.js";

export function init(ctx) {
  let editing = null; // id of the episode being edited, or null for a new one
  let dirty = false;  // has anything been typed? if not, "when it started" is kept at the current time
  let chipsKey = "";
  const form = $("epform");

  const picked = name => [...document.querySelectorAll(`input[name=${name}]:checked`)].map(i => i.value);

  // Chips for the person's own symptom and trigger lists. Anything already ticked stays ticked when they are
  // rebuilt, and values from an episode being edited that are no longer on the lists still show up.
  function chips(el, list, name, type, extra = [], keep = picked(name)) {
    const items = [...list, ...extra.filter(x => !list.includes(x))];
    setHTML($(el), html`${items.map((t, i) => html`<label class="chip"><input type="${type}" name="${name}" id="${name}-${i}" value="${t}"${keep.includes(t) ? " checked" : ""}><span>${t}</span></label>`)}`);
  }

  function build(S, ep = null) {
    const k = JSON.stringify([S.symptoms, S.triggers, editing, ep && [ep.symptoms, ep.before]]);
    if (k === chipsKey) return;
    chipsKey = k;
    chips("ep-sym", S.symptoms, "sym", "checkbox", ep ? ep.symptoms : []);
    chips("ep-onset", ONSET, "onset", "radio");
    chips("ep-trig", S.triggers, "trig", "checkbox", ep ? ep.before : []);
    const dur = $("ep-dur"), cur = dur.value || DURATIONS[0];
    setHTML(dur, html`${[...DURATIONS, ...(ep && ep.duration && !DURATIONS.includes(ep.duration) ? [ep.duration] : [])].map(d => html`<option>${d}</option>`)}`);
    dur.value = cur;
  }

  function reset() {
    editing = null; dirty = false; chipsKey = "";
    form.reset();
    $("ep-when").value = nowLocal();
    $("ep-title").textContent = "Log an episode";
    $("ep-save").textContent = "Save episode";
    $("ep-cancel").hidden = true;
    build(ctx.settings());
  }

  function edit(id) {
    const ep = ctx.store.view(id);
    if (!ep) return;
    editing = id; dirty = true; chipsKey = "";
    build(ctx.settings(), ep);
    $("ep-when").value = ep.when;
    for (const name of ["sym", "onset", "trig"]) {
      const vals = name === "sym" ? ep.symptoms : name === "trig" ? ep.before : [ep.onset];
      document.querySelectorAll(`input[name=${name}]`).forEach(i => { i.checked = (vals || []).includes(i.value) });
    }
    $("ep-dur").value = ep.duration || DURATIONS[0];
    $("ep-notes").value = ep.notes || "";
    $("ep-title").textContent = "Edit episode";
    $("ep-save").textContent = "Save changes";
    $("ep-cancel").hidden = false;
    ctx.go("episode");
  }

  form.addEventListener("input", () => { dirty = true });
  $("ep-cancel").addEventListener("click", () => { reset(); ctx.go("history") });
  form.addEventListener("submit", e => {
    e.preventDefault();
    const body = {
      when: $("ep-when").value, symptoms: picked("sym"), onset: picked("onset")[0] || "",
      duration: $("ep-dur").value, before: picked("trig"), notes: $("ep-notes").value.trim(),
    };
    const wasEditing = editing;
    const id = editing ?? "e-" + Date.now();
    ctx.store.dispatch({ id, type: "replace", arg: { ...(wasEditing ? ctx.store.view(id) : {}), ...body } });
    reset();
    if (wasEditing) { ctx.toast("Changes saved."); ctx.go("history"); return }
    $("eptoast").textContent = "Episode saved.";
    setTimeout(() => { $("eptoast").textContent = "" }, 3000);
  });

  function render() { build(ctx.settings(), editing ? ctx.store.view(editing) : null) }

  return {
    render, edit,
    show() { if (!editing && !dirty) $("ep-when").value = nowLocal(); render() },
  };
}
