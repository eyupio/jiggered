// The Account tab: who you are, your password, where you're signed in, your settings and your data.

import { themeOf } from "./energy-theme.js";
import {
  $,
  api,
  html,
  setHTML,
  describeUA,
  ago,
  saveFeedback,
  withBusy,
  downloadFile,
} from "./util.js";
import { createEditor, editorMarkup } from "./editor.js";
import {
  dayId,
  normaliseSettings,
  identifyActivities,
  defaultsGap,
  mergeDefaults,
} from "./model.js";
import { describeGap, previewGap } from "./defaults-notice.js";
import { initSecurity, securityMarkup } from "./security.js";
import { initProfile, profileIdentity } from "./profile.js";

function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
}

// identity says who you are and, for an admin, what that allows. It is re-run when the role changes.
export function identity(ctx) {
  const { me } = ctx;
  $("acc-name").textContent = me.username;
  $("acc-role").textContent =
    me.role === "admin" ? "You're an admin: you can add people and manage accounts." : "";
  $("acc-role").hidden = me.role !== "admin";
  profileIdentity(ctx);
}

export function init(ctx) {
  const { me } = ctx;
  identity(ctx);
  async function loadUsage() {
    const r = await api("GET", "/api/me");
    if (!r.ok || !r.data.usage) return;
    const u = r.data.usage;
    $("account-usage").textContent =
      `${u.docs} of ${u.max_docs} records · ${(u.bytes / 1048576).toFixed(1)} of ${(u.max_bytes / 1048576).toFixed(0)} MB used.${u.docs >= u.max_docs * 0.9 || u.bytes >= u.max_bytes * 0.9 ? " Near the limit: export a copy and contact your instance administrator. Records are never removed automatically." : ""}`;
  }
  $("account-usage").insertAdjacentHTML(
    "afterend",
    `<form id="usage-consent-form"><h3>Optional product usage</h3><p class="meta">Off by default. With your permission, this instance stores coarse weekly task counts and days active for capture, History, generated exports, print requests, settings, save failures and recovered saves, for up to 90 days. No symptoms, notes, activity names, record dates or IP addresses are sent. Admin reports hide groups smaller than five; consent is linked to your account for deletion. Disabling deletes your stored events. No external analytics service.</p><label class="radio"><input type="checkbox" id="usage-consent"> Help improve Jiggered with local task counts</label><button type="submit" class="secondary">Save usage preference</button><p id="usage-consent-msg" class="msg" role="status"></p></form>`,
  );
  async function loadConsent() {
    const r = await api("GET", "/api/me/usage-consent");
    if (!r.ok) {
      $("usage-consent-msg").textContent =
        "Could not load usage preference. Try again by reopening Account.";
      return;
    }
    $("usage-consent").checked = r.data.enabled;
    $("usage-consent").disabled = !r.data.available && !r.data.enabled;
    $("usage-consent-form").querySelector("button").disabled = !r.data.available && !r.data.enabled;
    $("usage-consent-msg").textContent = r.data.available
      ? "Choose whether to participate."
      : "Measurement is disabled by the instance administrator.";
    ctx.setUsageConsent(r.data.available && r.data.enabled);
  }
  $("usage-consent-form").addEventListener("submit", (e) => {
    e.preventDefault();
    void withBusy(e.submitter, "Saving…", async () => {
      const r = await api("PUT", "/api/me/usage-consent", { enabled: $("usage-consent").checked });
      if (r.ok) {
        ctx.setUsageConsent(r.data.available && r.data.enabled);
        $("usage-consent-msg").textContent = r.data.enabled
          ? "Optional measurement enabled."
          : "Measurement disabled; your stored events were deleted.";
      } else $("usage-consent-msg").textContent = r.error;
    });
  });
  const profile = initProfile(ctx);
  $("pwform").closest(".panel").insertAdjacentHTML("afterend", securityMarkup);
  const security = initSecurity(ctx);
  $("account-shortcuts").addEventListener("click", (e) => {
    const target = e.target.closest("[data-account-target]");
    if (!target) return;
    const panel = $(target.dataset.accountTarget);
    panel.scrollIntoView({
      block: "start",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    panel.querySelector("input,select,textarea,button")?.focus({ preventScroll: true });
  });

  // ---- password ----
  $("pwform").addEventListener("submit", async (e) => {
    e.preventDefault();
    return withBusy($("pwform").querySelector("[type=submit]"), "Changing…", async () => {
      const msg = $("pw-msg");
      if ($("pw-new").value !== $("pw-new2").value)
        return say(msg, "The two new passwords don't match.", true);
      say(msg, "Changing…");
      const r = await api("POST", "/api/me/password", {
        current: $("pw-cur").value,
        new: $("pw-new").value,
      });
      if (!r.ok) return say(msg, r.error, true);
      $("pwform").reset();
      if (me.must_change_password) {
        location.reload();
        return;
      }
      say(msg, "Password changed. Your other devices were signed out.");
      loadSessions();
    });
  });

  // ---- sessions ----
  async function loadSessions() {
    const r = await api("GET", "/api/me/sessions");
    if (!r.ok) {
      setHTML($("sessions"), html`<li class="meta">${r.error}</li>`);
      return;
    }
    setHTML(
      $("sessions"),
      html`${r.data.map(
        (
          s,
        ) => html`<li><span><b>${describeUA(s.user_agent)}</b>${s.current ? html` <span class="badge">this device</span>` : ""}
      <br><span class="meta">${s.ip || "unknown address"} · active ${ago(s.last_seen_at)}</span></span>
      ${s.current ? "" : html`<button class="x" data-sid="${s.id}">Sign out</button>`}</li>`,
      )}`,
    );
    $("revoke-others").hidden = r.data.length < 2;
  }
  $("sessions").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-sid]");
    if (!b) return;
    return withBusy(b, "Signing out…", async () => {
      const r = await api("DELETE", "/api/me/sessions/" + b.dataset.sid);
      say($("sessions-msg"), r.ok ? "Signed out." : r.error, !r.ok);
      loadSessions();
    });
  });
  $("revoke-others").addEventListener("click", async () =>
    withBusy($("revoke-others"), "Signing out…", async () => {
      const r = await api("POST", "/api/me/sessions/revoke-others");
      say(
        $("sessions-msg"),
        r.ok
          ? `Signed out ${r.data.revoked} other ${r.data.revoked === 1 ? "device" : "devices"}.`
          : r.error,
        !r.ok,
      );
      loadSessions();
    }),
  );

  // ---- settings ----
  const form = $("setform");
  setHTML(form, editorMarkup("set"));
  let baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) };
  let dirty = false,
    ticket = null,
    savedSettings = null,
    stampDone = false;
  const setDirty = (v) => {
    dirty = v;
    form.querySelector("[data-discard]").disabled = !v;
  }; // nothing to discard until something is typed
  setDirty(false);
  const editor = createEditor(
    form,
    "set",
    () => {
      setDirty(true);
      ctx.drafts?.put("settings", { value: editor.read(), baseline });
    },
    () => themeOf(ctx),
  );
  const savedDraft = ctx.drafts?.get("settings");
  editor.fill(savedDraft?.value || savedDraft || baseline);
  if (savedDraft?.baseline) baseline = savedDraft.baseline;
  setDirty(!!savedDraft);
  if (dirty) say($("set-msg"), "Unfinished settings draft restored from this device.");
  queueMicrotask(() => paintGap());
  form.querySelector("[data-discard]").addEventListener("click", () => {
    if (dirty && !confirm("Discard the unfinished settings draft?")) return;
    setDirty(false);
    ctx.drafts?.remove("settings");
    baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) };
    editor.fill(baseline);
    paintGap();
    say($("set-msg"), "Draft discarded.");
  });
  // Says what the shared defaults have that this draft lacks, so the choice between adding and replacing is clear.
  function paintGap() {
    const el = form.querySelector("[data-gap]"),
      merge = form.querySelector("[data-merge]"),
      gap = defaultsGap(normaliseSettings(editor.read()), ctx.defaults?.());
    el.hidden = !gap.total;
    merge.disabled = !gap.total;
    el.textContent = gap.total
      ? `The shared defaults have ${describeGap(gap)} you don't have: ${previewGap(gap, 6)}. Add new shared items keeps everything of yours; Replace with shared defaults starts again from theirs.`
      : "";
  }
  form.addEventListener("input", paintGap);
  form.addEventListener("click", (e) => {
    if (e.target.closest("[data-remove]")) paintGap();
  });
  form.querySelector("[data-merge]").addEventListener("click", async () => {
    const shared = await ctx.loadDefaults(),
      mine = normaliseSettings(editor.read()),
      gap = defaultsGap(mine, shared.body);
    if (!gap.total) {
      paintGap();
      say($("set-msg"), "You already have everything in the shared defaults.");
      return;
    }
    editor.fill(mergeDefaults(mine, shared.body));
    setDirty(true);
    ctx.drafts?.put("settings", { value: editor.read(), baseline });
    paintGap();
    say(
      $("set-msg"),
      `Added ${gap.total} new ${gap.total === 1 ? "item" : "items"} at the end of your lists${shared.fresh ? "" : " (from the last-known defaults; you're offline)"}. Review, then Save.`,
    );
  });
  form.querySelector("[data-reset]").addEventListener("click", async () => {
    if (dirty && !confirm("Replace this draft with the current shared defaults?")) return;
    const shared = await ctx.loadDefaults();
    editor.fill(shared.body);
    setDirty(true);
    ctx.drafts?.put("settings", { value: editor.read(), baseline });
    paintGap();
    say(
      $("set-msg"),
      shared.fresh
        ? "Latest shared defaults filled in. Save to adopt them."
        : "Offline: last-known defaults filled in. Save to adopt this version.",
    );
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (ticket) return;
    const S = editor.validate();
    if (!S) return;
    savedSettings = S;
    stampDone = false;
    const patch = Object.fromEntries(
      Object.entries(S).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(baseline[k])),
    );
    ticket = ctx.store.dispatch({
      id: "settings",
      type: ctx.store.view("settings") ? "settingsPatch" : "replace",
      arg: ctx.store.view("settings") ? patch : S,
      original: baseline,
      before: ctx.store.view("settings")
        ? Object.fromEntries(Object.keys(patch).map((k) => [k, baseline[k]]))
        : undefined,
    });
    renderSettings();
    ticket.then(renderSettings);
  });
  function renderSettings() {
    if (!ticket) return;
    const state = saveFeedback(ctx.store, ticket, $("set-msg"));
    form.querySelector("[type=submit]").disabled = state === "pending";
    if (state === "saved") {
      // Clear the acknowledged draft only if no new input was added during the request.
      if (JSON.stringify(normaliseSettings(editor.read())) === JSON.stringify(savedSettings)) {
        setDirty(false);
        ctx.drafts?.remove("settings");
      }
      const S = ctx.settings();
      baseline = dirty ? savedSettings : { ...S, activities: identifyActivities(S.activities) };
      ticket = null;
      if (!dirty) editor.fill(baseline);
      if (!stampDone) {
        stampDone = true;
        const id = dayId(ctx.today());
        if (ctx.store.view(id))
          ctx.store.dispatch({
            id,
            type: "restamp",
            arg: { budget: S.budget, sleepPenalty: S.sleepPenalty },
          });
      }
    } else if (state === "failed") ticket = null;
  }

  // ---- data ----
  const savedUI = ctx.ui?.get("account") || {};
  if (savedUI.importMode === "overwrite")
    document.querySelector('input[name="import-mode"][value="overwrite"]').checked = true;
  let restorePreview = null;
  const invalidatePreview = () => {
    restorePreview = null;
    $("import-preview").hidden = true;
    $("import-preview").replaceChildren();
  };
  $("importform").addEventListener("change", invalidatePreview);
  $("importform").addEventListener("submit", async (e) => {
    e.preventDefault();
    return withBusy($("importform").querySelector("[type=submit]"), "Checking…", async () => {
      invalidatePreview();
      const msg = $("import-msg"),
        file = $("import-file").files[0];
      if (!file) return say(msg, "Choose a file first.", true);
      if (file.size > 26 << 20)
        return say(msg, "That file is too large to be a Jiggered export.", true);
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        return say(msg, "That isn't a Jiggered export.", true);
      }
      const mode = document.querySelector("input[name=import-mode]:checked").value;
      const r = await api("POST", "/api/restore/preview?mode=" + mode, data);
      if (!r.ok) return say(msg, [r.error, ...(r.data?.issues || [])].join("\n"), true);
      restorePreview = { data, mode, token: r.data.token };
      const p = r.data;
      $("import-preview").hidden = false;
      setHTML(
        $("import-preview"),
        html`<h3>Review restore</h3><p>${p.additions} new records. ${p.matches} matching records. ${p.overwrites} will be replaced; ${p.skipped} will be kept.</p><p>${p.settingsChanged ? "Your settings will change, including activity lists and ordering." : "Your current settings will be kept."}</p><p>A private copy of your current server data will download before restoring. Keep it so you can undo a restore later.</p><button class="${p.overwrites ? "danger" : "primary"}" id="import-confirm" type="button">Download backup and ${p.overwrites ? `replace ${p.overwrites} matching records` : "restore missing records"}</button>`,
      );
      say(msg, "Preview ready. Nothing has changed.");
    });
  });
  $("import-preview").addEventListener("click", async (e) => {
    const button = e.target.closest("#import-confirm"),
      preview = restorePreview;
    if (!button || !preview) return;
    await withBusy(button, "Restoring…", async () => {
      try {
        let restored = false;
        await ctx.store.withRestore(async () => {
          const backup = await api("GET", "/api/export");
          if (!backup.ok)
            throw new Error("Could not download the pre-restore backup. " + backup.error);
          ctx.measure("export_created");
          downloadFile(
            `jiggered-before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
            JSON.stringify(backup.data, null, 2),
          );
          const r = await api("POST", "/api/restore?mode=" + preview.mode, preview.data, {
            "If-Match": preview.token,
          });
          if (!r.ok) {
            if (r.status === 409) invalidatePreview();
            throw new Error([r.error, ...(r.data?.issues || [])].join("\n"));
          }
          restored = true;
          invalidatePreview();
          $("importform").reset();
          say(
            $("import-msg"),
            `Restored ${r.data.imported} records; kept ${r.data.skipped} matching records. Your pre-restore backup was downloaded.`,
          );
        });
        if (restored) await ctx.store.load();
      } catch (error) {
        say($("import-msg"), error.message, true);
      }
    });
  });

  $("export-device").addEventListener("click", () =>
    downloadFile(
      "jiggered-device-recovery.json",
      JSON.stringify(
        {
          ...ctx.store.recoveryExport(),
          drafts: ctx.drafts.export(),
          legacyCopies: ctx.legacyCopies(),
        },
        null,
        2,
      ),
    ),
  );
  $("export-all").addEventListener("click", async () =>
    withBusy($("export-all"), "Downloading…", async () => {
      await ctx.store.flush();
      if (ctx.store.status().pending || ctx.store.status().failed)
        return say(
          $("export-msg"),
          "Your server export would miss unsaved changes. Resolve them or download the device recovery copy.",
          true,
        );
      const r = await api("GET", "/api/export");
      if (!r.ok) return say($("export-msg"), r.error, true);
      ctx.measure("export_created");
      downloadFile(`jiggered-${ctx.today()}.json`, JSON.stringify(r.data, null, 2));
      say($("export-msg"), "Server data downloaded.");
    }),
  );

  // ---- delete ----
  $("delform").addEventListener("submit", async (e) => {
    e.preventDefault();
    return withBusy($("delform").querySelector("[type=submit]"), "Deleting…", async () => {
      if (!confirm("Delete your account and everything you've logged? This can't be undone."))
        return;
      const r = await api("DELETE", "/api/me", { password: $("del-pw").value });
      if (!r.ok) return say($("del-msg"), r.error, true);
      await ctx.leave();
    });
  });

  return {
    snapshot: () => ({
      importMode: document.querySelector('input[name="import-mode"]:checked').value,
    }),
    render() {
      renderSettings();
      profile.render();
    },
    focus: (key) => {
      if (key === "profile-panel") {
        $(key).scrollIntoView({ block: "start" });
        $("profile-form").elements.energyTheme[0].focus();
      } else editor.focus(key);
    },
    recover(value) {
      baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) };
      editor.fill(normaliseSettings(value));
      setDirty(true);
      ticket = null;
      ctx.drafts?.put("settings", { value: editor.read(), baseline });
      say(
        $("set-msg"),
        "Recovered copy opened. Save it, then resolve or discard the old recovery item.",
      );
      editor.focus("set-acts");
      if (value.profile) profile.recover(value.profile);
    },
    show() {
      if (!dirty && !ticket) {
        baseline = { ...ctx.settings(), activities: identifyActivities(ctx.settings().activities) };
        editor.fill(baseline);
      }
      renderSettings();
      paintGap();
      profile.show();
      security.load();
      loadSessions();
      loadUsage();
      loadConsent();
    },
  };
}
