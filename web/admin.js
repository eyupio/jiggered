// The Admin tab: add people, reset passwords, sign devices out, remove accounts, read the activity log, say
// whether Jiggered sits behind a reverse proxy, download a backup. It shows how many entries someone has,
// never what is in them.
//
// Nothing of this is in the page for anyone else: app.js imports this file, and calls mount(), only while the
// server says the signed-in person is an admin.

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
  settings_changed: e => `${e.actor} changed a setting`,
  settings_imported: () => `Settings were copied from the environment into the database`,
  migrated: e => `${e.target} took over the data from before accounts existed`,
};
const sentence = e => (SENTENCE[e.action] || (x => `${x.actor || "system"}: ${x.action}`))({ ...e, actor: e.actor || "System" });

function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
}

const MARKUP = `
    <div class="panel">
      <h2>People</h2>
      <p class="meta">You can add people, reset passwords, sign devices out and remove accounts. You can't read anyone's check-ins or episodes here, only how many they have.</p>
      <ul class="list people" id="users"></ul>
      <p class="msg" id="users-msg" aria-live="polite"></p>
    </div>
    <div class="panel">
      <h2>Add someone</h2>
      <form id="adduser">
        <label class="field">Username<input type="text" id="new-name" autocomplete="off" autocapitalize="none" maxlength="64" required></label>
        <label class="radio"><input type="checkbox" id="new-admin"> Can manage people (admin)</label>
        <button class="primary" type="submit">Create account</button>
        <p class="msg" id="adduser-msg" aria-live="polite"></p>
      </form>
      <div class="reveal" id="reveal" hidden>
        <p><b id="reveal-who"></b> can sign in with this temporary password. It is shown once. They'll choose their own at first sign-in.</p>
        <code id="reveal-pw"></code>
        <button class="secondary" id="reveal-copy" type="button">Copy</button>
        <button class="x" id="reveal-hide" type="button">Hide</button>
      </div>
    </div>
    <div class="panel">
      <h2>Activity</h2>
      <ul class="list audit" id="audit"></ul>
      <button class="secondary" id="audit-more" hidden>Show older</button>
    </div>
    <div class="panel">
      <h2>Connection</h2>
      <form id="proxyform">
        <label class="radio"><input type="checkbox" id="px-on"> Jiggered runs behind a reverse proxy (Caddy, nginx, Traefik)</label>
        <label class="field">How many proxies are in front<input type="number" id="px-hops" min="1" max="10" inputmode="numeric"></label>
        <button class="primary" type="submit">Save</button>
        <p class="msg" id="px-msg" aria-live="polite"></p>
      </form>
      <p class="meta" id="px-seen"></p>
      <p class="hint">Jiggered counts failed sign-ins per address and shows where people are signed in from. Behind a proxy everyone would look like the proxy unless it is told to read the real address. After saving, the line above should show your own address.</p>
      <p class="meta" id="px-cookie"></p>
    </div>
    <div class="panel">
      <h2>Backup</h2>
      <p class="meta">Downloads a copy of the whole database. It includes everyone's check-ins and episodes, so keep it somewhere private. To put one back, see "Backup and restore" in the README.</p>
      <button class="secondary" id="backup">Download backup</button>
      <p class="msg" id="backup-msg" aria-live="polite"></p>
      <p class="meta" id="admin-version"></p>
    </div>
  `;

// mount adds the Admin tab and its panel to the page and returns the view; destroy takes them away again.
export function mount(ctx) {
  const tab = Object.assign(document.createElement("button"), { id: "t-admin", textContent: "Admin" });
  tab.dataset.tab = "admin";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  $("tabs").append(tab);
  const panel = Object.assign(document.createElement("section"), { id: "admin-panel", hidden: true });
  panel.innerHTML = MARKUP;
  $("sync").before(panel);
  const view = wire(ctx);
  return { ...view, destroy() { tab.remove(); panel.remove() } };
}

function wire(ctx) {
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

  // ---- how Jiggered finds out who is connecting ----
  function showConnection(c) {
    $("px-on").checked = c.trust_proxy;
    $("px-hops").value = c.proxy_hops;
    $("px-hops").disabled = !c.trust_proxy;
    const via = c.seen.remote_addr + (c.seen.forwarded_for ? `, X-Forwarded-For: ${c.seen.forwarded_for}` : "");
    const advice = !c.trust_proxy && c.seen.forwarded_for ? "A proxy is sending X-Forwarded-For, but Jiggered isn't reading it. Turn the setting on so people can be told apart."
      : c.trust_proxy && !c.seen.forwarded_for ? "No X-Forwarded-For header arrived. Either nothing is in front of Jiggered, or your proxy doesn't send one: in that case turn the setting off."
      : "";
    setHTML($("px-seen"), html`Jiggered sees you as <b>${c.seen.client_ip}</b> <span class="meta">(connection from ${via})</span>. ${advice}`);
    setHTML($("px-cookie"), c.secure_cookie
      ? html`Sign-in cookies only travel over HTTPS.`
      : html`<b>Sign-in cookies also travel over plain http.</b> That is only meant for testing. Turn it back on with <code>jiggered settings set secure_cookie true</code>.`);
  }
  async function loadConnection() {
    const r = await api("GET", "/api/admin/settings");
    if (r.ok) showConnection(r.data); else say($("px-msg"), r.error, true);
  }
  $("px-on").addEventListener("change", () => { $("px-hops").disabled = !$("px-on").checked });
  $("proxyform").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = $("px-msg");
    say(msg, "Saving…");
    const r = await api("PATCH", "/api/admin/settings", { trust_proxy: $("px-on").checked, proxy_hops: Number($("px-hops").value) || 1 });
    if (!r.ok) return say(msg, r.error, true);
    showConnection(r.data);
    say(msg, "Saved.");
    loadAudit(true);
  });

  return {
    render() {},
    show() {
      if (!loaded) { loaded = true; $("reveal").hidden = true }
      loadUsers();
      loadAudit(true);
      loadConnection();
    },
  };
}
