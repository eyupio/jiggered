// The Admin tab: add people, reset passwords, sign devices out, remove accounts, read the activity log, say
// whether Jiggered sits behind a reverse proxy, download a backup. It shows how many entries someone has,
// never what is in them.
//
// Nothing of this is in the page for anyone else: app.js imports this file, and calls mount(), only while the
// server says the signed-in person is an admin.

import { $, api, html, setHTML, appendHTML, fmtBytes, ago, withBusy } from "./util.js";

import { createEditor, editorMarkup } from "./editor.js";
import { servicesMarkup, initServices } from "./services.js";
import { DEFAULTS } from "./model.js";

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
  defaults_changed: e => `${e.actor} updated the shared product defaults`,
  settings_changed: e => `${e.actor} changed a setting`,
  settings_imported: () => `Settings were copied from the environment into the database`,
  migrated: e => `${e.target} took over the data from before accounts existed`,
};
const sentence = e => (SENTENCE[e.action] || (x => `${x.actor || "system"}: ${x.action}`))({ ...e, actor: e.actor || "System" });

function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
}

const MARKUP = `${servicesMarkup}
<dialog id="factor-reset-dialog" class="panel security-dialog" aria-labelledby="factor-reset-title"><form id="factor-reset-form"><h2 id="factor-reset-title">Reset two-step verification</h2><p class="meta" id="factor-reset-description"></p><label>Your admin password<input id="factor-reset-password" type="password" autocomplete="current-password" required></label><label>Your authenticator or recovery code<input id="factor-reset-code" autocomplete="one-time-code" autocapitalize="none"><span class="meta">Required if your own account has two-step verification enabled.</span></label><p class="msg" role="status" id="factor-reset-msg"></p><div class="service-actions"><button class="danger" type="submit">Reset & sign out devices</button><button class="secondary" type="button" id="factor-reset-cancel">Cancel</button></div></form></dialog>
    <div class="panel"><label class="field">Confirm an admin change<input type="password" id="admin-confirm-pw" autocomplete="current-password"></label><p class="hint">Your password confirms changes to accounts, connection settings and shared defaults.</p></div>
    <div class="panel">
      <h2>People</h2>
      <p class="meta">You can add people, reset passwords, sign devices out and remove accounts. These screens don't show anyone's check-ins or episodes, only how many they have. Remember that resetting a password lets you sign in as that person, and a backup contains everything.</p>
      <ul class="list people" id="users"></ul>
      <p class="msg" id="users-msg" aria-live="polite"></p><button class="secondary" id="users-retry">Refresh people</button>
    </div>
    <div class="panel">
      <h2>Add someone</h2>
      <form id="adduser">
        <label class="field">Username<input type="text" id="new-name" autocomplete="off" autocapitalize="none" maxlength="64" required></label>
        <label class="radio"><input type="checkbox" id="new-admin"> Admin: manage accounts, reset passwords and download everyone's data</label>
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
      <ul class="list audit" id="audit"></ul><p class="msg" id="audit-msg" role="status"></p><button class="secondary" id="audit-refresh">Refresh activity</button>
      <button class="secondary" id="audit-more" hidden>Show older</button>
    </div>
    <div class="panel"><h2>Shared product defaults</h2><p class="meta">Starting activities, symptoms, triggers and points for new users. Existing personal lists are preserved. Users can adopt these from Account. Order here becomes the starting quick-access order.</p><form id="defaults-form"></form><button class="secondary" id="defaults-reload">Reload latest defaults</button></div>
    <div class="panel">
      <h2>Connection</h2>
      <form id="proxyform">
        <label class="radio"><input type="checkbox" id="px-on"> Jiggered runs behind a reverse proxy (Caddy, nginx, Traefik)</label>
        <label class="field">How many proxies are in front<input type="number" id="px-hops" min="1" max="10" inputmode="numeric"></label>
        <label class="field">Trusted proxy IP ranges (comma separated CIDRs)<input type="text" id="px-cidrs" placeholder="127.0.0.1/32,::1/128"></label>
        <button class="primary" type="submit">Save</button>
        <p class="msg" id="px-msg" aria-live="polite"></p>
      </form>
      <p class="meta" id="px-seen"></p>
      <p class="hint">Jiggered counts failed sign-ins per address and shows where people are signed in from. Behind a proxy everyone would look like the proxy unless it is told to read the real address. After saving, the line above should show your own address.</p>
      <p class="meta" id="px-cookie"></p>
    </div>
    <div class="panel">
      <h2>Backup</h2>
      <p class="meta">Downloads a compressed ZIP copy of the whole database. It includes everyone's check-ins and episodes, so keep it somewhere private. To put one back, see "Backup and restore" in the README.</p>
      <label>Your password, to confirm<input type="password" id="backup-pw" autocomplete="current-password" aria-describedby="backup-msg"></label>
      <label class="radio"><input type="checkbox" id="backup-encrypt"> Protect this download with an encryption password</label>
      <div id="backup-encryption-fields" hidden><label>Encryption password<input type="password" id="backup-encryption-password" autocomplete="new-password" minlength="8"></label><label>Confirm encryption password<input type="password" id="backup-encryption-confirm" autocomplete="new-password"></label><p class="meta">Keep this password separately. Encrypted ZIP backups use Jiggered restore with a password file.</p></div>
      <button class="secondary" id="backup">Download ZIP backup</button>
      <p class="msg" id="backup-msg" aria-live="polite"></p>
      <p class="meta" id="admin-version"></p>
    </div>
  `;

const ADMIN_SECTIONS = [
  {id:"people", label:"People", hint:"Accounts & access", title:"People & access", description:"A welcoming space, with the right access for everyone.", panels:["users","adduser"]},
  {id:"email", label:"Email & signup", hint:"Delivery & registration", title:"Email & signup", description:"Help people join, verify their email and recover their accounts.", panels:[]},
  {id:"backups", label:"Backups", hint:"Storage & recovery", title:"Backup & recovery", description:"Keep a reliable copy of your instance, ready when you need it.", panels:["backup"]},
  {id:"defaults", label:"Shared defaults", hint:"New account starting points", title:"A thoughtful starting point", description:"Choose the activities and lists new members start with.", panels:["defaults-form"]},
  {id:"connection", label:"Connection", hint:"Proxy & network settings", title:"Connection settings", description:"Keep sign-in and client addresses working with your hosting setup.", panels:["proxyform"]},
  {id:"activity", label:"Activity", hint:"Recent admin events", title:"Instance activity", description:"See account and administration events in one place.", panels:["audit"]},
];

function initAdminNavigation(panel) {
  const workspace=document.createElement("div");workspace.className="admin-workspace";
  setHTML(workspace,html`<aside class="admin-sidebar"><p class="eyebrow">YOUR INSTANCE</p><h2>Administration</h2>
    <div class="admin-nav" role="tablist" aria-label="Administration sections" aria-orientation="vertical">${ADMIN_SECTIONS.map((section,i)=>html`<button type="button" role="tab" id="admin-tab-${section.id}" data-admin-section="${section.id}" aria-controls="admin-section-${section.id}" aria-selected="false" tabindex="-1"><span class="admin-nav-number" aria-hidden="true">${String(i+1).padStart(2,"0")}</span><span><b>${section.label}</b><small>${section.hint}</small></span><span class="admin-nav-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>`)}</div>
    <p class="admin-nav-note">A little care behind the scenes.</p></aside>
    <div class="admin-content"><div class="admin-intro"><div><p class="eyebrow">INSTANCE MANAGEMENT</p><h2 id="admin-section-title"></h2><p id="admin-section-description" class="meta"></p></div><span class="badge" id="admin-people-count">Loading people</span></div>
    ${ADMIN_SECTIONS.map(section=>html`<section id="admin-section-${section.id}" class="admin-section" role="tabpanel" aria-labelledby="admin-tab-${section.id}" tabindex="0" hidden></section>`)}</div>`);
  const confirmation=$("admin-confirm-pw").closest(".panel");confirmation.classList.add("admin-confirmation");
  workspace.querySelector(".admin-intro").after(confirmation);
  for(const section of ADMIN_SECTIONS)for(const id of section.panels)workspace.querySelector("#admin-section-"+section.id).append($(id).closest(".panel"));
  const servicePanel=$("services-form").closest(".service-panel");
  workspace.querySelector("#admin-section-email").append(servicePanel);
  panel.append(workspace);
  const tabs=[...workspace.querySelectorAll("[data-admin-section]")];
  function select(id,focus=false) {
    const section=ADMIN_SECTIONS.find(section=>section.id===id);if(!section)return;
    tabs.forEach(tab=>{const active=tab.dataset.adminSection===id;tab.setAttribute("aria-selected",String(active));tab.tabIndex=active?0:-1});
    for(const item of ADMIN_SECTIONS)$("admin-section-"+item.id).hidden=item.id!==id;
    confirmation.hidden=!["people","defaults","connection"].includes(id);
    $("admin-section-title").textContent=section.title;$("admin-section-description").textContent=section.description;
    if(id==="email"||id==="backups"){
      $("admin-section-"+id).prepend(servicePanel);
      servicePanel.querySelectorAll("[data-service-area]").forEach(el=>el.hidden=el.dataset.serviceArea!==id);
      servicePanel.querySelector(".service-heading .eyebrow").textContent=id==="email"?"ACCOUNT SERVICES":"DATA PROTECTION";
      $("services-title").textContent=id==="email"?"Email delivery & registration":"Off-site backups";
      $("svc-status").hidden=id==="email";
      servicePanel.querySelectorAll("[data-service-action]").forEach(button=>button.hidden=id==="email"?button.dataset.serviceAction!=="test_email":button.dataset.serviceAction==="test_email");
      $("svc-remote").hidden=true;
    }
    if(focus)$("admin-tab-"+id).focus();
  }
  tabs.forEach(tab=>tab.addEventListener("click",()=>select(tab.dataset.adminSection)));
  workspace.querySelector(".admin-nav").addEventListener("keydown",event=>{
    const index=tabs.indexOf(event.target);if(index<0)return;
    let next;if(["ArrowDown","ArrowRight"].includes(event.key))next=(index+1)%tabs.length;
    else if(["ArrowUp","ArrowLeft"].includes(event.key))next=(index+tabs.length-1)%tabs.length;
    else if(event.key==="Home")next=0;else if(event.key==="End")next=tabs.length-1;else return;
    event.preventDefault();select(tabs[next].dataset.adminSection,true);
  });
  // Native validation must be able to reveal an invalid field in the other service section.
  $("services-form").addEventListener("invalid",event=>{
    const first=$("services-form").querySelector("input:invalid,select:invalid,textarea:invalid")||event.target;
    const area=first.closest("[data-service-area]");if(area){select(area.dataset.serviceArea);if(area.tagName==="DETAILS")area.open=true}
  },true);
  select("people");
}

// mount adds the Admin tab and its panel to the page and returns the view; destroy takes them away again.
export function mount(ctx) {
  const tab = Object.assign(document.createElement("button"), { id: "t-admin", textContent: "Admin" });
  tab.dataset.tab = "admin";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false"); tab.setAttribute("aria-controls", "admin-panel"); tab.tabIndex = -1;
  $("tabs").append(tab);
  const panel = Object.assign(document.createElement("section"), { id: "admin-panel", hidden: true });
  panel.setAttribute("role", "tabpanel"); panel.setAttribute("aria-labelledby", "t-admin");
  panel.innerHTML = MARKUP;
  $("account-panel").after(panel);
  initAdminNavigation(panel);
  const view = wire(ctx);
  return { ...view, destroy() { view.destroy(); tab.remove(); panel.remove() } };
}

function wire(ctx) {
  const { me } = ctx;
  const services = initServices(ctx);
 let factorResetTarget="";
 $("factor-reset-cancel").addEventListener("click",()=>{$("factor-reset-form").reset();$("factor-reset-dialog").close()});
 $("factor-reset-dialog").addEventListener("close",()=>$("factor-reset-form").reset());
 $("factor-reset-form").addEventListener("submit",e=>{e.preventDefault();withBusy(e.target.querySelector("[type=submit]"),"Resetting…",async()=>{const password=$("factor-reset-password").value,code=$("factor-reset-code").value;$("factor-reset-form").reset();const r=await api("POST","/api/admin/users/"+encodeURIComponent(factorResetTarget)+"/two-factor-reset",{password,code},{"X-Jiggered-Password":password});if(!r.ok)return say($("factor-reset-msg"),r.error,true);$("factor-reset-dialog").close();say($("users-msg"),r.data.message);loadAudit(true)})});
  let users = [], oldest = 0, loaded = false;

  function confirmation() {
    const field = $("admin-confirm-pw"), password = field.value;
    field.value = "";
    if (!password) { field.focus(); return null }
    return { "X-Jiggered-Password": password };
  }
  async function adminAPI(method,path,body,headers={}) {
    const proof = confirmation();
    if (!proof) return { ok:false, error:"Enter your password to confirm this change." };
    return api(method,path,body,{...headers,...proof});
  }
  async function loadUsers() {
    const target = $("users-msg"); if (!target) return;
    say(target, "Loading people…");
    const r = await api("GET", "/api/admin/users");
    if (!$("users-msg")) return;
    if (!r.ok) { say($("users-msg"), `Couldn't load people: ${r.error}. Use Refresh people to retry.`, true); return }
    say($("users-msg"), `Updated ${new Date().toLocaleTimeString()}.`);
    users = r.data.users;
    const admins=users.filter(user=>user.role==="admin").length;
    $("admin-people-count").textContent=`${users.length} ${users.length===1?"person":"people"} · ${admins} ${admins===1?"admin":"admins"}`;
    $("admin-version").textContent = `Jiggered ${r.data.version}`;
    renderUsers();
  }

  function renderUsers() {
    setHTML($("users"), html`${users.map(u => {
      const self = u.id === me.id;
      return html`<li data-id="${u.id}" data-name="${u.username}">
        <div class="top"><b>${u.username}</b>${self ? html` <span class="badge">you</span>` : ""}${u.role === "admin" ? html` <span class="badge">admin</span>` : ""}${u.disabled ? html` <span class="badge off">disabled</span>` : ""}${u.must_change_password && !u.disabled ? html` <span class="badge wait">hasn't chosen a password yet</span>` : ""}</div>
        <div class="meta">${u.last_login_at ? "Last signed in " + ago(u.last_login_at) : "Never signed in"} · ${u.docs} ${u.docs === 1 ? "entry" : "entries"} (${fmtBytes(u.bytes)}) · signed in on ${u.sessions} ${u.sessions === 1 ? "device" : "devices"}</div>
        ${self ? "" : html`<details class="admin-user-actions"><summary>Manage account</summary><div class="actions">
          <button class="secondary small" data-act="reset">Reset password</button>
          <button class="secondary small" data-act="signout"${u.sessions ? "" : " disabled"}>Sign out everywhere</button>
          <button class="secondary small" data-act="${u.disabled ? "enable" : "disable"}">${u.disabled ? "Enable" : "Disable"}</button>
          <button class="secondary small" data-act="${u.role === "admin" ? "demote" : "promote"}">${u.role === "admin" ? "Remove admin" : "Make admin"}</button>
          <button class="secondary small" data-act="two-factor-reset">Reset two-step verification</button>
          <button class="danger small" data-act="delete">Delete</button>
        </div></details>`}
      </li>`;
    })}`);
  }

  function reveal(who, pw) {
    $("reveal-who").textContent = who;
    $("reveal-pw").textContent = `Sign in at ${location.origin}/login\nUsername: ${who}\nTemporary password: ${pw}\nChoose your own password at first sign-in.`;
    $("reveal").hidden = false;
    $("reveal-copy").textContent = "Copy sign-in instructions";
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
    return withBusy(b, "Working…", async () => {
    const li = b.closest("li"), id = li.dataset.id, name = li.dataset.name, msg = $("users-msg");
    const path = "/api/admin/users/" + id;
    say(msg, "");
    let r;
    switch (b.dataset.act) {
      case "two-factor-reset": {
        factorResetTarget=name; $('factor-reset-form').reset();say($('factor-reset-msg'),'');
        $('factor-reset-description').textContent=`This removes ${name}’s authenticator protection and signs out every device. Verify their identity before continuing.`;
        $('factor-reset-dialog').showModal();$('factor-reset-password').focus();return;
      }
      case "reset":
        if (!confirm(`Reset ${name}'s password? They'll be signed out everywhere and given a temporary one.`)) return;
        r = await adminAPI("POST", path + "/reset-password");
        if (r.ok) reveal(name, r.data.temp_password);
        break;
      case "signout":
        r = await adminAPI("POST", path + "/revoke-sessions");
        if (r.ok) say(msg, `${name} was signed out everywhere.`);
        break;
      case "disable":
        if (!confirm(`Disable ${name}? They'll be signed out and unable to sign in until you enable them again. Their data is kept.`)) return;
        r = await adminAPI("PATCH", path, { disabled: true });
        break;
      case "enable": r = await adminAPI("PATCH", path, { disabled: false }); break;
      case "promote":
        if (!confirm(`Make ${name} an admin? They'll be able to add people and manage every account (including resetting passwords and downloading a backup of everyone's data).`)) return;
        r = await adminAPI("PATCH", path, { role: "admin" });
        break;
      case "demote": r = await adminAPI("PATCH", path, { role: "user" }); break;
      case "delete": {
        const typed = prompt(`This permanently deletes ${name} and everything they've logged.\n\nType their username to confirm:`);
        if (typed === null) return;
        r = await adminAPI("DELETE", path + "?confirm=" + encodeURIComponent(typed.trim()));
        if (r.ok) say(msg, `${name} was deleted.`);
        break;
      }
    }
    if (r && !r.ok) say(msg, r.error, true);
    loadUsers();
    loadAudit(true);
    });
  });

  $("adduser").addEventListener("submit", async e => {
    e.preventDefault();
    return withBusy($("adduser").querySelector("[type=submit]"), "Creating…", async () => {
    const msg = $("adduser-msg"), username = $("new-name").value.trim();
    if ($("new-admin").checked && !confirm(`Create ${username} as an admin? They can reset passwords, manage all accounts and download everyone's private data.`)) return;
    say(msg, "Creating…");
    const r = await adminAPI("POST", "/api/admin/users", { username, role: $("new-admin").checked ? "admin" : "user" });
    if (!r.ok) return say(msg, r.error, true);
    say(msg, `Created ${r.data.user.username}.`);
    $("adduser").reset();
    reveal(r.data.user.username, r.data.temp_password);
    loadUsers();
    loadAudit(true);
    });
  });

  async function loadAudit(fresh) {
    const r = await api("GET", "/api/admin/audit?limit=30" + (fresh || !oldest ? "" : "&before=" + oldest));
    if (!$("audit-msg")) return;
    if (!r.ok) { say($("audit-msg"), `Couldn't load activity: ${r.error}. Refresh to retry.`, true); return }
    say($("audit-msg"), r.data.length ? `Updated ${new Date().toLocaleTimeString()}.` : "No activity in this page.");
    const line = en => html`<li><span>${sentence(en)}${en.detail ? html` <span class="meta">(${en.detail})</span>` : ""}</span><span class="meta">${ago(en.at)}${en.ip ? " · " + en.ip : ""}</span></li>`;
    if (fresh) setHTML($("audit"), html`${r.data.map(line)}`);
    else appendHTML($("audit"), html`${r.data.map(line)}`);
    if (r.data.length) oldest = r.data[r.data.length - 1].id;
    $("audit-more").hidden = r.data.length < 30;
  }
  $("users-retry").addEventListener("click", () => loadUsers());
  $("audit-refresh").addEventListener("click", () => loadAudit(true));
  $("audit-more").addEventListener("click", () => loadAudit(false));

  $("backup-encrypt").addEventListener("change",()=>{$("backup-encryption-fields").hidden=!$("backup-encrypt").checked;if(!$("backup-encrypt").checked){$("backup-encryption-password").value="";$("backup-encryption-confirm").value=""}});
  $("backup").addEventListener("click", async () => withBusy($("backup"), "Preparing…", async () => {
    const msg = $("backup-msg"), pw = $("backup-pw");
    if (!pw.value) { pw.focus(); return say(msg, "Enter your password to download a backup.", true) }
    const encryptionPassword=$("backup-encrypt").checked?$("backup-encryption-password").value:"";
    if($("backup-encrypt").checked && (encryptionPassword.length<8||encryptionPassword!==$("backup-encryption-confirm").value)){return say(msg,"Enter an encryption password of at least 8 characters and match it in both fields.",true)}
    say(msg, "Preparing the ZIP backup…");
    let r;
    try { r = await fetch("/api/admin/backup", { method: "POST", body: JSON.stringify({ password: pw.value,encryption_password:encryptionPassword }), signal: AbortSignal.timeout(300000), credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Requested-With": "jiggered", "X-Jiggered-User": String(me.id) } }) }
    catch { return say(msg, "Couldn't reach the server. Check your connection and try again.", true) }
    if (!r.ok) {
      const why = await r.json().then(j => j.error, () => "");
      return say(msg, why || `The backup failed (${r.status}).`, true);
    }
    pw.value = "";$("backup-encryption-password").value="";$("backup-encryption-confirm").value=""; // asked for again next time
    const url = URL.createObjectURL(await r.blob());
    const name = (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] || "jiggered-backup.zip";
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(msg, "Backup downloaded.");
    loadAudit(true);
  }));

  // ---- how Jiggered finds out who is connecting ----
  function showConnection(c) {
    $("px-on").checked = c.trust_proxy;
    $("px-hops").value = c.proxy_hops;
    $("px-cidrs").value = c.trusted_proxy_cidrs || "";
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
    if (!$("px-msg")) return;
    if (r.ok) showConnection(r.data); else say($("px-msg"), r.error, true);
  }
  $("px-on").addEventListener("change", () => { $("px-hops").disabled = !$("px-on").checked });
  $("proxyform").addEventListener("submit", async e => {
    e.preventDefault();
    return withBusy($("proxyform").querySelector("[type=submit]"), "Saving…", async () => {
    const msg = $("px-msg");
    say(msg, "Saving…");
    const r = await adminAPI("PATCH", "/api/admin/settings", { trust_proxy: $("px-on").checked, proxy_hops: Number($("px-hops").value) || 1, trusted_proxy_cidrs: $("px-cidrs").value });
    if (!r.ok) return say(msg, r.error, true);
    showConnection(r.data);
    say(msg, "Saved.");
    loadAudit(true);
    });
  });

  const defaultsForm = $("defaults-form");
  setHTML(defaultsForm, editorMarkup("def"));
  let defaultsDirty = false, defaultsETag = "", defaultSaving = false;
  const defaultsEditor = createEditor(defaultsForm, "def", () => { defaultsDirty = true; ctx.drafts.put("admin-defaults", { body: defaultsEditor.read(), tag: defaultsETag }) });
  const defaultDraft = ctx.drafts.get("admin-defaults");
  defaultsEditor.fill(defaultDraft?.body || ctx.defaults()); defaultsDirty = !!defaultDraft; defaultsETag = defaultDraft?.tag || "";
  async function loadProductDefaults(replace = false) {
    if (replace && defaultsDirty && !confirm("Replace your unfinished defaults draft with the latest shared version?")) return;
    const result = await ctx.loadDefaults(); if (!$("def-msg")) return;
    if (!result.fresh || !result.tag) { say($("def-msg"), "Connect to load shared defaults before saving.", true); return }
    if (!defaultsDirty || replace) { defaultsETag = result.tag; defaultsEditor.fill(result.body); defaultsDirty = false; ctx.drafts.remove("admin-defaults"); say($("def-msg"), result.fallback ? "Stored defaults were damaged. Factory defaults are shown; Save to repair them." : "Latest shared defaults loaded.", result.fallback) }
    else say($("def-msg"), "Your unfinished defaults draft is kept. Reload latest to replace it.");
  }
  $("defaults-reload").addEventListener("click", () => loadProductDefaults(true));
  defaultsForm.querySelector('[data-discard]').addEventListener("click", () => loadProductDefaults(true));
  defaultsForm.querySelector('[data-reset]').addEventListener("click", () => {
    if (defaultsDirty && !confirm("Replace this draft with factory defaults?")) return;
    defaultsEditor.fill(DEFAULTS); defaultsDirty = true; ctx.drafts.put("admin-defaults", { body: defaultsEditor.read(), tag: defaultsETag }); say($("def-msg"), "Factory defaults filled in. Save to publish them.");
  });
  defaultsForm.addEventListener("submit", async e => {
    e.preventDefault(); if (defaultSaving) return;
    const body = defaultsEditor.validate(); if (!body) return;
    if (!defaultsETag) return say($("def-msg"), "Load the shared defaults while connected before saving.", true);
    defaultSaving = true;
    await withBusy(defaultsForm.querySelector('[type=submit]'), "Saving…", async () => {
      const proof = confirmation(); if (!proof) { say($("def-msg"),"Enter your password to confirm this change.",true); return }
      let r; try { r = await fetch("/api/admin/defaults", { method: "PUT", credentials: "same-origin", headers: { "X-Requested-With": "jiggered", "X-Jiggered-User": String(me.id), "Content-Type": "application/json", "If-Match": defaultsETag, ...proof }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) }) }
      catch { say($("def-msg"), "Couldn't connect. Your defaults draft is kept on this device.", true); return }
      const value = await r.json().catch(() => ({})); if (!$("def-msg")) return;
      if (!r.ok) return say($("def-msg"), value.error || `Save failed (${r.status}). Draft kept.`, true);
      defaultsETag = r.headers.get("ETag"); ctx.setDefaults(value, defaultsETag);
      if (JSON.stringify(defaultsEditor.validate()) === JSON.stringify(body)) { defaultsDirty = false; ctx.drafts.remove("admin-defaults") }
      say($("def-msg"), "Shared defaults saved. Existing personal lists are unchanged."); loadAudit(true);
    });
    defaultSaving = false;
  });

  return {
    render() {},
    destroy() { services.destroy() },
    show() {
      if (!loaded) { loaded = true; $("reveal").hidden = true }
      services.load();
      loadUsers();
      loadAudit(true);
      loadConnection();
      loadProductDefaults();
    },
  };
}

