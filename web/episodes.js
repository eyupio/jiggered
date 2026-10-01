// New captures and edits have separate device drafts; a server acknowledgement completes a save.
import { $, html, setHTML, saveFeedback } from "./util.js";
import { ONSET, DURATIONS, nowLocal, readableEpisode, ongoingEpisodes, validateEpisodeTimes } from "./model.js";

export function renderOngoing(ctx, el) {
  const items = ongoingEpisodes(ctx.store.all());
  el.hidden = !items.length;
  setHTML(el, html`<h2>Still going (${items.length})</h2>${items.slice(0, 10).map(([id, e]) => html`<p>${e.when.replace("T", " ")} · ${e.symptoms.join(", ") || "Episode"} <button class="secondary" data-finish-episode="${id}">Record when it ended</button></p>`)}${items.length > 10 ? html`<p>More ongoing episodes are in History.</p>` : ""}`);
}

export function init(ctx) {
  let editing = null, dirty = false, chipsKey = "", ticket = null, original = {}, submitted = null;
  const form = $("epform"), drafts = ctx.drafts;
  const slot = () => editing ? `episode-edit:${editing}` : "episode-new";
  const picked = name => [...form.querySelectorAll(`input[name=${name}]:checked`)].map(i => i.value);
  const body = () => ({ when: $("ep-when").value, symptoms: picked("sym"), onset: picked("onset")[0] || "", duration: $("ep-dur").value, endedAt: $("ep-ended").value, before: picked("trig"), notes: $("ep-notes").value });
  const remember = () => { if (dirty) drafts?.put(slot(), { body: body(), original, submitted }) };
  function chips(el, list, name, type, extra = [], keep = picked(name)) {
    setHTML($(el), html`${[...new Set([...list, ...extra, ...keep])].map((t, i) => html`<label class="chip"><input type="${type}" name="${name}" id="${name}-${i}" value="${t}"${keep.includes(t) ? " checked" : ""}><span>${t}</span></label>`)}`);
  }
  function build(ep = null) {
    const S = ctx.settings(), k = JSON.stringify([S.symptoms, S.triggers, editing, ep?.symptoms, ep?.before]);
    if (k === chipsKey) return;
    chipsKey = k;
    chips("ep-sym", S.symptoms, "sym", "checkbox", ep?.symptoms || []);
    chips("ep-onset", ONSET, "onset", "radio");
    chips("ep-trig", S.triggers, "trig", "checkbox", ep?.before || []);
    const current = $("ep-dur").value || DURATIONS[0];
    setHTML($("ep-dur"), html`${[...new Set([...DURATIONS, ...(ep?.duration ? [ep.duration] : [])])].map(d => html`<option>${d}</option>`)}`);
    $("ep-dur").value = current;
  }
  function fill(value) {
    const ep = readableEpisode(value);
    chipsKey = ""; build(ep);
    $("ep-when").value = ep.when || nowLocal();
    for (const name of ["sym", "onset", "trig"]) {
      const values = name === "sym" ? ep.symptoms : name === "trig" ? ep.before : [ep.onset];
      form.querySelectorAll(`input[name=${name}]`).forEach(i => { i.checked = values.includes(i.value) });
    }
    $("ep-dur").value = ep.duration || DURATIONS[0];
    $("ep-ended").value = ep.endedAt || "";
    $("ep-notes").value = ep.notes;
  }
  function restore(id = null) {
    editing = id; ticket = null; submitted = null;
    const draft = drafts?.get(slot());
    original = draft?.original || (id ? ctx.store.view(id) || {} : {});
    dirty = !!draft;
    form.reset(); fill(draft?.body || original);
    submitted = draft?.submitted || null;
    if (submitted) ticket = { n: submitted.n };
    $("eptoast").textContent = draft && !submitted ? "Unfinished draft restored from this device." : "";
    render();
  }
  function edit(id, recovered = null, finish = false) {
    remember();
    if (!ctx.store.view(id) && !recovered && !drafts?.get(`episode-edit:${id}`)) return;
    restore(id);
    if (recovered) { fill(recovered); dirty = true; submitted = ticket = null; remember() }
    ctx.go("episode");
    if (finish) { $("ep-dur").focus(); $("eptoast").textContent = "Choose a duration, or Ended (duration unknown). An exact end time is optional." }
  }
  function finishSave() {
    if (!ticket) return;
    const result = saveFeedback(ctx.store, ticket, $("eptoast"));
    $("ep-save").disabled = result === "pending" || result === "failed";
    if (result === "discarded") { ticket = submitted = null; remember(); return }
    if (result !== "saved") return;
    drafts?.remove(slot()); dirty = false; submitted = ticket = null;
    if (editing) { $("ep-save").disabled = false; original = ctx.store.view(editing) || original }
    else { form.reset(); chipsKey = ""; fill({}); $("ep-save").disabled = false }
  }
  form.addEventListener("input", () => { if (ticket && ctx.store.outcome(ticket.n) === "failed") ticket = submitted = null; dirty = true; remember(); render() });
  $("episode-draft-list").addEventListener("click", e => { const b = e.target.closest("[data-draft]"); if (!b) return; remember(); restore(b.dataset.draft === "episode-new" ? null : b.dataset.draft.slice(13)) });
  $("ep-cancel").addEventListener("click", () => { remember(); restore(null) });
  $("ep-discard").addEventListener("click", () => {
    if (dirty && !confirm("Discard this unfinished draft? Queued changes are kept in recovery.")) return;
    drafts?.remove(slot()); restore(null);
  });
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (ticket || !editing && !dirty) return;
    const value = body();
    if (value.duration === "Still going") value.endedAt = "";
    const timeError = validateEpisodeTimes(value, original);
    if (timeError) { $("eptoast").textContent = timeError[1]; $(timeError[0]).focus(); return }
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!editing || value.when !== original.when) { value.whenZone = zone; value.whenOffset = -new Date(value.when).getTimezoneOffset() }
    if (value.endedAt && value.endedAt !== original.endedAt) { value.endZone = zone; value.endOffset = -new Date(value.endedAt).getTimezoneOffset() }
    if (!value.endedAt) { value.endZone = ""; value.endOffset = null }
    const id = editing || "e-" + Date.now() + String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const patch = editing ? Object.fromEntries(Object.entries(value).filter(([key, v]) => JSON.stringify(v) !== JSON.stringify(original[key]))) : value;
    if (editing && !Object.keys(patch).length) { $("eptoast").textContent = "No changes to save."; return }
    // onChange runs during dispatch; ticket is available once dispatch returns.
    ticket = ctx.store.dispatch({ id, type: editing ? "patch" : "replace", arg: patch, ...(editing ? { original, before: Object.fromEntries(Object.keys(patch).map(k => [k,original[k]])) } : {}) });
    submitted = { id, n: ticket.n }; remember(); render(); ticket.then(() => render());
  });
  function renderEnd() { $("ep-ended-row").hidden = $("ep-dur").value === "Still going" }
  function render() {
    build(editing ? original : null); renderEnd();
    $("ep-when").max = !editing || !Number.isFinite(original.whenOffset) ? nowLocal() : "";
    $("ep-ended").max = !editing || !Number.isFinite(original.endOffset) ? nowLocal() : "";
    $("ep-title").textContent = editing ? "Edit episode" : "Log an episode";
    $("ep-save").textContent = editing ? "Save changes" : "Save episode";
    $("ep-cancel").hidden = !editing;
    $("ep-discard").hidden = !dirty;
    finishSave();
    const waiting = ticket && ctx.store.outcome(ticket.n) === "pending";
    form.querySelectorAll("input,select,textarea").forEach(el => { el.disabled = !!waiting });
    const unfinished = (drafts?.list() || []).filter(d => d.name.startsWith("episode-") && d.name !== slot());
    $("episode-drafts").hidden = !unfinished.length;
    setHTML($("episode-draft-list"), html`${unfinished.map(d => html`<p><button class="secondary" data-draft="${d.name}">${d.name === "episode-new" ? "Continue new episode" : "Continue edit"}</button> <span class="meta">${new Date(d.at).toLocaleString(ctx.settings().locale || undefined)}</span></p>`)}`);
    renderOngoing(ctx, $("episode-ongoing"));
  }
  restore();
  return { render, edit, recover: (id, value) => edit(id, value), show() { if (!editing && !dirty) $("ep-when").value = nowLocal(); render() }, hide: remember };
}
