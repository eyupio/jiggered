// The Account tab: who you are, your password, where you're signed in, your settings and your data.

import { $, api, html, setHTML, appendHTML, describeUA, ago } from "./util.js";
import { LOCALES, LIMITS, dayId, normaliseSettings } from "./model.js";

function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
}

export function init(ctx) {
  const { me } = ctx;
  $("acc-name").textContent = me.username;
  $("acc-role").textContent = me.role === "admin" ? "You're an admin: you can add people and manage accounts." : "";

  // ---- password ----
  $("pwform").addEventListener("submit", async e => {
    e.preventDefault();
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
    const r = await api("DELETE", "/api/me/sessions/" + b.dataset.sid);
    say($("sessions-msg"), r.ok ? "Signed out." : r.error, !r.ok);
    loadSessions();
  });
  $("revoke-others").addEventListener("click", async () => {
    const r = await api("POST", "/api/me/sessions/revoke-others");
    say($("sessions-msg"), r.ok ? `Signed out ${r.data.revoked} other ${r.data.revoked === 1 ? "device" : "devices"}.` : r.error, !r.ok);
    loadSessions();
  });

  // ---- settings ----
  const actRow = (a = "", c = 1) => html`<div class="actrow"><input type="text" maxlength="${LIMITS.text}" value="${a}" aria-label="Activity name" placeholder="Activity"><input type="number" min="${LIMITS.cost[0]}" max="${LIMITS.cost[1]}" value="${c}" aria-label="Points it costs" inputmode="numeric"><button type="button" class="x rm">Remove</button></div>`;

  function fill(S) {
    $("set-budget").value = S.budget;
    $("set-penalty").value = S.sleepPenalty;
    setHTML($("set-locale"), html`${LOCALES.map(([v, label]) => html`<option value="${v}"${v === S.locale ? " selected" : ""}>${label}</option>`)}`);
    setHTML($("set-acts"), html`${S.activities.map(x => actRow(x.a, x.c))}`);
    $("set-sym").value = S.symptoms.join("\n");
    $("set-trig").value = S.triggers.join("\n");
  }
  const lines = id => $(id).value.split("\n");

  $("set-addact").addEventListener("click", () => {
    appendHTML($("set-acts"), actRow());
    $("set-acts").lastElementChild.querySelector("input").focus();
  });
  $("set-acts").addEventListener("click", e => { const b = e.target.closest(".rm"); if (b) b.closest(".actrow").remove() });
  $("set-reset").addEventListener("click", () => { fill(normaliseSettings({})); say($("set-msg"), "Defaults filled in. Save to keep them.") });

  $("setform").addEventListener("submit", e => {
    e.preventDefault();
    const draft = {
      budget: $("set-budget").value, sleepPenalty: $("set-penalty").value, locale: $("set-locale").value,
      activities: [...document.querySelectorAll("#set-acts .actrow")].map(r => { const [n, c] = r.querySelectorAll("input"); return { a: n.value, c: c.value } }),
      symptoms: lines("set-sym"), triggers: lines("set-trig"),
    };
    const S = normaliseSettings(draft);
    ctx.store.dispatch({ id: "settings", type: "replace", arg: S });
    // Today follows the new budget; earlier days keep the one they were made under.
    const today = dayId(ctx.today());
    if (ctx.store.view(today)) ctx.store.dispatch({ id: today, type: "restamp", arg: { budget: S.budget, sleepPenalty: S.sleepPenalty } });
    fill(S); // show what was actually kept
    say($("set-msg"), "Settings saved.");
  });

  // ---- data ----
  $("importform").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = $("import-msg"), file = $("import-file").files[0];
    if (!file) return say(msg, "Choose a file first.", true);
    if (file.size > 16 << 20) return say(msg, "That file is too large to be a Jiggered export.", true);
    let data;
    try { data = JSON.parse(await file.text()) } catch { return say(msg, "That isn't a Jiggered export.", true) }
    say(msg, "Restoring…");
    const mode = document.querySelector("input[name=import-mode]:checked").value;
    const r = await api("POST", "/api/import?mode=" + mode, data);
    if (!r.ok) return say(msg, r.error, true);
    const { imported, skipped, invalid } = r.data;
    say(msg, `Restored ${imported}${skipped ? `, kept ${skipped} you already had` : ""}${invalid ? `, ignored ${invalid} it couldn't use` : ""}.`);
    $("importform").reset();
    ctx.store.load();
  });

  // ---- delete ----
  $("delform").addEventListener("submit", async e => {
    e.preventDefault();
    if (!confirm("Delete your account and everything you've logged? This can't be undone.")) return;
    const r = await api("DELETE", "/api/me", { password: $("del-pw").value });
    if (!r.ok) return say($("del-msg"), r.error, true);
    ctx.leave();
  });

  return {
    render() {},
    show() {
      $("set-msg").textContent = $("pw-msg").textContent = $("import-msg").textContent = $("del-msg").textContent = "";
      fill(ctx.settings());
      loadSessions();
    },
  };
}
