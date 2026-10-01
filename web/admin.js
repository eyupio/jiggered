// The Admin tab: add people, reset passwords, sign devices out, remove accounts, read the activity log,
// download a backup. It shows how many entries someone has, never what is in them.

import { $, api, html, setHTML, appendHTML, fmtBytes, ago } from "./util.js";

// One plain sentence per kind of event, from the entry's actor and target.
const SENTENCE = {
  login: e => `${e.actor} signed in`,
  login_failed: e => `Failed sign-in for ${e.target}`,
  login_refused: e => `${e.target} tried to sign in but the account is disabled`,
  password_changed: e => `${e.actor} changed their password`,
  password_check_failed: e => `${e.actor} gave a wrong password`,
  password_reset: e => `${e.actor} reset ${e.target}'s password`,
  user_created: e => `${e.actor} added ${e.target}`,
  user_deleted: e => `${e.actor} removed ${e.target}`,
  user_disabled: e => `${e.actor} disabled ${e.target}`,
  user_enabled: e => `${e.actor} enabled ${e.target}`,
  role_changed: e => `${e.actor} changed ${e.target}'s role`,
  sessions_revoked: e => e.actor === e.target ? `${e.actor} signed out their devices` : `${e.actor} signed ${e.target} out everywhere`,
  session_revoked: e => `${e.actor} signed out one of their devices`,
  account_deleted: e => `${e.actor} deleted their account`,
  backup_downloaded: e => `${e.actor} downloaded a backup`,
  import: e => `${e.actor} restored from a file`,
  admin_created: e => `${e.target} was set up as the first admin`,
  migrated: e => `${e.target} took over the data from before accounts existed`,
};
const sentence = e => (SENTENCE[e.action] || (x => `${x.actor || "system"}: ${x.action}`))({ ...e, actor: e.actor || "System" });

function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
}

export function init(ctx) {
  const { me } = ctx;
  let users = [], oldest = 0, loaded = false;

  async function loadUsers() {
    const r = await api("GET", "/api/admin/users");
    if (!r.ok) { say($("users-msg"), r.error, true); return }
    users = r.data.users;
    $("admin-version").textContent = `Jiggered ${r.data.version}`;
    renderUsers();
  }

  function renderUsers() {
    setHTML($("users"), html`${users.map(u => {
      const self = u.id === me.id;
      return html`<li data-id="${u.id}" data-name="${u.username}">
        <div class="top"><b>${u.username}</b>${self ? html` <span class="badge">you</span>` : ""}${u.role === "admin" ? html` <span class="badge">admin</span>` : ""}${u.disabled ? html` <span class="badge off">disabled</span>` : ""}${u.must_change_password && !u.disabled ? html` <span class="badge wait">hasn't chosen a password yet</span>` : ""}</div>
        <div class="meta">${u.last_login_at ? "Last signed in " + ago(u.last_login_at) : "Never signed in"} · ${u.docs} ${u.docs === 1 ? "entry" : "entries"} (${fmtBytes(u.bytes)}) · signed in on ${u.sessions} ${u.sessions === 1 ? "device" : "devices"}</div>
        ${self ? "" : html`<div class="actions">
          <button class="secondary small" data-act="reset">Reset password</button>
          <button class="secondary small" data-act="signout"${u.sessions ? "" : " disabled"}>Sign out everywhere</button>
          <button class="secondary small" data-act="${u.disabled ? "enable" : "disable"}">${u.disabled ? "Enable" : "Disable"}</button>
          <button class="secondary small" data-act="${u.role === "admin" ? "demote" : "promote"}">${u.role === "admin" ? "Remove admin" : "Make admin"}</button>
          <button class="danger small" data-act="delete">Delete</button>
        </div>`}
      </li>`;
    })}`);
  }

  function reveal(who, pw) {
    $("reveal-who").textContent = who;
    $("reveal-pw").textContent = pw;
    $("reveal").hidden = false;
    $("reveal-copy").textContent = "Copy";
  }
  $("reveal-hide").addEventListener("click", () => { $("reveal").hidden = true; $("reveal-pw").textContent = "" });
  $("reveal-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("reveal-pw").textContent); $("reveal-copy").textContent = "Copied" }
    catch { // no clipboard access: select it so it can be copied by hand
      const r = document.createRange(); r.selectNodeContents($("reveal-pw"));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
  });

  $("users").addEventListener("click", async e => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const li = b.closest("li"), id = li.dataset.id, name = li.dataset.name, msg = $("users-msg");
    const path = "/api/admin/users/" + id;
    say(msg, "");
    let r;
    switch (b.dataset.act) {
      case "reset":
        if (!confirm(`Reset ${name}'s password? They'll be signed out everywhere and given a temporary one.`)) return;
        r = await api("POST", path + "/reset-password");
        if (r.ok) reveal(name, r.data.temp_password);
        break;
      case "signout":
        r = await api("POST", path + "/revoke-sessions");
        if (r.ok) say(msg, `${name} was signed out everywhere.`);
        break;
      case "disable":
        if (!confirm(`Disable ${name}? They'll be signed out and unable to sign in until you enable them again. Their data is kept.`)) return;
        r = await api("PATCH", path, { disabled: true });
        break;
      case "enable": r = await api("PATCH", path, { disabled: false }); break;
      case "promote":
        if (!confirm(`Make ${name} an admin? They'll be able to add people and manage every account (but still not read anyone's logs).`)) return;
        r = await api("PATCH", path, { role: "admin" });
        break;
      case "demote": r = await api("PATCH", path, { role: "user" }); break;
      case "delete": {
        const typed = prompt(`This permanently deletes ${name} and everything they've logged.\n\nType their username to confirm:`);
        if (typed === null) return;
        r = await api("DELETE", path + "?confirm=" + encodeURIComponent(typed.trim()));
        if (r.ok) say(msg, `${name} was deleted.`);
        break;
      }
    }
    if (r && !r.ok) say(msg, r.error, true);
    loadUsers();
    loadAudit(true);
  });

  $("adduser").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = $("adduser-msg"), username = $("new-name").value.trim();
    say(msg, "Creating…");
    const r = await api("POST", "/api/admin/users", { username, role: $("new-admin").checked ? "admin" : "user" });
    if (!r.ok) return say(msg, r.error, true);
    say(msg, `Created ${r.data.user.username}.`);
    $("adduser").reset();
    reveal(r.data.user.username, r.data.temp_password);
    loadUsers();
    loadAudit(true);
  });

  async function loadAudit(fresh) {
    const r = await api("GET", "/api/admin/audit?limit=30" + (fresh || !oldest ? "" : "&before=" + oldest));
    if (!r.ok) return;
    const line = en => html`<li><span>${sentence(en)}${en.detail ? html` <span class="meta">(${en.detail})</span>` : ""}</span><span class="meta">${ago(en.at)}${en.ip ? " · " + en.ip : ""}</span></li>`;
    if (fresh) setHTML($("audit"), html`${r.data.map(line)}`);
    else appendHTML($("audit"), html`${r.data.map(line)}`);
    if (r.data.length) oldest = r.data[r.data.length - 1].id;
    $("audit-more").hidden = r.data.length < 30;
  }
  $("audit-more").addEventListener("click", () => loadAudit(false));

  $("backup").addEventListener("click", async () => {
    const msg = $("backup-msg");
    say(msg, "Preparing the backup…");
    let r;
    try { r = await fetch("/api/admin/backup", { method: "POST", credentials: "same-origin", headers: { "X-Requested-With": "jiggered" } }) }
    catch { return say(msg, "Couldn't reach the server. Check your connection and try again.", true) }
    if (!r.ok) return say(msg, `The backup failed (${r.status}).`, true);
    const url = URL.createObjectURL(await r.blob());
    const name = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || "jiggered-backup.db";
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(msg, "Backup downloaded.");
    loadAudit(true);
  });

  return {
    render() {},
    show() {
      if (!loaded) { loaded = true; $("reveal").hidden = true }
      loadUsers();
      loadAudit(true);
    },
  };
}
