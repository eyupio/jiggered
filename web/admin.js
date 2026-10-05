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
  login: (e) => `${e.actor} signed in`,
  login_failed: (e) => `Failed sign-in for ${e.target}`,
  login_refused: (e) => `${e.target} tried to sign in but the account is disabled`,
  password_changed: (e) => `${e.actor} changed their password`,
  password_check_failed: (e) => `${e.actor} gave a wrong password`,
  password_reset: (e) => `${e.actor} reset ${e.target}'s password`,
  user_created: (e) => `${e.actor} added ${e.target}`,
  user_deleted: (e) => `${e.actor} removed ${e.target}`,
  user_disabled: (e) => `${e.actor} disabled ${e.target}`,
  user_enabled: (e) => `${e.actor} enabled ${e.target}`,
  role_changed: (e) => `${e.actor} changed ${e.target}'s role`,
  sessions_revoked: (e) =>
    e.actor === e.target
      ? `${e.actor} signed out their devices`
      : `${e.actor} signed ${e.target} out everywhere`,
  session_revoked: (e) => `${e.actor} signed out one of their devices`,
  account_deleted: (e) => `${e.actor} deleted their account`,
  backup_downloaded: (e) => `${e.actor} downloaded a backup`,
  import: (e) => `${e.actor} restored from a file`,
  admin_created: (e) => `${e.target} was set up as the first admin`,
  account_email_failed: () => "Account email could not be sent. Check Email & signup.",
  account_mail_accepted: () => "Account email accepted by SMTP; inbox delivery is not confirmed",
  remote_backup_started: (e) => `${e.actor} started an off-site backup`,
  remote_backup_success: () => "Off-site backup completed",
  remote_backup_warning: () => "Backup copy uploaded; retention needs attention",
  remote_backup_failed: () => "Off-site backup failed. Check Backups.",
  remote_settings_changed: (e) => `${e.actor} changed backup/email configuration`,
  email_test_sent: (e) => `${e.actor} sent a test email`,
  two_factor_setup: (e) => `${e.actor} started authenticator setup`,
  two_factor_cancel: (e) => `${e.actor} cancelled authenticator setup`,
  two_factor_enable: (e) => `${e.actor} enabled two-step verification`,
  two_factor_disable: (e) => `${e.actor} disabled two-step verification`,
  two_factor_regenerate: (e) => `${e.actor} replaced recovery codes`,
  two_factor_admin_reset: (e) => `${e.actor} reset ${e.target}’s authenticator protection`,
  email_verified: () => "Email ownership verified",
  account_registered: (e) => `${e.actor} registered an account`,
  remote_backup_interrupted: () =>
    "Off-site backup interrupted; check the destination before retrying",
  remote_backup_downloaded: (e) => `${e.actor} downloaded an off-site backup`,
  usage_settings_changed: (e) => `${e.actor} changed optional usage measurement settings`,
  password_recovered: (e) => `${e.actor} reset their password through email`,
  defaults_changed: (e) => `${e.actor} updated the shared product defaults`,
  settings_changed: (e) => `${e.actor} changed a setting`,
  settings_imported: () => `Settings were copied from the environment into the database`,
  migrated: (e) => `${e.target} took over the data from before accounts existed`,
};
const sentence = (e) =>
  (SENTENCE[e.action] || ((x) => `${x.actor || "System"}: ${x.action.replaceAll("_", " ")}`))({
    ...e,
    actor: e.actor || "System",
  });

function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
}

const MARKUP = `${servicesMarkup}
<dialog id="reveal" class="panel security-dialog" aria-labelledby="reveal-title"><h2 id="reveal-title">Temporary password</h2><p class="meta"><b id="reveal-who"></b> can sign in with this temporary password. It is shown once: copy it before you close this. They will choose their own at first sign-in.</p><code id="reveal-pw"></code><div class="service-actions"><button class="primary" id="reveal-copy" type="button">Copy sign-in instructions</button><button class="secondary" id="reveal-hide" type="button">Close</button></div></dialog>
<dialog id="factor-reset-dialog" class="panel security-dialog" aria-labelledby="factor-reset-title"><form id="factor-reset-form"><h2 id="factor-reset-title">Reset two-step verification</h2><p class="meta" id="factor-reset-description"></p><label>Your admin password<input id="factor-reset-password" type="password" autocomplete="current-password" required></label><label>Your authenticator or recovery code<input id="factor-reset-code" autocomplete="one-time-code" autocapitalize="none"><span class="meta">Required if your own account has two-step verification enabled.</span></label><p class="msg" role="status" id="factor-reset-msg"></p><div class="service-actions"><button class="danger" type="submit">Reset & sign out devices</button><button class="secondary" type="button" id="factor-reset-cancel">Cancel</button></div></form></dialog>
    <div class="panel"><label class="field">Confirm an admin change<input type="password" id="admin-confirm-pw" autocomplete="current-password"></label><p class="hint">Your password confirms changes to accounts, connection settings and shared defaults.</p></div>
    <div class="panel">
      <h2>People</h2>
      <p class="meta">You can add people, reset passwords, sign devices out and remove accounts. These screens don't show anyone's check-ins or episodes, only how many they have. Remember that resetting a password lets you sign in as that person, and a backup contains everything.</p>
      <div class="row2"><label class="field">Find a person<input id="people-search" type="search" /></label><label class="field">Account state<select id="people-state"><option value="">All people</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="new">Awaiting first password</option></select></label></div><p class="meta" id="people-matches" role="status"></p>
      <ul class="list people" id="users"></ul>
      <p class="msg" id="users-msg" aria-live="polite"></p><button class="secondary" id="users-retry">Refresh people</button>
    </div>
    <div class="panel">
      <div class="banner setup-notes" id="setup-notes" role="status" hidden></div>
      <h2>Add someone</h2>
      <form id="adduser">
        <label class="field">Username<input type="text" id="new-name" autocomplete="off" autocapitalize="none" maxlength="64" required></label>
        <label class="radio"><input type="checkbox" id="new-admin"> Admin: manage accounts, reset passwords and download everyone's data</label>
        <button class="primary" type="submit">Create account</button>
        <p class="msg" id="adduser-msg" aria-live="polite"></p>
      </form>
    </div>
    <div class="panel">
      <h2>Activity</h2>
      <form id="audit-filters" class="row2"><label class="field">Person (exact username)<input type="search" id="audit-person" maxlength="64" /></label><label class="field">Event type<select id="audit-family"><option value="">All events</option><option value="login">Sign-in</option><option value="account">Accounts & access</option><option value="email">Email delivery</option><option value="backup">Backups</option><option value="settings">Settings</option></select></label><label class="field">From (UTC)<input type="date" id="audit-from" /></label><label class="field">To (UTC)<input type="date" id="audit-to" /></label><div class="row"><button type="submit" class="primary">Apply filters</button><button type="reset" class="secondary">Clear filters</button></div></form>
      <ul class="list audit" id="audit"></ul><p class="msg" id="audit-msg" role="status"></p><button class="secondary" id="audit-refresh">Refresh activity</button>
      <button class="secondary" id="audit-more" hidden>Show older</button>
    </div>
    <div class="panel"><h2>Optional local usage measurement</h2><p class="meta">Disabled by default. Turning this on only offers users a separate opt-in in Account. No health details or external service. Weekly aggregates require at least five consenting participants per event; counts are capped at 100 per person/event/week and retained for up to 90 days. Users can disable and delete their events. This adds local storage and privacy responsibility.</p><form id="usage-form"><label class="radio"><input id="usage-enabled" type="checkbox"> Offer optional usage measurement</label><label class="radio"><input id="usage-clear" type="checkbox"> Delete all collected task counts when saving</label><label class="field">Your admin password<input id="usage-password" type="password" autocomplete="current-password" required></label><button type="submit" class="secondary">Save measurement settings</button><p id="usage-msg" class="msg" role="status"></p></form><div id="usage-report"></div></div>
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
  {
    id: "people",
    label: "People",
    hint: "Accounts & access",
    title: "People & access",
    description: "A welcoming space, with the right access for everyone.",
    panels: ["adduser", "users"],
  },
  {
    id: "email",
    label: "Email & signup",
    hint: "Delivery & registration",
    title: "Email & signup",
    description: "Help people join, verify their email and recover their accounts.",
    panels: [],
  },
  {
    id: "backups",
    label: "Backups",
    hint: "Storage & recovery",
    title: "Backup & recovery",
    description: "Keep a reliable copy of your instance, ready when you need it.",
    panels: ["backup"],
  },
  {
    id: "defaults",
    label: "Shared defaults",
    hint: "New account starting points",
    title: "A thoughtful starting point",
    description: "Choose the activities and lists new members start with.",
    panels: ["defaults-form"],
  },
  {
    id: "connection",
    label: "Connection",
    hint: "Proxy & network settings",
    title: "Connection settings",
    description: "Keep sign-in and client addresses working with your hosting setup.",
    panels: ["proxyform"],
  },
  {
    id: "activity",
    label: "Activity",
    hint: "Recent admin events",
    title: "Instance activity",
    description: "See account and administration events in one place.",
    panels: ["audit", "usage-form"],
  },
];

function initAdminNavigation(panel, ctx) {
  const workspace = document.createElement("div");
  workspace.className = "admin-workspace";
  setHTML(
    workspace,
    html`<aside class="admin-sidebar"><p class="eyebrow">YOUR INSTANCE</p><h2>Administration</h2>
    <div class="admin-nav" role="tablist" aria-label="Administration sections" aria-orientation="vertical">${ADMIN_SECTIONS.map(
      (section, i) =>
        html`<button type="button" role="tab" id="admin-tab-${section.id}" data-admin-section="${section.id}" aria-controls="admin-section-${section.id}" aria-selected="false" tabindex="-1"><span class="admin-nav-number" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><span><b>${section.label}</b><small>${section.hint}</small></span><span class="admin-nav-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>`,
    )}</div>
    <p class="admin-nav-note">A little care behind the scenes.</p></aside>
    <div class="admin-content"><div class="admin-intro"><div><p class="eyebrow">INSTANCE MANAGEMENT</p><h2 id="admin-section-title"></h2><p id="admin-section-description" class="meta"></p></div><span class="badge" id="admin-people-count">Loading people</span></div>
    ${ADMIN_SECTIONS.map((section) => html`<section id="admin-section-${section.id}" class="admin-section" role="tabpanel" aria-labelledby="admin-tab-${section.id}" tabindex="0" hidden></section>`)}</div>`,
  );
  const confirmation = $("admin-confirm-pw").closest(".panel");
  confirmation.classList.add("admin-confirmation");
  workspace.querySelector(".admin-intro").after(confirmation);
  for (const section of ADMIN_SECTIONS)
    for (const id of section.panels)
      workspace.querySelector("#admin-section-" + section.id).append($(id).closest(".panel"));
  const servicePanel = $("services-form").closest(".service-panel");
  workspace.querySelector("#admin-section-email").append(servicePanel);
  panel.append(workspace);
  const tabs = [...workspace.querySelectorAll("[data-admin-section]")];
  function select(id, focus = false) {
    const section = ADMIN_SECTIONS.find((section) => section.id === id);
    if (!section) return;
    tabs.forEach((tab) => {
      const active = tab.dataset.adminSection === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    for (const item of ADMIN_SECTIONS) $("admin-section-" + item.id).hidden = item.id !== id;
    confirmation.hidden = !["people", "defaults", "connection"].includes(id);
    $("admin-section-title").textContent = section.title;
    $("admin-section-description").textContent = section.description;
    if (id === "email" || id === "backups") {
      $("admin-section-" + id).prepend(servicePanel);
      servicePanel
        .querySelectorAll("[data-service-area]")
        .forEach((el) => (el.hidden = el.dataset.serviceArea !== id));
      servicePanel.querySelector(".service-heading .eyebrow").textContent =
        id === "email" ? "ACCOUNT SERVICES" : "DATA PROTECTION";
      $("services-title").textContent =
        id === "email" ? "Email delivery & registration" : "Off-site backups";
      $("svc-status").hidden = id === "email";
      servicePanel
        .querySelectorAll("[data-service-action]")
        .forEach(
          (button) =>
            (button.hidden =
              id === "email"
                ? button.dataset.serviceAction !== "test_email"
                : button.dataset.serviceAction === "test_email"),
        );
      $("svc-remote").hidden = true;
    }
    if (focus) $("admin-tab-" + id).focus();
  }
  panel.addEventListener("click", (e) => {
    const button = e.target.closest("[data-audit-open]");
    if (button) select(button.dataset.auditOpen);
  });
  tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.adminSection)));
  workspace.querySelector(".admin-nav").addEventListener("keydown", (event) => {
    const index = tabs.indexOf(event.target);
    if (index < 0) return;
    let next;
    if (["ArrowDown", "ArrowRight"].includes(event.key)) next = (index + 1) % tabs.length;
    else if (["ArrowUp", "ArrowLeft"].includes(event.key))
      next = (index + tabs.length - 1) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    select(tabs[next].dataset.adminSection, true);
  });
  // Native validation must be able to reveal an invalid field in the other service section.
  $("services-form").addEventListener(
    "invalid",
    (event) => {
      const first =
        $("services-form").querySelector("input:invalid,select:invalid,textarea:invalid") ||
        event.target;
      const area = first.closest("[data-service-area]");
      if (area) {
        select(area.dataset.serviceArea);
        if (area.tagName === "DETAILS") area.open = true;
      }
    },
    true,
  );
  const saved = ctx.ui?.get("admin").section;
  select(ADMIN_SECTIONS.some((section) => section.id === saved) ? saved : "people");
}

// mount adds the Admin tab and its panel to the page and returns the view; destroy takes them away again.
export function mount(ctx) {
  const tab = Object.assign(document.createElement("button"), {
    id: "t-admin",
    textContent: "Admin",
  });
  tab.dataset.tab = "admin";
  tab.setAttribute("role", "tab");
  tab.setAttribute("aria-selected", "false");
  tab.setAttribute("aria-controls", "admin-panel");
  tab.tabIndex = -1;
  $("tabs").append(tab);
  const panel = Object.assign(document.createElement("section"), {
    id: "admin-panel",
    hidden: true,
  });
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", "t-admin");
  panel.innerHTML = MARKUP;
  $("account-panel").after(panel);
  initAdminNavigation(panel, ctx);
  const view = wire(ctx);
  return {
    ...view,
    snapshot: () => ({
      auditFilters: Object.fromEntries(
        ["person", "family", "from", "to"].map((k) => [k, $("audit-" + k).value]),
      ),
      peopleSearch: $("people-search").value,
      peopleState: $("people-state").value,
      auditShown: Math.max(30, $("audit").children.length),
      encryptBackup: $("backup-encrypt").checked,
      section: panel.querySelector('[data-admin-section][aria-selected="true"]').dataset
        .adminSection,
    }),
    destroy() {
      view.destroy();
      tab.remove();
      panel.remove();
    },
  };
}

function wire(ctx) {
  const { me } = ctx;
  const savedUI = ctx.ui?.get("admin") || {};
  const services = initServices(ctx);
  let factorResetTarget = "";
  $("factor-reset-cancel").addEventListener("click", () => {
    $("factor-reset-form").reset();
    $("factor-reset-dialog").close();
  });
  $("factor-reset-dialog").addEventListener("close", () => $("factor-reset-form").reset());
  $("factor-reset-form").addEventListener("submit", (e) => {
    e.preventDefault();
    withBusy(e.target.querySelector("[type=submit]"), "Resetting…", async () => {
      const password = $("factor-reset-password").value,
        code = $("factor-reset-code").value;
      $("factor-reset-form").reset();
      const r = await api(
        "POST",
        "/api/admin/users/" + encodeURIComponent(factorResetTarget) + "/two-factor-reset",
        { password, code },
        { "X-Jiggered-Password": password },
      );
      if (!r.ok) return say($("factor-reset-msg"), r.error, true);
      $("factor-reset-dialog").close();
      say($("users-msg"), r.data.message);
      loadAudit(true);
    });
  });
  const auditFilters = () =>
    Object.fromEntries(["person", "family", "from", "to"].map((k) => [k, $("audit-" + k).value]));
  for (const key of ["person", "family", "from", "to"])
    $("audit-" + key).value = savedUI.auditFilters?.[key] || "";
  $("audit-filters").addEventListener("submit", (e) => {
    e.preventDefault();
    loadAudit(true);
  });
  $("audit-filters").addEventListener("reset", () => setTimeout(() => loadAudit(true), 0));
  $("people-search").value = savedUI.peopleSearch || "";
  $("people-state").value = savedUI.peopleState || "";
  // A long list is shown twenty people at a time: the last row's buttons used to sit under the tab bar.
  const PEOPLE_PAGE = 20;
  let peopleShown = PEOPLE_PAGE;
  const refilter = () => {
    peopleShown = PEOPLE_PAGE;
    renderUsers();
  };
  $("people-search").addEventListener("input", refilter);
  $("people-state").addEventListener("change", refilter);
  let limits = { docs: 10000, bytes: 25 * 1024 * 1024 };
  let users = [],
    oldest = 0;

  function confirmation() {
    const field = $("admin-confirm-pw"),
      password = field.value;
    field.value = "";
    if (!password) {
      field.focus();
      return null;
    }
    return { "X-Jiggered-Password": password };
  }
  async function adminAPI(method, path, body, headers = {}) {
    const proof = confirmation();
    if (!proof) return { ok: false, error: "Enter your password to confirm this change." };
    return api(method, path, body, { ...headers, ...proof });
  }
  async function loadUsers() {
    const target = $("users-msg");
    if (!target) return;
    say(target, "Loading people…");
    const r = await api("GET", "/api/admin/users");
    if (!$("users-msg")) return;
    if (!r.ok) {
      say($("users-msg"), `Couldn't load people: ${r.error}. Use Refresh people to retry.`, true);
      return;
    }
    say($("users-msg"), `Updated ${new Date().toLocaleTimeString()}.`);
    users = r.data.users;
    limits = r.data.limits || limits;
    const admins = users.filter((user) => user.role === "admin").length;
    $("admin-people-count").textContent =
      `${users.length} ${users.length === 1 ? "person" : "people"} · ${admins} ${admins === 1 ? "admin" : "admins"}`;
    $("admin-version").textContent = `Jiggered ${r.data.version}`;
    renderUsers();
  }

  function renderUsers() {
    const query = $("people-search").value.trim().toLowerCase(),
      state = $("people-state").value;
    const matches = users.filter(
      (u) =>
        u.username.toLowerCase().includes(query) &&
        (!state ||
          (state === "disabled" && u.disabled) ||
          (state === "enabled" && !u.disabled) ||
          (state === "new" && u.must_change_password && !u.disabled)),
    );
    const shown = matches.slice(0, peopleShown);
    $("people-matches").textContent =
      `${matches.length} of ${users.length} people${matches.length ? "" : ". Clear your search or filters to see everyone."}${shown.length < matches.length ? ` Showing the first ${shown.length}.` : ""}`;
    ctx.ui?.details($("users"));
    setHTML(
      $("users"),
      html`${shown.map((u) => {
        const self = u.id === me.id;
        return html`<li data-id="${u.id}" data-name="${u.username}">
        <div class="top"><b>${u.username}</b>${self ? html` <span class="badge">you</span>` : ""}${u.role === "admin" ? html` <span class="badge">admin</span>` : ""}${u.disabled ? html` <span class="badge off">disabled</span>` : ""}${u.must_change_password && !u.disabled ? html` <span class="badge wait">hasn't chosen a password yet</span>` : ""}</div>
        <div class="meta">${u.last_login_at ? "Last signed in " + ago(u.last_login_at) : "Never signed in"} · ${u.docs} ${u.docs === 1 ? "entry" : "entries"} (${fmtBytes(u.bytes)} of ${fmtBytes(limits.bytes)}; ${u.docs}/${limits.docs} records) · signed in on ${u.sessions} ${u.sessions === 1 ? "device" : "devices"}</div>
        <p class="meta">Recovery email: ${u.recovery_ready ? "verified" : "not verified"} · Two-step: ${u.two_factor ? `enabled (${u.recovery_codes_left} unused recovery codes)` : "off"}${u.docs >= limits.docs * 0.9 || u.bytes >= limits.bytes * 0.9 ? " · Near storage limit; offer export and support" : ""}</p>
        ${
          self
            ? ""
            : html`<details class="admin-user-actions" id="admin-user-actions-${u.id}"><summary>Manage account</summary><div class="actions">
          <button class="secondary small" data-act="reset">Reset password</button>
          <button class="secondary small" data-act="signout"${u.sessions ? "" : " disabled"}>Sign out everywhere</button>
          <button class="secondary small" data-act="${u.disabled ? "enable" : "disable"}">${u.disabled ? "Enable" : "Disable"}</button>
          <button class="secondary small" data-act="${u.role === "admin" ? "demote" : "promote"}">${u.role === "admin" ? "Remove admin" : "Make admin"}</button>
          <button class="secondary small" data-act="two-factor-reset"${u.two_factor ? "" : html`disabled`}>Reset two-step verification</button>
          <button class="danger small" data-act="delete">Delete</button>
        </div></details>`
        }
      </li>`;
      })}${shown.length < matches.length ? html`<li class="people-more"><button class="secondary" type="button" data-more-people>Show ${Math.min(PEOPLE_PAGE, matches.length - shown.length)} more</button></li>` : ""}`,
    );
    ctx.ui?.details($("users"), true);
  }

  function reveal(who, pw) {
    $("reveal-who").textContent = who;
    $("reveal-pw").textContent =
      `Sign in at ${location.origin}/login\nUsername: ${who}\nTemporary password: ${pw}\nChoose your own password at first sign-in.`;
    $("reveal-copy").textContent = "Copy sign-in instructions";
    // The password is shown once, so it takes the whole screen: wherever the admin was in a long list, it is here.
    if (!$("reveal").open) $("reveal").showModal();
    $("reveal-copy").focus();
  }
  $("reveal-hide").addEventListener("click", () => $("reveal").close());
  $("reveal").addEventListener("close", () => {
    $("reveal-pw").textContent = "";
  });
  $("reveal-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("reveal-pw").textContent);
      $("reveal-copy").textContent = "Copied";
    } catch {
      // no clipboard access: select it so it can be copied by hand
      const r = document.createRange();
      r.selectNodeContents($("reveal-pw"));
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
  });

  $("users").addEventListener("click", async (e) => {
    if (e.target.closest("[data-more-people]")) {
      peopleShown += PEOPLE_PAGE;
      renderUsers();
      return;
    }
    const b = e.target.closest("[data-act]");
    if (!b) return;
    return withBusy(b, "Working…", async () => {
      const li = b.closest("li"),
        id = li.dataset.id,
        name = li.dataset.name,
        msg = $("users-msg");
      const path = "/api/admin/users/" + id;
      say(msg, "");
      if (b.dataset.act !== "two-factor-reset" && !$("admin-confirm-pw").value) {
        // Ask for the password before any dialog, and say why nothing happened.
        say(msg, "Type your password in “Confirm an admin change” first, then try again.", true);
        $("admin-confirm-pw").scrollIntoView({ block: "center" });
        $("admin-confirm-pw").focus();
        return;
      }
      let r;
      switch (b.dataset.act) {
        case "two-factor-reset": {
          factorResetTarget = name;
          $("factor-reset-form").reset();
          say($("factor-reset-msg"), "");
          $("factor-reset-description").textContent =
            `This removes ${name}’s authenticator protection and signs out every device. Verify their identity before continuing.`;
          $("factor-reset-dialog").showModal();
          $("factor-reset-password").focus();
          return;
        }
        case "reset":
          if (
            !confirm(
              `Reset ${name}'s password? They'll be signed out everywhere and given a temporary one.`,
            )
          )
            return;
          r = await adminAPI("POST", path + "/reset-password");
          if (r.ok) reveal(name, r.data.temp_password);
          break;
        case "signout":
          r = await adminAPI("POST", path + "/revoke-sessions");
          if (r.ok) say(msg, `${name} was signed out everywhere.`);
          break;
        case "disable":
          if (
            !confirm(
              `Disable ${name}? They'll be signed out and unable to sign in until you enable them again. Their data is kept.`,
            )
          )
            return;
          r = await adminAPI("PATCH", path, { disabled: true });
          break;
        case "enable":
          r = await adminAPI("PATCH", path, { disabled: false });
          break;
        case "promote":
          if (
            !confirm(
              `Make ${name} an admin? They'll be able to add people and manage every account (including resetting passwords and downloading a backup of everyone's data).`,
            )
          )
            return;
          r = await adminAPI("PATCH", path, { role: "admin" });
          break;
        case "demote":
          r = await adminAPI("PATCH", path, { role: "user" });
          break;
        case "delete": {
          const typed = prompt(
            `This permanently deletes ${name} and everything they've logged.\n\nType their username to confirm:`,
          );
          if (typed === null) return;
          r = await adminAPI("DELETE", path + "?confirm=" + encodeURIComponent(typed.trim()));
          if (r.ok) say(msg, `${name} was deleted.`);
          break;
        }
      }
      const failed = r && !r.ok ? r.error : "";
      const outcomes = {
        disable: "was disabled.",
        enable: "was enabled.",
        promote: "is now an admin.",
        demote: "is now an ordinary user.",
      };
      const done =
        r?.ok && outcomes[b.dataset.act]
          ? `${name} ${outcomes[b.dataset.act]}`
          : !failed && msg.textContent && !msg.classList.contains("err")
            ? msg.textContent
            : "";
      await loadUsers(); // the refresh writes its own status line, so say what happened after it
      if (failed) say(msg, failed, true);
      else if (done) say(msg, done);
      loadAudit(true);
    });
  });

  $("adduser").addEventListener("submit", async (e) => {
    e.preventDefault();
    return withBusy($("adduser").querySelector("[type=submit]"), "Creating…", async () => {
      const msg = $("adduser-msg"),
        username = $("new-name").value.trim();
      if (
        $("new-admin").checked &&
        !confirm(
          `Create ${username} as an admin? They can reset passwords, manage all accounts and download everyone's private data.`,
        )
      )
        return;
      say(msg, "Creating…");
      const r = await adminAPI("POST", "/api/admin/users", {
        username,
        role: $("new-admin").checked ? "admin" : "user",
      });
      if (!r.ok) return say(msg, r.error, true);
      say(msg, `Created ${r.data.user.username}.`);
      $("adduser").reset();
      reveal(r.data.user.username, r.data.temp_password);
      loadUsers();
      loadAudit(true);
    });
  });

  async function loadAudit(fresh, restore = false) {
    const target = restore
      ? Math.max(30, $("audit").children.length, Math.min(3000, Number(savedUI.auditShown) || 30))
      : 30;
    const limit = fresh ? Math.min(100, target) : 30;
    const r = await api(
      "GET",
      "/api/admin/audit?" +
        new URLSearchParams({
          ...auditFilters(),
          limit: String(limit),
          ...(fresh || !oldest ? {} : { before: String(oldest) }),
        }),
    );
    if (!$("audit-msg")) return;
    if (!r.ok) {
      say($("audit-msg"), `Couldn't load activity: ${r.error}. Refresh to retry.`, true);
      return;
    }
    say(
      $("audit-msg"),
      r.data.length
        ? `Updated ${new Date().toLocaleTimeString()}.`
        : "No events match this page. Clear filters or choose a wider UTC date range.",
    );
    const line = (en) =>
      html`<li><span>${sentence(en)}${en.detail ? html` <span class="meta">(${en.detail})</span>` : ""}${en.action.includes("email") || en.action === "account_mail_accepted" ? html` <button class="secondary small" data-audit-open="email">Email & signup</button>` : en.action.includes("backup") ? html` <button class="secondary small" data-audit-open="backups">Backups</button>` : ""}</span><span class="meta">${new Date(en.at * 1000).toLocaleString()} (local)${en.ip ? " · " + en.ip : ""}</span></li>`;
    if (fresh) setHTML($("audit"), html`${r.data.map(line)}`);
    else appendHTML($("audit"), html`${r.data.map(line)}`);
    if (r.data.length) oldest = r.data[r.data.length - 1].id;
    $("audit-more").hidden = r.data.length < limit;
    while (restore && $("audit").children.length < target && !$("audit-more").hidden) {
      if (!(await loadAudit(false))) break;
    }
    ctx.ui?.set("admin", {
      ...ctx.ui.get("admin"),
      auditFilters: Object.fromEntries(
        ["person", "family", "from", "to"].map((k) => [k, $("audit-" + k).value]),
      ),
      peopleSearch: $("people-search").value,
      peopleState: $("people-state").value,
      auditShown: Math.max(30, $("audit").children.length),
    });
    return r.data.length > 0;
  }
  $("users-retry").addEventListener("click", () => loadUsers());
  $("audit-refresh").addEventListener("click", () => loadAudit(true));
  $("audit-more").addEventListener("click", () => loadAudit(false));

  $("backup-encrypt").checked = savedUI.encryptBackup === true;
  $("backup-encryption-fields").hidden = !$("backup-encrypt").checked;
  $("backup-encrypt").addEventListener("change", () => {
    $("backup-encryption-fields").hidden = !$("backup-encrypt").checked;
    if (!$("backup-encrypt").checked) {
      $("backup-encryption-password").value = "";
      $("backup-encryption-confirm").value = "";
    }
  });
  $("backup").addEventListener("click", async () =>
    withBusy($("backup"), "Preparing…", async () => {
      const msg = $("backup-msg"),
        pw = $("backup-pw");
      if (!pw.value) {
        pw.focus();
        return say(msg, "Enter your password to download a backup.", true);
      }
      const encryptionPassword = $("backup-encrypt").checked
        ? $("backup-encryption-password").value
        : "";
      if (
        $("backup-encrypt").checked &&
        (encryptionPassword.length < 8 ||
          encryptionPassword !== $("backup-encryption-confirm").value)
      ) {
        return say(
          msg,
          "Enter an encryption password of at least 8 characters and match it in both fields.",
          true,
        );
      }
      say(msg, "Preparing the ZIP backup…");
      let r;
      try {
        r = await fetch("/api/admin/backup", {
          method: "POST",
          body: JSON.stringify({ password: pw.value, encryption_password: encryptionPassword }),
          signal: AbortSignal.timeout(300000),
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "jiggered",
            "X-Jiggered-User": String(me.id),
          },
        });
      } catch {
        return say(msg, "Couldn't reach the server. Check your connection and try again.", true);
      }
      if (!r.ok) {
        const why = await r.json().then(
          (j) => j.error,
          () => "",
        );
        return say(msg, why || `The backup failed (${r.status}).`, true);
      }
      pw.value = "";
      $("backup-encryption-password").value = "";
      $("backup-encryption-confirm").value = ""; // asked for again next time
      const url = URL.createObjectURL(await r.blob());
      const name =
        (/filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "") || [])[1] ||
        "jiggered-backup.zip";
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(msg, "Backup downloaded.");
      loadAudit(true);
    }),
  );

  // ---- how Jiggered finds out who is connecting ----
  // Two things a new operator is told nowhere else until they open this tab: said at the top of People, with the way there.
  function showSetupNotes(c) {
    const notes = [];
    if (!c.secure_cookie) notes.push("Sign-in cookies also travel over plain http.");
    if (!c.trust_proxy && c.seen.forwarded_for)
      notes.push(
        "A proxy is in front of Jiggered but isn't trusted, so everyone behind it shares one sign-in lockout.",
      );
    if (!$("setup-notes")) return;
    $("setup-notes").hidden = !notes.length;
    setHTML(
      $("setup-notes"),
      html`<b>Finish setting up.</b> ${notes.map((n) => html`${n} `)}<button type="button" class="secondary small" data-audit-open="connection">Open Connection</button>`,
    );
  }
  function showConnection(c) {
    showSetupNotes(c);
    $("px-on").checked = c.trust_proxy;
    $("px-hops").value = c.proxy_hops;
    $("px-cidrs").value = c.trusted_proxy_cidrs || "";
    $("px-hops").disabled = !c.trust_proxy;
    const via =
      c.seen.remote_addr +
      (c.seen.forwarded_for ? `, X-Forwarded-For: ${c.seen.forwarded_for}` : "");
    const advice =
      !c.trust_proxy && c.seen.forwarded_for
        ? "A proxy is sending X-Forwarded-For, but Jiggered isn't reading it. Turn the setting on so people can be told apart."
        : c.trust_proxy && !c.seen.forwarded_for
          ? "No X-Forwarded-For header arrived. Either nothing is in front of Jiggered, or your proxy doesn't send one: in that case turn the setting off."
          : "";
    setHTML(
      $("px-seen"),
      html`Jiggered sees you as <b>${c.seen.client_ip}</b> <span class="meta">(connection from ${via})</span>. ${advice}`,
    );
    setHTML(
      $("px-cookie"),
      c.secure_cookie
        ? html`Sign-in cookies only travel over HTTPS.`
        : html`<b>Sign-in cookies also travel over plain http.</b> That is only meant for testing. Turn it back on with <code>docker compose exec jiggered /jiggered settings set secure_cookie true</code>.`,
    );
  }
  async function loadConnection() {
    const r = await api("GET", "/api/admin/settings");
    if (!$("px-msg")) return;
    if (r.ok) showConnection(r.data);
    else say($("px-msg"), r.error, true);
  }
  $("px-on").addEventListener("change", () => {
    $("px-hops").disabled = !$("px-on").checked;
  });
  $("proxyform").addEventListener("submit", async (e) => {
    e.preventDefault();
    return withBusy($("proxyform").querySelector("[type=submit]"), "Saving…", async () => {
      const msg = $("px-msg");
      say(msg, "Saving…");
      const r = await adminAPI("PATCH", "/api/admin/settings", {
        trust_proxy: $("px-on").checked,
        proxy_hops: Number($("px-hops").value) || 1,
        trusted_proxy_cidrs: $("px-cidrs").value,
      });
      if (!r.ok) return say(msg, r.error, true);
      showConnection(r.data);
      say(msg, "Saved.");
      loadAudit(true);
    });
  });

  const defaultsForm = $("defaults-form");
  setHTML(defaultsForm, editorMarkup("def"));
  let defaultsDirty = false,
    defaultsETag = "",
    defaultSaving = false;
  const defaultsEditor = createEditor(defaultsForm, "def", () => {
    defaultsDirty = true;
    ctx.drafts.put("admin-defaults", { body: defaultsEditor.read(), tag: defaultsETag });
  });
  const defaultDraft = ctx.drafts.get("admin-defaults");
  defaultsEditor.fill(defaultDraft?.body || ctx.defaults());
  defaultsDirty = !!defaultDraft;
  defaultsETag = defaultDraft?.tag || "";
  async function loadProductDefaults(replace = false) {
    if (
      replace &&
      defaultsDirty &&
      !confirm("Replace your unfinished defaults draft with the latest shared version?")
    )
      return;
    const result = await ctx.loadDefaults();
    if (!$("def-msg")) return;
    if (!result.fresh || !result.tag) {
      say($("def-msg"), "Connect to load shared defaults before saving.", true);
      return;
    }
    if (!defaultsDirty || replace) {
      defaultsETag = result.tag;
      defaultsEditor.fill(result.body);
      defaultsDirty = false;
      ctx.drafts.remove("admin-defaults");
      say(
        $("def-msg"),
        result.fallback
          ? "Stored defaults were damaged. Factory defaults are shown; Save to repair them."
          : "Latest shared defaults loaded.",
        result.fallback,
      );
    } else
      say($("def-msg"), "Your unfinished defaults draft is kept. Reload latest to replace it.");
  }
  $("defaults-reload").addEventListener("click", () => loadProductDefaults(true));
  defaultsForm
    .querySelector("[data-discard]")
    .addEventListener("click", () => loadProductDefaults(true));
  defaultsForm.querySelector("[data-reset]").addEventListener("click", () => {
    if (defaultsDirty && !confirm("Replace this draft with factory defaults?")) return;
    defaultsEditor.fill(DEFAULTS);
    defaultsDirty = true;
    ctx.drafts.put("admin-defaults", { body: defaultsEditor.read(), tag: defaultsETag });
    say($("def-msg"), "Factory defaults filled in. Save to publish them.");
  });
  defaultsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (defaultSaving) return;
    const body = defaultsEditor.validate();
    if (!body) return;
    if (!defaultsETag)
      return say($("def-msg"), "Load the shared defaults while connected before saving.", true);
    defaultSaving = true;
    await withBusy(defaultsForm.querySelector("[type=submit]"), "Saving…", async () => {
      const proof = confirmation();
      if (!proof) {
        say($("def-msg"), "Enter your password to confirm this change.", true);
        return;
      }
      let r;
      try {
        r = await fetch("/api/admin/defaults", {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "X-Requested-With": "jiggered",
            "X-Jiggered-User": String(me.id),
            "Content-Type": "application/json",
            "If-Match": defaultsETag,
            ...proof,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
      } catch {
        say($("def-msg"), "Couldn't connect. Your defaults draft is kept on this device.", true);
        return;
      }
      const value = await r.json().catch(() => ({}));
      if (!$("def-msg")) return;
      if (!r.ok)
        return say($("def-msg"), value.error || `Save failed (${r.status}). Draft kept.`, true);
      defaultsETag = r.headers.get("ETag");
      ctx.setDefaults(value, defaultsETag);
      if (JSON.stringify(defaultsEditor.validate()) === JSON.stringify(body)) {
        defaultsDirty = false;
        ctx.drafts.remove("admin-defaults");
      }
      say($("def-msg"), "Shared defaults saved. Existing personal lists are unchanged.");
      loadAudit(true);
    });
    defaultSaving = false;
  });

  async function loadUsageReport() {
    const r = await api("GET", "/api/admin/usage");
    if (!r.ok) {
      $("usage-msg").textContent = r.error;
      return;
    }
    $("usage-enabled").checked = r.data.enabled;
    setHTML(
      $("usage-report"),
      r.data.rows.length
        ? html`<div class="table-scroll" tabindex="0" role="region" aria-label="Usage report"><table><thead><tr><th>Week (UTC)</th><th>Task</th><th>Participants</th><th>Completions</th><th>Active on 2+ days</th></tr></thead><tbody>${r.data.rows.map((x) => html`<tr><td>${x.week}</td><td>${x.event.replaceAll("_", " ")}</td><td>${x.participants}</td><td>${x.tasks}</td><td>${x.repeat_days_participants ?? "Hidden (fewer than 5)"}</td></tr>`)}</tbody></table></div>`
        : html`<p class="meta">No reportable groups yet. Every event needs at least five consenting participants in the same week.</p>`,
    );
  }
  $("usage-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void withBusy(e.submitter, "Saving…", async () => {
      const password = $("usage-password").value;
      const r = await api(
        "PUT",
        "/api/admin/usage",
        { enabled: $("usage-enabled").checked, clear: $("usage-clear").checked, password },
        { "X-Jiggered-Password": password },
      );
      $("usage-password").value = "";
      $("usage-msg").textContent = r.ok ? "Measurement settings saved." : r.error;
      if (r.ok) {
        $("usage-clear").checked = false;
        await loadUsageReport();
      }
    });
  });
  return {
    render() {},
    destroy() {
      services.destroy();
    },
    show() {
      return Promise.all([
        services.load(),
        loadUsers(),
        loadAudit(true, true),
        loadConnection(),
        loadProductDefaults(),
        loadUsageReport(),
      ]);
    },
  };
}
