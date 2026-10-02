import { $, api, html, setHTML, fmtBytes, withBusy } from "./util.js";
const field = (id, name, attrs = "", hint = "") =>
  `<label class="field">${name}<input id="svc-${id}" ${attrs}>${hint ? `<span class="meta">${hint}</span>` : ""}</label>`;
export const servicesMarkup = `
<section class="panel service-panel" aria-labelledby="services-title">
 <div class="service-heading"><div><p class="eyebrow">DATA PROTECTION</p><h2 id="services-title">Off-site backups & email</h2></div><span class="badge" id="svc-status">Loading</span></div>
 <p class="meta" data-service-area="backups">Keep a consistent copy of everyone's data in your own S3 bucket. Email alerts contain operational status only.</p>
 <div class="service-stats" data-service-area="backups"><div><span class="meta">Last attempt</span><b id="svc-last">—</b></div><div><span class="meta">Next scheduled</span><b id="svc-next">—</b></div><div><span class="meta">Last usable upload</span><b id="svc-good">—</b></div><div><span class="meta">Last verified upload</span><b id="svc-verified">—</b></div></div><p class="meta" data-service-area="backups">Upload verification checks transferred bytes; a restore rehearsal checks whether you can recover. Historical uploads without verification have unknown verification status.</p>
 <form id="services-form">
 <details open class="service-details" data-service-area="backups"><summary>S3 destination <span class="meta">AWS · R2 · B2 · MinIO · compatible storage</span></summary>
 <label class="radio"><input type="checkbox" id="svc-enabled"> Enable automatic remote backups</label>
 <div class="service-grid">${field("endpoint", "Endpoint", 'type="url" placeholder="https://s3.eu-west-2.amazonaws.com"', "The service endpoint; the bucket goes in its own field.")}${field("bucket", "Bucket", 'maxlength="63" placeholder="my-private-backups"')}${field("region", "Signing region", 'placeholder="us-east-1"')}${field("prefix", "Folder prefix", 'maxlength="256"', "A dedicated prefix keeps each installation separate.")}${field("access_key", "Access key", 'type="password" autocomplete="new-password"', "Leave blank to keep the saved key.")}${field("secret_key", "Secret key", 'type="password" autocomplete="new-password"', "Leave blank to keep the saved secret.")}</div>
 <div class="service-grid">${field("interval_hours", "Run every (hours)", 'type="number" min="1" max="8760" required')}${field("keep", "Backups to keep", 'type="number" min="0" max="1000" required', "0 keeps every backup. Only this installation’s backup files are deleted.")}</div>
 <details><summary>ZIP & encryption</summary><p class="meta">Remote backups are compressed ZIP archives. Optionally encrypt them with a password you keep separately.</p><label class="radio"><input type="checkbox" id="svc-encrypt"> Encrypt remote backups with a password</label>${field("encryption_password", "Backup encryption password", 'type="password" autocomplete="new-password" minlength="8"', "Leave blank to keep the saved password. You’ll need it to restore encrypted backups.")}<label class="radio"><input type="checkbox" id="svc-clear-backup"> Remove saved backup encryption password when saving</label></details>
 <details><summary>Transfer & compatibility controls</summary><label class="radio"><input type="checkbox" id="svc-path_style" data-tooltip="Path style puts the bucket in the URL path. Usually on for MinIO, R2 and private storage; AWS also supports virtual-host style."> Use path-style addressing</label><label class="radio"><input type="checkbox" id="svc-verify" data-tooltip="Downloads the uploaded object and verifies its SHA-256 digest before deleting any older backups. This uses additional transfer bandwidth."> Verify every upload with SHA-256</label><label class="radio"><input type="checkbox" id="svc-allow_http"> Allow plain HTTP for a trusted private-network S3 service</label><label class="radio"><input type="checkbox" id="svc-clear-s3"> Remove saved S3 credentials when saving</label></details>
 </details>
 <details open class="service-details" data-service-area="email"><summary>Email delivery <span class="meta">SMTP & notification preferences</span></summary>
 <label class="radio"><input type="checkbox" id="svc-mail-enabled"> Enable email delivery</label>
 <div class="service-grid">${field("host", "SMTP host", 'placeholder="smtp.example.com"')}${field("port", "Port", 'type="number" min="1" max="65535" required')}<label class="field">Connection security<select id="svc-tls"><option value="starttls">STARTTLS (usually 587)</option><option value="tls">Implicit TLS (usually 465)</option><option value="none">Unencrypted local relay (no authentication)</option></select></label>${field("username", "SMTP username", 'autocomplete="off"')}${field("smtp_password", "SMTP password or app password", 'type="password" autocomplete="new-password"', "Leave blank to keep the saved password.")}${field("from", "Sender address", 'type="email" placeholder="jiggered@example.com"')}</div>
 <label class="field">Notification recipients<textarea id="svc-to" rows="2" placeholder="admin@example.com, another@example.com"></textarea><span class="meta">Separate up to 20 addresses with commas or new lines. Account verification and recovery go to the account's own email address.</span></label>
 <div class="row"><label class="radio"><input type="checkbox" id="svc-on_failure"> Alert when backups fail</label><label class="radio"><input type="checkbox" id="svc-on_success"> Confirm successful backups</label></div><label class="radio"><input type="checkbox" id="svc-clear-email"> Remove saved SMTP password when saving</label>
 </details>
 <details open class="service-details" data-service-area="email"><summary>Registration & recovery <span class="meta">Who can join this instance</span></summary>
 <label class="radio"><input id="svc-registration" type="checkbox"> Allow people to register with a verified email address</label>
 <label class="radio"><input id="svc-recovery" type="checkbox"> Allow forgotten-password recovery by email</label>
 ${field("public_url", "Public application URL", 'type="url" placeholder="https://jiggered.example.com"', "Trusted base URL for email links. Never taken from a visitor’s request headers.")}
 <p class="meta">Registration creates ordinary accounts. SMTP must be enabled. Existing accounts can add a verified recovery email in Account. A password reset keeps 2FA enabled and requires a code.</p>
 </details>
 <details class="service-details" data-service-area="backups"><summary>Restore guide & rehearsal</summary><p class="meta">A full restore replaces everyone's private logs and account settings and signs every device out. Keep the backup and preserved database private.</p><ol><li>Download a backup to a private directory. Keep the encryption password and the server's <code>.jiggered-service-key</code> separately; the key is excluded from database backups.</li><li>First rehearse on an isolated instance using the same or newer Jiggered. Keep outgoing SMTP and automatic backups disabled there.</li><li>Stop the destination server. Preserve its database and credential key. Restore a plain ZIP with <code>jiggered restore /private/backup.zip --yes</code>, or an encrypted ZIP with <code>jiggered restore /private/backup.zip --password-file /private/backup-password --yes</code>. Set APP_DB to the intended destination. Protect the password file with mode 0600.</li><li>Restore the matching credential key, then start the server. Sign in again, check accounts, a known day and episode, settings and export. Test SMTP/S3 only when intended. If the key is unavailable, re-enter service credentials. If authenticator secrets cannot be decrypted, the operator must use the CLI two-factor reset described in the README before the affected user can set up protection again.</li><li>If checks fail, stop the server and restore the preserved pre-restore database and its key. Record the outcome below. A production restore remains a server command.</li></ol><p class="meta">For Docker: stop the service, then use <code>docker compose run --rm --no-deps jiggered restore /data/backups/backup.zip --yes</code> with a backup path in the mounted volume; add --password-file for encrypted files.</p>${field("rehearsal-date", "Last completed rehearsal (UTC)", 'type="date"')}<label class="field">Self-reported outcome<select id="svc-rehearsal-outcome"><option value="">Not recorded</option><option value="passed">Passed recovery checks</option><option value="needs_attention">Needs attention</option></select></label><p class="meta">This records your checks; Jiggered does not verify the rehearsal automatically. Save configuration to record or clear both fields.</p></details>
 ${field("password", "Your admin password", 'type="password" autocomplete="current-password" required', "Remembered in this page for 30 minutes after a successful check; cleared when you leave or reload.")}
 <p id="svc-auth-status" class="meta" role="status"></p>
 <div class="service-actions"><button class="primary" type="submit">Save configuration</button><button class="secondary" id="svc-reload" type="button">Reload settings</button></div>
 </form>
 <div class="service-actions"><button class="secondary" data-service-action="test_s3">Test S3 connection</button><button class="secondary" data-service-action="test_email">Send test email</button><button class="primary" data-service-action="backup">Back up now</button><button class="secondary" data-service-action="list">Browse remote backups</button></div>
 <p id="svc-msg" class="msg" role="status" aria-live="polite"></p>
 <div id="svc-remote" hidden><h3>Remote backups</h3><p class="meta">Downloads contain everyone's private data. To restore the whole database, use the server's restore command.</p><ul id="svc-objects" class="list"></ul></div>
 <details class="service-details" open data-service-area="backups"><summary>Recent backup history</summary><ul id="svc-runs" class="list service-runs"></ul><button class="secondary small" id="svc-refresh">Refresh status</button></details>
<details open class="service-details" data-service-area="email"><summary>Account email delivery</summary><p class="meta">Up to four attempts while a link is valid. SMTP acceptance does not confirm inbox delivery. Interrupted sends may be duplicated. No addresses or link tokens are shown; payloads are erased after acceptance or expiry. Request a new link from the account page after fixing delivery.</p><ul id="svc-mail" class="list"></ul><button id="svc-mail-refresh" class="secondary" type="button">Refresh delivery</button></details></section>`;
export function initServices(ctx) {
  let saved = null,
    dirty = false,
    timer,
    destroyed = false,
    busy = false;
  let cachedPassword = "",
    passwordUntil = 0,
    passwordTimer;
  const form = $("services-form"),
    message = (text, bad = false) => {
      if (!$("svc-msg")) return;
      $("svc-msg").textContent = text;
      $("svc-msg").classList.toggle("err", bad);
    };
  function forgetPassword() {
    cachedPassword = "";
    passwordUntil = 0;
    clearTimeout(passwordTimer);
    if (destroyed) return;
    $("svc-password").required = true;
    $("svc-auth-status").textContent =
      "Enter your admin password to save settings or run an action.";
  }
  function adminPassword() {
    if (passwordUntil && Date.now() >= passwordUntil) forgetPassword();
    const value = $("svc-password").value || cachedPassword;
    if (!value) {
      $("svc-password").focus();
      message("Enter your admin password to continue.", true);
    }
    return value;
  }
  function checkedPassword(value, r) {
    if (destroyed) return;
    if (r.status === 401 || r.status === 403 || r.status === 429) {
      forgetPassword();
      return;
    }
    if (!r.ok) return;
    // Only a successful server check starts the fixed window. Reusing it never extends it.
    if ($("svc-password").value) {
      cachedPassword = value;
      passwordUntil = Date.now() + 30 * 60 * 1000;
      clearTimeout(passwordTimer);
      passwordTimer = setTimeout(forgetPassword, 30 * 60 * 1000);
    }
    $("svc-password").value = "";
    $("svc-password").required = !cachedPassword;
    if (cachedPassword)
      $("svc-auth-status").textContent =
        "Admin password remembered until " +
        new Date(passwordUntil).toLocaleTimeString() +
        ". Reload this page to forget it now.";
  }
  function actionLabels() {
    if (destroyed) return;
    document.querySelector('[data-service-action="test_email"]').textContent = dirty
      ? "Save & send test email"
      : "Send test email";
    document.querySelector('[data-service-action="test_s3"]').textContent = dirty
      ? "Save & test S3 connection"
      : "Test S3 connection";
  }
  function changed() {
    dirty = true;
    actionLabels();
  }
  const date = (t) => (t ? new Date(t * 1000).toLocaleString() : "Not yet");
  function fill(data) {
    saved = data.settings;
    $("svc-rehearsal-date").value = saved.rehearsal?.date || "";
    $("svc-rehearsal-outcome").value = saved.rehearsal?.outcome || "";
    dirty = false;
    actionLabels();
    for (const [k, v] of Object.entries(saved.remote)) {
      const el = $("svc-" + k);
      if (el) el.type === "checkbox" ? (el.checked = v) : (el.value = v);
    }
    for (const [k, v] of Object.entries(saved.email)) {
      const el = $(
        "svc-" + (k === "enabled" ? "mail-enabled" : k === "password" ? "smtp_password" : k),
      );
      if (el)
        el.type === "checkbox" ? (el.checked = v) : (el.value = k === "to" ? v.join(", ") : v);
    }
    for (const [k, v] of Object.entries(saved.accounts || {})) {
      const el = $("svc-" + k);
      if (el) el.type === "checkbox" ? (el.checked = v) : (el.value = v);
    }
    for (const [id, exists] of [
      ["access_key", data.access_key_saved],
      ["secret_key", data.secret_key_saved],
      ["smtp_password", data.smtp_password_saved],
      ["encryption_password", data.backup_password_saved],
    ])
      $("svc-" + id).placeholder = exists
        ? "Saved securely · leave blank to keep"
        : "Not configured";
    $("svc-clear-s3").checked = false;
    $("svc-clear-email").checked = false;
    $("svc-clear-backup").checked = false;
  }
  function status(data) {
    const last = data.runs?.[0];
    $("svc-good").textContent = date(data.last_usable);
    if (
      data.settings.remote.enabled &&
      data.last_usable &&
      Date.now() / 1000 - data.last_usable > data.settings.remote.interval_hours * 7200
    )
      $("svc-good").textContent += " · overdue; check recent attempts";
    $("svc-verified").textContent = date(data.last_verified);
    setHTML(
      $("svc-mail"),
      html`${data.mail?.length ? data.mail.map((m) => html`<li><div><b>${m.purpose === "reset" ? "Password reset" : "Email verification"} · ${m.status}</b><p class="meta">${date(m.created)} · ${m.attempts} attempts${m.status === "queued" ? ` · retry ${date(m.next_at)}` : ""}</p><p class="meta">${m.error_category}</p></div></li>`) : html`<li class="meta">No account email requests recorded yet.</li>`}`,
    );

    $("svc-last").textContent = last
      ? `${date(last.started)} · ${last.status}`
      : "No remote backups yet";
    $("svc-next").textContent = data.next_at ? date(data.next_at) : "Schedule paused";
    $("svc-status").textContent =
      last?.status === "running"
        ? "Backing up…"
        : data.settings.remote.enabled
          ? "Scheduled"
          : "Paused";
    setHTML(
      $("svc-runs"),
      html`${
        data.runs?.length
          ? data.runs.map(
              (run) =>
                html`<li><div><div class="row"><b>${date(run.started)}</b><span class="badge ${run.status === "failed" ? "off" : ""}">${run.status}</span><span class="meta">${fmtBytes(run.bytes)}</span></div><p class="meta">${run.message || "Creating a snapshot and uploading…"}</p><p class="meta">Upload: ${run.uploaded ? "completed" : "not completed"} · Verification: ${run.verified ? "passed" : run.verification_required ? "not passed" : "not required / historically unknown"} · Retention: ${run.retained ? "completed" : "not completed"}</p>${run.email ? html`<p class="meta">Email: ${run.email}</p>` : ""}</div></li>`,
            )
          : html`<li class="meta">Your first backup will appear here. Test the destination, then choose Back up now.</li>`
      }`,
    );
    clearTimeout(timer);
    if (last?.status === "running" && !destroyed) timer = setTimeout(() => load(false), 3000);
  }
  async function load(replace = false) {
    const r = await api("GET", "/api/admin/services");
    if (destroyed || !$("svc-msg")) return;
    if (!r.ok) return message(r.error, true);
    if (replace || !saved) fill(r.data);
    status(r.data);
  }
  form.addEventListener("input", (e) => {
    if (e.target.id !== "svc-password") changed();
  });
  async function save() {
    if (!saved) {
      message("Load the configuration first.", true);
      return false;
    }
    const value = adminPassword();
    if (!value) return false;
    const settings = structuredClone(saved);
    settings.rehearsal = {
      date: $("svc-rehearsal-date").value,
      outcome: $("svc-rehearsal-outcome").value,
    };
    for (const k of Object.keys(settings.remote)) {
      const el = $("svc-" + k);
      if (el)
        settings.remote[k] =
          el.type === "checkbox"
            ? el.checked
            : el.type === "number"
              ? Number(el.value)
              : el.type === "password"
                ? el.value
                : el.value.trim();
    }
    for (const k of Object.keys(settings.email)) {
      const el = $(
        "svc-" + (k === "enabled" ? "mail-enabled" : k === "password" ? "smtp_password" : k),
      );
      if (el)
        settings.email[k] =
          el.type === "checkbox"
            ? el.checked
            : el.type === "number"
              ? Number(el.value)
              : k === "to"
                ? el.value
                    .split(/[,\n]/)
                    .map((x) => x.trim())
                    .filter(Boolean)
                : el.type === "password"
                  ? el.value
                  : el.value.trim();
    }
    for (const k of Object.keys(settings.accounts || {})) {
      const el = $("svc-" + k);
      if (el)
        settings.accounts[k] =
          el.type === "checkbox" ? el.checked : el.type === "password" ? el.value : el.value.trim();
    }
    const password = value;
    const r = await api(
      "PUT",
      "/api/admin/services",
      {
        settings,
        password,
        clear_s3: $("svc-clear-s3").checked,
        clear_email: $("svc-clear-email").checked,
        clear_backup: $("svc-clear-backup").checked,
      },
      { "X-Jiggered-Password": password },
    );
    checkedPassword(password, r);
    if (destroyed) return false;
    if (!r.ok) {
      message(r.error, true);
      return false;
    }
    fill(r.data);
    message("Configuration saved.");
    load(false);
    return true;
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (busy) return;
    withBusy(form.querySelector("[type=submit]"), "Saving…", async () => {
      busy = true;
      try {
        await save();
      } finally {
        busy = false;
      }
    });
  });
  $("svc-reload").addEventListener("click", () => {
    if (!dirty || confirm("Discard your unsaved configuration changes?")) load(true);
  });
  $("svc-mail-refresh").addEventListener("click", () => load(false));
  $("svc-refresh").addEventListener("click", () => load(false));
  async function action(button, action, key) {
    if (busy) return;
    if (dirty && !["test_email", "test_s3"].includes(action))
      return message("Save configuration changes before running an action.", true);
    await withBusy(button, "Working…", async () => {
      busy = true;
      try {
        if (dirty) {
          message("Saving configuration before testing…");
          if (!(await save())) return;
        }
        const value = adminPassword();
        if (!value) return;
        const password = value;
        message(action === "backup" ? "Starting backup…" : "Checking saved configuration…");
        if (action === "download") {
          let r;
          try {
            r = await fetch("/api/admin/services/action", {
              method: "POST",
              credentials: "same-origin",
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "jiggered",
                "X-Jiggered-User": String(ctx.me.id),
                "X-Jiggered-Password": password,
              },
              body: JSON.stringify({ action, key, password }),
              signal: AbortSignal.timeout(600000),
            });
          } catch {
            return message("Download interrupted. Try again.", true);
          }
          checkedPassword(password, r);
          if (!r.ok) {
            const data = await r.json().catch(() => ({}));
            return message(data.error || "Download failed.", true);
          }
          const blob = await r.blob(),
            url = URL.createObjectURL(blob),
            a = Object.assign(document.createElement("a"), {
              href: url,
              download: key.split("/").pop(),
            });
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          message("Remote backup downloaded.");
          return;
        }
        const r = await api(
          "POST",
          "/api/admin/services/action",
          { action, password },
          { "X-Jiggered-Password": password },
        );
        checkedPassword(password, r);
        if (destroyed) return;
        if (!r.ok) return message(r.error, true);
        if (action === "list") {
          $("svc-remote").hidden = false;
          setHTML(
            $("svc-objects"),
            html`${
              r.data.objects.length
                ? r.data.objects.map(
                    (o) =>
                      html`<li><span><b>${new Date(o.LastModified).toLocaleString()}</b><br><span class="meta">${fmtBytes(o.Size)} · ${o.Key.split("/").pop()}</span></span><button class="secondary small" data-remote-key="${o.Key}">Download</button></li>`,
                  )
                : html`<li class="meta">No backups found in this installation's prefix.</li>`
            }`,
          );
          message(r.data.truncated ? "Showing the latest 200 backups." : "Remote backups loaded.");
        } else
          message(r.data.message || "Backup started. You can leave this page; progress is saved.");
        load(false);
      } finally {
        busy = false;
      }
    });
    actionLabels();
  }
  document
    .querySelectorAll("[data-service-action]")
    .forEach((b) => b.addEventListener("click", () => action(b, b.dataset.serviceAction)));
  $("svc-objects").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remote-key]");
    if (b) action(b, "download", b.dataset.remoteKey);
  });
  function leavePage() {
    forgetPassword();
    if ($("svc-password")) $("svc-password").value = "";
  }
  window.addEventListener("pagehide", leavePage);
  forgetPassword();
  return {
    load: () => load(false),
    destroy() {
      destroyed = true;
      clearTimeout(timer);
      leavePage();
      window.removeEventListener("pagehide", leavePage);
    },
  };
}
