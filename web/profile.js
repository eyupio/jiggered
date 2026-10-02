// Personal profile shares the existing private settings document and operation/outbox semantics.
import { $, html, setHTML, saveFeedback } from "./util.js";
import { listDays, listEpisodes } from "./model.js";
import { energyTheme, energyWords, applyEnergyTheme } from "./energy-theme.js";
import { HISTORY_RANGES } from "./history-model.js";
import { normaliseAvatar, readAvatar, showAvatar } from "./avatar.js";
import { REGIONS, normaliseRegion, emergencyCall, applyRegion } from "./region.js";

export function normaliseProfile(value) {
  const p = value && typeof value === "object" ? value : {};
  const text = (v, n) => (typeof v === "string" ? [...v.trim()].slice(0, n).join("") : "");
  return {
    avatar: normaliseAvatar(p.avatar),
    region: normaliseRegion(p.region),
    energyTheme: energyTheme(p),
    displayName: text(p.displayName, 60),
    focus: text(p.focus, 160),
    theme: ["system", "light", "dark"].includes(p.theme) ? p.theme : "system",
    historyRange: HISTORY_RANGES.some(([key]) => key === p.historyRange) ? p.historyRange : "30",
  };
}
export const profileInitials = (name) =>
  String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((x) => [...x][0])
    .slice(0, 2)
    .join("")
    .toLocaleUpperCase() || "J";
export function applyAppearance(profile) {
  const { theme } = normaliseProfile(profile);
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
export function profileIdentity(ctx) {
  const p = normaliseProfile(ctx.store?.view("settings")?.profile),
    name = p.displayName || ctx.me.username;
  $("acc-title").textContent = name;
  showAvatar($("acc-avatar"), p.avatar, profileInitials(name));
  $("acc-focus").textContent = p.focus || "A little clarity about your days, on your terms.";
  $("acc-badge").textContent = ctx.me.role === "admin" ? "Administrator" : "Personal account";
  $("who").textContent = name;
  showAvatar($("who-initials"), p.avatar, profileInitials(name));
  applyRegion(p.region);
  applyAppearance(p);
  document.documentElement.dataset.energyTheme = p.energyTheme;
  applyEnergyTheme(p.energyTheme);
}

export function initProfile(ctx) {
  const form = $("profile-form"),
    fields = ["displayName", "focus", "theme", "historyRange", "energyTheme", "region"];
  let avatar = "",
    photoTask = 0,
    photoBusy = false;
  let baseline,
    dirty = false,
    ticket = null,
    submitted = null;
  const raw = () => ctx.store?.view("settings")?.profile;
  const read = () => ({
    ...Object.fromEntries(fields.map((k) => [k, form.elements[k].value.trim()])),
    avatar,
  });
  const fill = (value) => {
    const p = normaliseProfile(value);
    for (const key of fields) form.elements[key].value = p[key];
    avatar = p.avatar;
    photoTask++;
    photoBusy = false;
    $("profile-photo").value = "";
    $("profile-photo-msg").textContent = "";
    count();
    preview();
  };
  function preview() {
    showAvatar(
      $("profile-photo-preview"),
      avatar,
      profileInitials(form.elements.displayName.value || ctx.me.username),
    );
    $("profile-photo-remove").disabled = !avatar;
    $("profile-save").disabled = photoBusy || !!ticket;
    $("profile-region-preview").textContent =
      `${emergencyCall(form.elements.region.value)} in an emergency.`;
    const words = energyWords(form.elements.energyTheme.value);
    $("energy-theme-preview").textContent = `8 ${words.plural} left today`;
    $("energy-theme-preview").nextElementSibling.textContent =
      `A 2-${words.singular} activity leaves 6 ${words.plural}.`;
  }
  function count() {
    $("profile-focus-count").textContent = `${[...form.elements.focus.value].length} / 160`;
    $("profile-discard").disabled = !dirty;
  }
  setHTML(
    $("profile-region"),
    html`${REGIONS.map(([id, label]) => html`<option value="${id}">${label}</option>`)}`,
  );
  setHTML(
    $("profile-range"),
    html`${HISTORY_RANGES.map(([key, label]) => html`<option value="${key}">${label}</option>`)}`,
  );
  baseline = raw();
  const draft = ctx.drafts?.get("profile");
  dirty = !!draft;
  if (draft) baseline = draft.baseline;
  fill(draft?.value || baseline);
  if (dirty) $("profile-msg").textContent = "Unfinished profile draft restored from this device.";
  function changed() {
    dirty = true;
    count();
    preview();
    ctx.drafts?.put("profile", { value: read(), baseline });
  }
  form.addEventListener("input", (e) => {
    if (e.target.id !== "profile-photo") changed();
  });
  $("profile-photo").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const task = ++photoTask;
    photoBusy = true;
    preview();
    $("profile-photo-msg").textContent = "Preparing photo…";
    try {
      const value = await readAvatar(file);
      if (task !== photoTask) return;
      avatar = value;
      changed();
      $("profile-photo-msg").textContent = "Photo ready. Save profile to use it.";
    } catch (error) {
      if (task === photoTask) $("profile-photo-msg").textContent = error.message;
    } finally {
      if (task === photoTask) {
        photoBusy = false;
        e.target.value = "";
        preview();
      }
    }
  });
  $("profile-photo-remove").addEventListener("click", () => {
    photoTask++;
    photoBusy = false;
    avatar = "";
    changed();
    $("profile-photo-msg").textContent = "Photo removed from this draft. Save profile to apply.";
  });
  $("profile-discard").addEventListener("click", () => {
    if (dirty && !confirm("Discard the unfinished profile draft?")) return;
    dirty = false;
    baseline = raw();
    ctx.drafts?.remove("profile");
    fill(baseline);
    $("profile-msg").textContent = "Draft discarded.";
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (ticket || photoBusy || !ctx.store) return;
    const value = read();
    if ([...value.displayName].length > 60 || [...value.focus].length > 160) {
      $("profile-msg").textContent =
        "Keep your display name within 60 characters and your focus within 160.";
      return;
    }
    submitted = normaliseProfile(value);
    // Only the profile changes. Budget/list edits from this or another device survive replay.
    ticket = ctx.store.dispatch({
      id: "settings",
      type: "settingsPatch",
      arg: { profile: submitted },
      before: { profile: baseline },
      original: ctx.store.view("settings"),
    });
    render();
    ticket.then(render);
  });
  function render() {
    profileIdentity(ctx);
    if (!dirty && !ticket && JSON.stringify(baseline) !== JSON.stringify(raw())) {
      baseline = raw();
      fill(baseline);
    }
    const docs = ctx.store?.all() || {},
      days = listDays(docs),
      episodes = listEpisodes(docs);
    setHTML(
      $("profile-stats"),
      html`<div><b>${days.filter((d) => d.status).length}</b><span>check-ins</span></div><div><b>${days.reduce((n, d) => n + d.entries.length, 0)}</b><span>activities logged</span></div><div><b>${episodes.length}</b><span>episodes recorded</span></div>`,
    );
    if (!ticket) return;
    const state = saveFeedback(ctx.store, ticket, $("profile-msg"));
    $("profile-save").disabled = state === "pending";
    if (state === "saved") {
      const untouched = JSON.stringify(normaliseProfile(read())) === JSON.stringify(submitted);
      if (untouched) {
        dirty = false;
        ctx.drafts?.remove("profile");
      }
      baseline = submitted;
      ticket = null;
      if (dirty) ctx.drafts?.put("profile", { value: read(), baseline });
      else fill(raw());
      count();
    } else if (state === "failed") ticket = null;
  }
  return {
    render,
    show() {
      if (!dirty && !ticket) {
        baseline = raw();
        fill(baseline);
      }
      render();
    },
    recover(value) {
      baseline = raw();
      dirty = true;
      ticket = null;
      fill(value);
      ctx.drafts?.put("profile", { value: read(), baseline });
      $("profile-msg").textContent = "Recovered profile opened. Review, then Save profile.";
      $("profile-name").focus();
    },
  };
}
