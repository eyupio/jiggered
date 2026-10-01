// The Account tab: who you are, your password, where you're signed in, your settings and your data.

import { $, api, html, setHTML, appendHTML, describeUA, ago, saveFeedback, withBusy, downloadFile } from "./util.js";
import { createEditor, editorMarkup } from "./editor.js";
import { dayId, normaliseSettings } from "./model.js";

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
  let dirty = false, ticket = null, savedSettings = null, stampDone = false;
  const editor = createEditor(form, "set", () => { dirty = true; ctx.drafts?.put("settings", editor.read()) });
  const savedDraft = ctx.drafts?.get("settings");
  editor.fill(savedDraft || ctx.settings()); dirty = !!savedDraft;
  if (dirty) say($("set-msg"), "Unfinished settings draft restored from this device.");
  form.querySelector('[data-discard]').addEventListener("click", () => {
    if (dirty && !confirm("Discard the unfinished settings draft?")) return;
    dirty = false; ctx.drafts?.remove("settings"); editor.fill(ctx.settings()); say($("set-msg"), "Draft discarded.");
  });
  form.querySelector('[data-reset]').addEventListener("click", async () => {
    if (dirty && !confirm("Replace this draft with the current shared defaults?")) return;
    const shared = await ctx.loadDefaults();
    editor.fill(shared.body); dirty = true; ctx.drafts?.put("settings", editor.read()); say($("set-msg"), shared.fresh ? "Latest shared defaults filled in. Save to adopt them." : "Offline: last-known defaults filled in. Save to adopt this version.");
  });
  form.addEventListener("submit", e => {
    e.preventDefault(); if (ticket) return;
    const S = editor.validate(); if (!S) return;
    savedSettings = S; stampDone = false;
    ticket = ctx.store.dispatch({ id: "settings", type: "replace", arg: S });
    renderSettings(); ticket.then(renderSettings);
  });
  function renderSettings() {
    if (!ticket) return;
    const state = saveFeedback(ctx.store, ticket, $("set-msg"));
    form.querySelector('[type=submit]').disabled = state === "pending";
    if (state === "saved") {
      // Clear the acknowledged draft only if no new input was added during the request.
      if (JSON.stringify(normaliseSettings(editor.read())) === JSON.stringify(savedSettings)) { dirty = false; ctx.drafts?.remove("settings") }
      const S = savedSettings; ticket = null;
      if (!stampDone) { stampDone = true; const id = dayId(ctx.today()); if (ctx.store.view(id)) ctx.store.dispatch({ id, type: "restamp", arg: { budget: S.budget, sleepPenalty: S.sleepPenalty } }) }
    } else if (state === "failed") ticket = null;
  }

  // ---- data ----
  $("importform").addEventListener("submit", async e => {
    e.preventDefault();
    return withBusy($("importform").querySelector("[type=submit]"), "Restoring…", async () => {
    const msg = $("import-msg"), file = $("import-file").files[0];
    if (!file) return say(msg, "Choose a file first.", true);
    if (file.size > 26 << 20) return say(msg, "That file is too large to be a Jiggered export.", true); // a full account is 25 MB of data plus the ids around it
    let data;
    try { data = JSON.parse(await file.text()) } catch { return say(msg, "That isn't a Jiggered export.", true) }
    await ctx.store.flush();
    if (ctx.store.status().pending || ctx.store.status().failed) return say(msg, "Resolve queued or refused changes before restoring. Download a device recovery copy to keep them.", true);
    if (!confirm("Restore this file? Matching records follow the mode selected below.")) return;
    say(msg, "Restoring…");
    const mode = document.querySelector("input[name=import-mode]:checked").value;
    const r = await api("POST", "/api/import?mode=" + mode, data);
    if (!r.ok) return say(msg, r.error, true);
    const { imported, skipped, invalid } = r.data;
    say(msg, `Restored ${imported}${skipped ? `, kept ${skipped} you already had` : ""}${invalid ? `, ignored ${invalid} it couldn't use` : ""}.`);
    $("importform").reset();
    ctx.store.load();
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
    recover(value) { editor.fill(normaliseSettings(value)); dirty = true; ticket = null; ctx.drafts?.put("settings", editor.read()); say($("set-msg"), "Recovered copy opened. Save it, then resolve or discard the old recovery item."); editor.focus("set-acts") },
    show() {
      if (!dirty && !ticket) editor.fill(ctx.settings());
      renderSettings();
      loadSessions();
    },
  };
}
