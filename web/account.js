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
  sectionTabKeys,
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

const plural = (n, one) => `${n} ${one}${n === 1 ? "" : "s"}`;
function say(el, text, bad = false) {
  el.textContent = text;
  el.classList.toggle("err", bad);
  if (!text || !el.isConnected || !matchMedia("(max-width: 700px)").matches) return;
  // On a phone the message can sit below the screen or under the fixed tab bar: bring it into view.
  const r = el.getBoundingClientRect();
  if (r.bottom > innerHeight - 90 || r.top < 0)
    el.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
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

const ACCOUNT_SECTIONS = [
  {
    id: "settings",
    label: "Energy & lists",
    hint: "Points, activities and pick-lists",
    title: "Energy & personal lists",
    description: "Set your daily budget and the lists you pick from.",
    panels: ["settings-panel"],
  },
  {
    id: "profile",
    label: "Profile",
    hint: "Name, photo and energy language",
    title: "Make it yours",
    description: "Private preferences that follow your account across devices.",
    panels: ["profile-panel"],
  },
  {
    id: "password",
    label: "Password",
    hint: "Change how you sign in",
    title: "Change password",
    description: "Choose a new password; your other devices are signed out.",
    panels: ["pw-panel"],
  },
  {
    id: "security",
    label: "Sign-in security",
    hint: "Extra protection",
    title: "Sign-in security",
    description: "Keep your account safe from anyone else signing in.",
    panels: ["security-panel"],
  },
  {
    id: "devices",
    label: "Devices",
    hint: "Where you're signed in",
    title: "Your devices",
    description: "See and sign out the places you're signed in.",
    panels: ["sessions-panel"],
  },
  {
    id: "data",
    label: "Your data",
    hint: "Export, privacy and deletion",
    title: "Your data",
    description: "Download a copy, read how it is kept, or delete your account.",
    panels: ["data-panel", ".account-privacy", ".danger-zone"],
  },
];

// The sidebar, intro and section chrome reuse the Admin workspace's classes and styles.
function initAccountNavigation(panel, ctx) {
  const workspace = document.createElement("div");
  workspace.className = "admin-workspace account-workspace";
  setHTML(
    workspace,
    html`<aside class="admin-sidebar" id="account-shortcuts"><p class="eyebrow">YOUR SPACE</p><h2>Account</h2>
    <div class="admin-nav" role="tablist" aria-label="Account sections" aria-orientation="vertical">${ACCOUNT_SECTIONS.map(
      (section, i) =>
        html`<button type="button" role="tab" id="account-tab-${section.id}" data-account-section="${section.id}" aria-controls="account-section-${section.id}" aria-selected="false" tabindex="-1"><span class="admin-nav-number" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><span><b>${section.label}</b><small>${section.hint}</small></span><span class="admin-nav-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="m9 5 7 7-7 7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>`,
    )}</div>
    <p class="admin-nav-note">Yours alone to change.</p></aside>
    <div class="admin-content"><div class="admin-intro"><div><p class="eyebrow">YOUR ACCOUNT</p><h2 id="account-section-title"></h2><p id="account-section-description" class="meta"></p></div></div>
    ${ACCOUNT_SECTIONS.map((section) => html`<section id="account-section-${section.id}" class="admin-section" role="tabpanel" aria-labelledby="account-tab-${section.id}" tabindex="0" hidden></section>`)}</div>`,
  );
  for (const section of ACCOUNT_SECTIONS)
    for (const sel of section.panels)
      workspace
        .querySelector("#account-section-" + section.id)
        .append(panel.querySelector(sel.startsWith(".") ? sel : "#" + sel));
  panel.querySelector(".profile-hero").after(workspace);
  const tabs = [...workspace.querySelectorAll("[data-account-section]")];
  let current = "";
  function select(id, focus = false) {
    const section = ACCOUNT_SECTIONS.find((section) => section.id === id);
    if (!section) return;
    current = id;
    tabs.forEach((tab) => {
      const active = tab.dataset.accountSection === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    for (const item of ACCOUNT_SECTIONS) $("account-section-" + item.id).hidden = item.id !== id;
    $("account-section-title").textContent = section.title;
    $("account-section-description").textContent = section.description;
    if (focus) $("account-tab-" + id).focus();
  }
  tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.accountSection)));
  sectionTabKeys(workspace.querySelector(".admin-nav"), tabs, (tab) =>
    select(tab.dataset.accountSection, true),
  );
  const saved = ctx.ui?.get("account").section;
  select(ACCOUNT_SECTIONS.some((section) => section.id === saved) ? saved : "settings");
  return {
    section: () => current,
    // Open whichever section holds an element, so a deep link or a recovery never lands on a hidden one.
    reveal(el) {
      const host = el?.closest(".admin-section");
      if (host) select(host.id.replace("account-section-", ""));
    },
  };
}

export function init(ctx) {
  const { me } = ctx;
  identity(ctx);
  async function loadUsage() {
    const r = await api("GET", "/api/me");
    if (!r.ok || !r.data.usage) {
      $("account-usage").textContent = "Could not load storage usage. Reopen Account to retry.";
      return;
    }
    const u = r.data.usage;
    $("account-usage").textContent =
      `${u.docs} of ${u.max_docs} records · ${(u.bytes / 1048576).toFixed(1)} of ${(u.max_bytes / 1048576).toFixed(0)} MB used.${u.docs >= u.max_docs * 0.9 || u.bytes >= u.max_bytes * 0.9 ? " Near the limit: export a copy and contact your instance administrator. Records are never removed automatically." : ""}`;
  }
  // Below "Your privacy", and only when the operator has switched it on: a disabled form of legal text above the
  // download buttons reads like an analytics opt-in being pushed.
  document
    .querySelector(".account-privacy")
    .insertAdjacentHTML(
      "beforeend",
      `<form id="usage-consent-form" hidden><h3>Optional product usage</h3><label class="radio"><input type="checkbox" id="usage-consent"> Help improve Jiggered with local task counts</label><details><summary>About optional usage counts</summary><p class="meta">Off by default. With your permission, Jiggered stores coarse weekly task counts and days active for capture, History, generated exports, print requests, settings, save failures and recovered saves, for up to 90 days. No symptoms, notes, activity names, record dates or IP addresses are sent. Admin reports hide groups smaller than five; consent is linked to your account for deletion. Disabling deletes your stored events. No external analytics service.</p></details><button type="submit" class="secondary">Save usage preference</button><p id="usage-consent-msg" class="msg" role="status"></p></form>`,
    );
  async function loadConsent() {
    const r = await api("GET", "/api/me/usage-consent");
    if (!r.ok) {
      $("usage-consent-msg").textContent =
        "Could not load usage preference. Try again by reopening Account.";
      return;
    }
    $("usage-consent-form").hidden = !r.data.available && !r.data.enabled;
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
  const nav = me.must_change_password ? null : initAccountNavigation($("account-panel"), ctx);
  $("account-signout")?.addEventListener("click", () => $("signout").requestSubmit());

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
      // The device recovery copy is for support, not for this form: say so instead of listing its keys as errors.
      if (data?.format === "jiggered-device-recovery-v1")
        return say(
          msg,
          "That is a device copy, not an account export. Choose a file named like jiggered-2026-10-05.json (from Download everything).",
          true,
        );
      const mode = document.querySelector("input[name=import-mode]:checked").value;
      const r = await api("POST", "/api/restore/preview?mode=" + mode, data);
      if (!r.ok) {
        // A long list of record problems is a wall; the first few say what kind of file this is.
        const issues = r.data?.issues || [];
        const shown = issues.slice(0, 3);
        if (issues.length > 3) shown.push(`…and ${issues.length - 3} more.`);
        return say(msg, [r.error, ...shown].join("\n"), true);
      }
      restorePreview = { data, mode, token: r.data.token };
      const p = r.data;
      $("import-preview").hidden = false;
      setHTML(
        $("import-preview"),
        html`<h3>Review restore</h3><p>${plural(p.additions, "new record")}. ${plural(p.matches, "matching record")}. ${p.overwrites} will be replaced; ${p.skipped} will be kept.</p><p>${p.settingsChanged ? "Your settings will change, including activity lists and ordering." : "Your current settings will be kept."}</p><p>A private copy of your current server data will download before restoring. Keep it: it lets you put back records the restore replaced. Records the restore adds are not removed by it.</p><button class="${p.overwrites ? "danger" : "primary"}" id="import-confirm" type="button">Download backup and ${p.overwrites ? `replace ${p.overwrites} matching records` : "restore missing records"}</button>`,
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
          downloadFile(
            `jiggered-before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
            JSON.stringify(backup.data, null, 2),
          );
          ctx.measure("export_created");
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
            `Restored ${plural(r.data.imported, "record")}; kept ${plural(r.data.skipped, "matching record")}. Your pre-restore backup was downloaded.`,
          );
        });
        if (restored) {
          await ctx.store.load();
          await loadUsage();
        }
      } catch (error) {
        say($("import-msg"), error.message, true);
      }
    });
  });

  $("export-device").addEventListener("click", () => {
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
    );
    say(
      $("export-msg"),
      "Device copy downloaded. It can't be restored on this page; keep it in case you need support.",
    );
  });
  $("export-all").addEventListener("click", async () =>
    withBusy($("export-all"), "Downloading…", async () => {
      await ctx.store.flush();
      if (ctx.store.status().pending || ctx.store.status().failed)
        return say(
          $("export-msg"),
          "Your server export would miss unsaved changes. Resolve them or download the device copy.",
          true,
        );
      const r = await api("GET", "/api/export");
      if (!r.ok) return say($("export-msg"), r.error, true);
      downloadFile(`jiggered-${ctx.today()}.json`, JSON.stringify(r.data, null, 2));
      ctx.measure("export_created");
      say($("export-msg"), "Server data downloaded.");
    }),
  );

  // ---- delete ----
  $("delform").addEventListener("submit", async (e) => {
    e.preventDefault();
    return withBusy($("delform").querySelector("[type=submit]"), "Deleting…", async () => {
      // Ask for the password first: a scary question that ends in "wrong password" is the wrong way round.
      if (!$("del-pw").value) {
        $("del-pw").focus();
        return say($("del-msg"), "Enter your password to delete your account.", true);
      }
      if (
        !confirm(
          "Delete your account and everything you've logged from this server? This can't be undone. Copies already in server backups are not erased.",
        )
      )
        return;
      const r = await api("DELETE", "/api/me", { password: $("del-pw").value });
      if (!r.ok) return say($("del-msg"), r.error, true);
      await ctx.leave("deleted");
    });
  });

  return {
    snapshot: () => ({
      importMode: document.querySelector('input[name="import-mode"]:checked').value,
      section: nav?.section(),
    }),
    refreshUsage: loadUsage,
    render() {
      renderSettings();
      profile.render();
    },
    focus: (key) => {
      nav?.reveal($(key));
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
      say($("set-msg"), "Held copy opened. Save it, then resolve or discard the held change.");
      nav?.reveal($("set-acts"));
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
