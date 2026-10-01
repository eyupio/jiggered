// The Account tab: who you are, your password, where you're signed in, your settings and your data.

import { $, api, html, setHTML, appendHTML, describeUA, ago, saveFeedback, withBusy, downloadFile } from "./util.js";
import { createEditor, editorMarkup } from "./editor.js";
import { dayId, normaliseSettings, identifyActivities } from "./model.js";

function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
}

// identity says who you are and, for an admin, what that allows. It is re-run when the role changes.
export function identity({ me }) {
  $("acc-name").textContent = me.username;
  $("acc-role").textContent = me.role === "admin" ? "You're an admin: you can add people and manage accounts." : "";
}

export function init(ctx) {
  const { me } = ctx;
  identity(ctx);

  // ---- password ----
  $("pwform").addEventListener("submit", async e => {
    e.preventDefault();
    return withBusy($("pwform").querySelector("[type=submit]"), "Changing…", async () => {
    const msg = $("pw-msg");
    if ($("pw-new").value !== $("pw-new2").value) return say(msg, "The two new passwords don't match.", true);
    say(msg, "Changing…");
    const r = await api("POST", "/api/me/password", { current: $("pw-cur").value, new: $("pw-new").value });
    if (!r.ok) return say(msg, r.error, true);
    $("pwform").reset();
    if (me.must_change_password) { location.reload(); return }
    say(msg, "Password changed. Your other devices were signed out.");
    loadSessions();
    });
  });

  // ---- sessions ----
  async function loadSessions() {
    const r = await api("GET", "/api/me/sessions");
    if (!r.ok) { setHTML($("sessions"), html`<li class="meta">${r.error}</li>`); return }
    setHTML($("sessions"), html`${r.data.map(s => html`<li><span><b>${describeUA(s.user_agent)}</b>${s.current ? html` <span class="badge">this device</span>` : ""}
      <br><span class="meta">${s.ip || "unknown address"} · active ${ago(s.last_seen_at)}</span></span>
      ${s.current ? "" : html`<button class="x" data-sid="${s.id}">Sign out</button>`}</li>`)}`);
    $("revoke-others").hidden = r.data.length < 2;
  }
  $("sessions").addEventListener("click", async e => {
    const b = e.target.closest("[data-sid]");
    if (!b) return;
    return withBusy(b, "Signing out…", async () => {
    const r = await api("DELETE", "/api/me/sessions/" + b.dataset.sid);
    say($("sessions-msg"), r.ok ? "Signed out." : r.error, !r.ok);
    loadSessions();
    });
  });
  $("revoke-others").addEventListener("click", async () => withBusy($("revoke-others"), "Signing out…", async () => {
    const r = await api("POST", "/api/me/sessions/revoke-others");
    say($("sessions-msg"), r.ok ? `Signed out ${r.data.revoked} other ${r.data.revoked === 1 ? "device" : "devices"}.` : r.error, !r.ok);
    loadSessions();
  }));

  // ---- settings ----
  const form = $("setform");
  setHTML(form, editorMarkup("set"));
  let baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) };
  let dirty = false, ticket = null, savedSettings = null, stampDone = false;
  const editor = createEditor(form, "set", () => { dirty = true; ctx.drafts?.put("settings", { value: editor.read(), baseline }) });
  const savedDraft = ctx.drafts?.get("settings");
  editor.fill(savedDraft?.value || savedDraft || baseline);
  if (savedDraft?.baseline) baseline = savedDraft.baseline; dirty = !!savedDraft;
  if (dirty) say($("set-msg"), "Unfinished settings draft restored from this device.");
  form.querySelector('[data-discard]').addEventListener("click", () => {
    if (dirty && !confirm("Discard the unfinished settings draft?")) return;
    dirty = false; ctx.drafts?.remove("settings"); baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) }; editor.fill(baseline); say($("set-msg"), "Draft discarded.");
  });
  form.querySelector('[data-reset]').addEventListener("click", async () => {
    if (dirty && !confirm("Replace this draft with the current shared defaults?")) return;
    const shared = await ctx.loadDefaults();
    editor.fill(shared.body); dirty = true; ctx.drafts?.put("settings", { value: editor.read(), baseline }); say($("set-msg"), shared.fresh ? "Latest shared defaults filled in. Save to adopt them." : "Offline: last-known defaults filled in. Save to adopt this version.");
  });
  form.addEventListener("submit", e => {
    e.preventDefault(); if (ticket) return;
    const S = editor.validate(); if (!S) return;
    savedSettings = S; stampDone = false;
    const patch = Object.fromEntries(Object.entries(S).filter(([k,v]) => JSON.stringify(v) !== JSON.stringify(baseline[k])));
    ticket = ctx.store.dispatch({ id: "settings", type: ctx.store.view("settings") ? "settingsPatch" : "replace", arg: ctx.store.view("settings") ? patch : S, original: baseline, before: ctx.store.view("settings") ? Object.fromEntries(Object.keys(patch).map(k => [k,baseline[k]])) : undefined });
    renderSettings(); ticket.then(renderSettings);
  });
  function renderSettings() {
    if (!ticket) return;
    const state = saveFeedback(ctx.store, ticket, $("set-msg"));
    form.querySelector('[type=submit]').disabled = state === "pending";
    if (state === "saved") {
      // Clear the acknowledged draft only if no new input was added during the request.
      if (JSON.stringify(normaliseSettings(editor.read())) === JSON.stringify(savedSettings)) { dirty = false; ctx.drafts?.remove("settings") }
      const S = ctx.settings(); baseline = dirty ? savedSettings : { ...S, activities: identifyActivities(S.activities) }; ticket = null; if (!dirty) editor.fill(baseline);
      if (!stampDone) { stampDone = true; const id = dayId(ctx.today()); if (ctx.store.view(id)) ctx.store.dispatch({ id, type: "restamp", arg: { budget: S.budget, sleepPenalty: S.sleepPenalty } }) }
    } else if (state === "failed") ticket = null;
  }

  // ---- data ----
  let restorePreview = null;
  const invalidatePreview = () => { restorePreview = null; $("import-preview").hidden = true; $("import-preview").replaceChildren() };
  $("importform").addEventListener("change",invalidatePreview);
  $("importform").addEventListener("submit", async e => {
    e.preventDefault();
    return withBusy($("importform").querySelector("[type=submit]"), "Checking…", async () => {
      invalidatePreview();
      const msg = $("import-msg"), file = $("import-file").files[0];
      if (!file) return say(msg,"Choose a file first.",true);
      if (file.size > 26 << 20) return say(msg,"That file is too large to be a Jiggered export.",true);
      let data; try { data = JSON.parse(await file.text()) } catch { return say(msg,"That isn't a Jiggered export.",true) }
      const mode = document.querySelector("input[name=import-mode]:checked").value;
      const r = await api("POST","/api/restore/preview?mode="+mode,data);
      if (!r.ok) return say(msg,[r.error,...(r.data?.issues || [])].join("\n"),true);
      restorePreview = { data,mode,token:r.data.token };
      const p = r.data; $("import-preview").hidden = false;
      setHTML($("import-preview"),html`<h3>Review restore</h3><p>${p.additions} new records. ${p.matches} matching records. ${p.overwrites} will be replaced; ${p.skipped} will be kept.</p><p>${p.settingsChanged ? "Your settings will change, including activity lists and ordering." : "Your current settings will be kept."}</p><p>A private copy of your current server data will download before restoring. Keep it so you can undo a restore later.</p><button class="${p.overwrites ? "danger" : "primary"}" id="import-confirm" type="button">Download backup and ${p.overwrites ? `replace ${p.overwrites} matching records` : "restore missing records"}</button>`);
      say(msg,"Preview ready. Nothing has changed.");
    });
  });
  $("import-preview").addEventListener("click",async e => {
    const button = e.target.closest("#import-confirm"), preview = restorePreview;
    if (!button || !preview) return;
    await withBusy(button,"Restoring…",async () => {
      try {
        let restored = false;
        await ctx.store.withRestore(async () => {
          const backup = await api("GET","/api/export");
          if (!backup.ok) throw new Error("Could not download the pre-restore backup. " + backup.error);
          downloadFile(`jiggered-before-restore-${new Date().toISOString().replace(/[:.]/g,"-")}.json`,JSON.stringify(backup.data,null,2));
          const r = await api("POST","/api/restore?mode="+preview.mode,preview.data,{ "If-Match":preview.token });
          if (!r.ok) { if (r.status===409) invalidatePreview(); throw new Error([r.error,...(r.data?.issues || [])].join("\n")) }
          restored = true; invalidatePreview(); $("importform").reset();
          say($("import-msg"),`Restored ${r.data.imported} records; kept ${r.data.skipped} matching records. Your pre-restore backup was downloaded.`);
        });
        if (restored) await ctx.store.load();
      } catch (error) { say($("import-msg"),error.message,true) }
    });
  });

  $("export-device").addEventListener("click", () => downloadFile("jiggered-device-recovery.json", JSON.stringify({ ...ctx.store.recoveryExport(), drafts: ctx.drafts.export(), legacyCopies: ctx.legacyCopies() }, null, 2)));
  $("export-all").addEventListener("click", async () => withBusy($("export-all"), "Downloading…", async () => {
    await ctx.store.flush();
    if (ctx.store.status().pending || ctx.store.status().failed) return say($("export-msg"), "Your server export would miss unsaved changes. Resolve them or download the device recovery copy.", true);
    const r = await api("GET", "/api/export");
    if (!r.ok) return say($("export-msg"), r.error, true);
    downloadFile(`jiggered-${ctx.today()}.json`, JSON.stringify(r.data, null, 2)); say($("export-msg"), "Server data downloaded.");
  }));

  // ---- delete ----
  $("delform").addEventListener("submit", async e => {
    e.preventDefault();
    return withBusy($("delform").querySelector("[type=submit]"), "Deleting…", async () => {
    if (!confirm("Delete your account and everything you've logged? This can't be undone.")) return;
    const r = await api("DELETE", "/api/me", { password: $("del-pw").value });
    if (!r.ok) return say($("del-msg"), r.error, true);
    ctx.leave();
    });
  });

  return {
    render: renderSettings,
    focus: key => editor.focus(key),
    recover(value) { baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) }; editor.fill(normaliseSettings(value)); dirty = true; ticket = null; ctx.drafts?.put("settings", { value: editor.read(), baseline }); say($("set-msg"), "Recovered copy opened. Save it, then resolve or discard the old recovery item."); editor.focus("set-acts") },
    show() {
      if (!dirty && !ticket) { baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) }; editor.fill(baseline) }
      renderSettings();
      loadSessions();
    },
  };
}
