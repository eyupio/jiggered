// Personal profile shares the existing private settings document and operation/outbox semantics.
import { $, html, setHTML, saveFeedback } from "./util.js";
import { listDays, listEpisodes } from "./model.js";
import { HISTORY_RANGES } from "./history-model.js";

export function normaliseProfile(value) {
  const p = value && typeof value === "object" ? value : {};
  const text = (v, n) => typeof v === "string" ? [...v.trim()].slice(0, n).join("") : "";
  return { displayName: text(p.displayName, 60), focus: text(p.focus, 160),
    theme: ["system", "light", "dark"].includes(p.theme) ? p.theme : "system",
    historyRange: HISTORY_RANGES.some(([key]) => key === p.historyRange) ? p.historyRange : "30" };
}
export const profileInitials = name => String(name).trim().split(/\s+/).filter(Boolean).map(x => [...x][0]).slice(0, 2).join("").toLocaleUpperCase() || "J";
export function applyAppearance(profile) {
  const { theme } = normaliseProfile(profile);
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
export function profileIdentity(ctx) {
  const p = normaliseProfile(ctx.store?.view("settings")?.profile), name = p.displayName || ctx.me.username;
  $("acc-title").textContent = name; $("acc-avatar").textContent = profileInitials(name);
  $("acc-focus").textContent = p.focus || "A little clarity about your days, on your terms.";
  $("acc-badge").textContent = ctx.me.role === "admin" ? "Administrator" : "Personal account";
  $("who").textContent = name; $("who-initials").textContent = profileInitials(name);
  applyAppearance(p);
}

export function initProfile(ctx) {
  const form = $("profile-form"), fields = ["displayName", "focus", "theme", "historyRange"];
  let baseline, dirty = false, ticket = null, submitted = null;
  const raw = () => ctx.store?.view("settings")?.profile;
  const read = () => Object.fromEntries(fields.map(k => [k, form.elements[k].value.trim()]));
  const fill = value => { const p = normaliseProfile(value); for (const key of fields) form.elements[key].value = p[key]; count() };
  function count() { $("profile-focus-count").textContent = `${[...form.elements.focus.value].length} / 160`; $("profile-discard").disabled = !dirty }
  setHTML($("profile-range"), html`${HISTORY_RANGES.map(([key, label]) => html`<option value="${key}">${label}</option>`)}`);
  baseline = raw(); const draft = ctx.drafts?.get("profile"); dirty = !!draft;
  if (draft) baseline = draft.baseline;
  fill(draft?.value || baseline);
  if (dirty) $("profile-msg").textContent = "Unfinished profile draft restored from this device.";
  form.addEventListener("input", () => { dirty = true; count(); ctx.drafts?.put("profile", { value: read(), baseline }) });
  $("profile-discard").addEventListener("click", () => {
    if (dirty && !confirm("Discard the unfinished profile draft?")) return;
    dirty = false; baseline = raw(); ctx.drafts?.remove("profile"); fill(baseline);
    $("profile-msg").textContent = "Draft discarded.";
  });
  form.addEventListener("submit", e => {
    e.preventDefault(); if (ticket || !ctx.store) return;
    const value = read();
    if ([...value.displayName].length > 60 || [...value.focus].length > 160) { $("profile-msg").textContent = "Keep your display name within 60 characters and your focus within 160."; return }
    submitted = normaliseProfile(value);
    // Only the profile changes. Budget/list edits from this or another device survive replay.
    ticket = ctx.store.dispatch({ id: "settings", type: "settingsPatch", arg: { profile: submitted }, before: { profile: baseline }, original: ctx.store.view("settings") });
    render(); ticket.then(render);
  });
  function render() {
    profileIdentity(ctx);
    if (!dirty && !ticket && JSON.stringify(baseline) !== JSON.stringify(raw())) { baseline = raw(); fill(baseline) }
    const docs = ctx.store?.all() || {}, days = listDays(docs), episodes = listEpisodes(docs);
    setHTML($("profile-stats"), html`<div><b>${days.filter(d => d.status).length}</b><span>check-ins</span></div><div><b>${days.reduce((n, d) => n + d.entries.length, 0)}</b><span>activities logged</span></div><div><b>${episodes.length}</b><span>episodes recorded</span></div>`);
    if (!ticket) return;
    const state = saveFeedback(ctx.store, ticket, $("profile-msg"));
    $("profile-save").disabled = state === "pending";
    if (state === "saved") {
      const untouched = JSON.stringify(normaliseProfile(read())) === JSON.stringify(submitted);
      if (untouched) { dirty = false; ctx.drafts?.remove("profile") }
      baseline = submitted; ticket = null;
      if (dirty) ctx.drafts?.put("profile", { value: read(), baseline }); else fill(raw());
      count();
    } else if (state === "failed") ticket = null;
  }
  return { render, show() { if (!dirty && !ticket) { baseline = raw(); fill(baseline) } render() },
    recover(value) { baseline = raw(); dirty = true; ticket = null; fill(value); ctx.drafts?.put("profile", { value: read(), baseline }); $("profile-msg").textContent = "Recovered profile opened. Review, then Save profile."; $("profile-name").focus() } };
}
