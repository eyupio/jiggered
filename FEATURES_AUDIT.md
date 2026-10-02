# Jiggered — functionality and product audit

Jiggered is a small self-hosted energy and symptom diary for people who want to pace their day, capture episodes with little effort, and bring a useful record to a conversation or appointment. Users choose a morning check-in, record activities against their own points or spoons allowance, and record symptoms, preceding factors and episode duration. An operator manages separate accounts, shared starting lists and recovery infrastructure. Its core job is **“help me record what happened, understand my own recent days and share only what I choose.”** Its strongest positioning is a calm, adaptable diary on infrastructure the user trusts, rather than a diagnostic tool, fitness coach or clinical monitoring platform.

## Feature inventory

Completeness describes the current implementation, not production certification. Complete means a coherent implemented lifecycle; partial means a material companion or edge case remains; rough means usable but awkward. No intentional product stubs were found. Absences appear explicitly below rather than being mislabelled as implemented features.

| Area         | Feature                                                                                    | Serves | Completeness                                                                    |
| ------------ | ------------------------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------- |
| Discovery    | Public home and feature/help pages; capability-aware signup links                          | Both   | Complete                                                                        |
| Discovery    | Canonicals, optional indexing, sitemap, robots and machine-readable guide                  | Admin  | Complete                                                                        |
| Access       | Password login, forced first password change, throttling, disabled accounts                | Both   | Complete                                                                        |
| Access       | Optional verified-email registration                                                       | Both   | Partial: resend/expired-link journey and delivery visibility                    |
| Access       | Verified recovery email and forgotten-password reset                                       | Both   | Partial: requests can fail after the public acknowledgement                     |
| Access       | Authenticator 2FA, QR/manual key, one-time recovery codes, regeneration/disable            | Both   | Partial: setup cancellation and operator status                                 |
| Access       | Session listing, individual/other/all-device revocation                                    | Both   | Complete                                                                        |
| Today        | Green/amber/red morning check-in, change/clear with undo                                   | User   | Complete                                                                        |
| Today        | Poor-sleep marker and configurable sleep/check-in costs                                    | User   | Complete                                                                        |
| Today        | Points/spoons allowance, balance ring, recovery activities, over-allowance explanation     | User   | Complete                                                                        |
| Today        | Activity buttons, repeat +/- controls, groups, search, frequent/recent suggestions         | User   | Complete                                                                        |
| Today        | Other activity, edit time/name/cost, removal/undo                                          | User   | Partial: one-off activity cannot directly become a saved choice                 |
| Today        | Past-day capture, day navigation/date picker, midnight/resume handling                     | User   | Complete                                                                        |
| Today        | First-use checklist with budget control                                                    | User   | Partial: budget action and completion message are not aligned                   |
| Episodes     | Start, symptoms, onset, approximate duration, triggers and notes                           | User   | Complete                                                                        |
| Episodes     | Search/group chips, favourites and selected-chip visibility                                | User   | Complete                                                                        |
| Episodes     | Edit/delete/undo, ongoing list, finish action, exact end time                              | User   | Complete                                                                        |
| Episodes     | Recorded zones/offsets and legacy handling                                                 | User   | Complete within the documented local-time contract                              |
| History      | 7/30/90/180/365/all/custom ranges, search and record-type filters                          | User   | Complete                                                                        |
| History      | Calendar grid, colour modes, pinned day, keyboard access and bounded windows               | User   | Complete                                                                        |
| History      | Day/episode record lists and incremental display                                           | User   | Complete                                                                        |
| History      | Energy/episode/combined charts, buckets and inspect controls                               | User   | Complete                                                                        |
| History      | Descriptive metrics and previous-period comparison                                         | User   | Partial: episode comparison needs stronger coverage context                     |
| Sharing      | Filtered day and episode CSV                                                               | User   | Partial: episode notes always exported; activities flattened into one cell      |
| Sharing      | Preview/print summary, optional private notes and tracking focus                           | User   | Partial: daily activity detail cannot be included                               |
| Data         | Full personal JSON export                                                                  | User   | Complete                                                                        |
| Data         | Validated restore preview, keep/replace modes, revision checks, pre-restore download       | User   | Complete with documented limits; added records lack direct rollback             |
| Data         | Offline shell, durable cache/outbox, acknowledged-save feedback                            | User   | Complete within documented browser support                                      |
| Data         | Refused edits/conflicts, retry/edit/discard/download recovery                              | User   | Complete                                                                        |
| Data         | Single editing tab, follower tabs, draft expiry and sign-out warnings                      | User   | Complete                                                                        |
| Profile      | Private display name, focus, avatar upload/removal, appearance, energy vocabulary          | User   | Complete                                                                        |
| Profile      | Current region for emergency copy, date format and default History range                   | User   | Complete                                                                        |
| Preferences  | Per-tab saved filters, selected day, open sections, charts and scroll position             | Both   | Complete for browser refresh; intentionally session/tab scoped                  |
| Settings     | Activity/symptom/trigger editing, grouping, validation and pointer/touch/keyboard ordering | Both   | Complete                                                                        |
| Settings     | Shared-default adoption/merge, conflict-aware personal edits                               | Both   | Complete                                                                        |
| Support      | Searchable Help, contextual links, tooltips and recovery guidance                          | Both   | Partial: operator recovery still sends users to README                          |
| Admin        | Create/reset/disable/enable/delete users, roles and last-admin protection                  | Admin  | Complete                                                                        |
| Admin        | People counts, last login, document/byte/session counts                                    | Admin  | Rough: no search/filter or limit headroom                                       |
| Admin        | Metadata-only access boundary, 2FA reset with additional proof                             | Both   | Complete; full backup remains the disclosed exception                           |
| Admin        | Audit list, refresh, older pagination and retention                                        | Admin  | Partial: no filters; newer events fall back to raw action names                 |
| Admin        | Shared defaults editor and connection/proxy controls                                       | Admin  | Complete                                                                        |
| Operations   | Consistent ZIP backup, optional encryption, backup/restore/check CLI                       | Admin  | Complete                                                                        |
| Operations   | S3-compatible destination, scheduler, retention, verification, browse/download             | Admin  | Partial: latest attempt obscures last usable copy; restore rehearsal outside UI |
| Operations   | SMTP tests, backup success/failure notification preferences                                | Admin  | Complete for configured operational delivery                                    |
| Operations   | Account email delivery background tasks                                                    | Both   | Partial: bounded in-memory work with no durable retry/status view               |
| Operations   | Health endpoint, container healthcheck, schema safety snapshots, CI/browser scenarios      | Admin  | Complete as implemented; execution limits below                                 |
| Engagement   | Personal tracking focus and in-History review                                              | User   | Partial: no gentle in-app weekly review entry point                             |
| Engagement   | Product activation/task-completion measurement                                             | Admin  | Absent; security audit and account counts are not product analytics             |
| Engagement   | Scheduled personal check-in reminders                                                      | User   | Absent; defer infrastructure until users ask for it                             |
| Integrations | S3 and SMTP                                                                                | Admin  | Complete with provider-specific configuration                                   |
| Integrations | Wearables, medication management, clinician portal, payments                               | Both   | Absent, deliberately outside the recommended scope                              |

## Competitor comparison

Research checked 2 October 2026 using official product/help pages. These are capability comparisons, not hands-on competitor tests. “Not established” means the cited material did not establish that capability; it does not assert absence. Plan/device restrictions may apply. No pricing comparison is used.

| Capability               | Jiggered                                                            | Bearable                              | Visible                                    | Daylio                                        | Manage My Pain                                                       | Notes                                                                                                      |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Low-effort daily capture | Check-in plus activity taps                                         | Customisable health entries           | Illness/pacing check-ins                   | Mood/activity taps                            | Pain records and reflections                                         | Broad parity in the capture job; Jiggered should preserve its smaller surface                              |
| Energy/pacing            | Manual personal allowance and recovery costs                        | Energy/factor tracking                | Continuous wearable pacing with membership | Mood/activity journal; pacing not established | Pain/function focus                                                  | Jiggered is adaptable manual planning; Visible is the strongest specialist benchmark                       |
| Symptom history          | Episodes, onset, duration, triggers, notes                          | Custom symptoms, severity and factors | Symptoms plus pacing trends                | Mood/activity statistics                      | Pain characteristics and function                                    | Optional intensity is a possible future gap, not a current priority                                        |
| Calendar and trends      | Multi-range calendar, charts and filters                            | Timeline/calendar and insights        | Trends and health reports                  | Year-in-pixels and statistics                 | Results charts                                                       | Jiggered already has substantial review capability                                                         |
| Sharing                  | CSV, personal JSON, print-to-PDF summary                            | CSV and sharing guidance              | CSV and health reports                     | PDF/CSV                                       | Structured clinician reports                                         | Improve Jiggered's report content/selection before adding new formats                                      |
| Reminders/review         | No scheduled personal reminders; History review                     | Reminders and weekly reports          | Pacing notifications and check-ins         | Reminders and goals                           | Daily reflection; reminders not established by selected feature page | Borrow useful review entry points, not streak pressure                                                     |
| Customisation            | Costs, lists, groups, order, points/spoons, focus                   | Custom symptoms/factors and layout    | Pacing settings and symptoms               | Activities, moods, themes                     | Personal pain details and medication                                 | Jiggered already has strong practical customisation                                                        |
| Data control/recovery    | Self-hosted, separate accounts, JSON restore and operator S3 backup | Export/delete controls                | Export controls                            | Backup/import and exports                     | Account/report platform                                              | Jiggered's self-hosted operator model is a differentiator; competitors' equivalent hosting not established |
| Operator tooling         | Users, sessions, defaults, audit, backups, SMTP                     | Consumer support model                | Consumer membership/support model          | Consumer support model                        | Clinical platform also described                                     | Consumer apps are not direct benchmarks for Jiggered's admin console                                       |

Sources: Bearable describes custom health tracking, reporting and data control. [Source](https://bearable.app/) Its sharing guidance and feature split document CSV, while its help material covers reminders. [Source](https://bearable.app/support/common-questions/how-to-share-data-with-a-doctor-therapist-or-other-medical-team-member/) [Source](https://bearable.app/support/common-questions/bearable-free-vs-premium-features/) [Source](https://bearable.app/support/common-questions/customise-medication-reminders/) Visible documents wearable pacing and check-in export. [Source](https://www.makevisible.com/) [Source](https://help.makevisible.com/en/articles/9583077-data-export) [Source](https://help.makevisible.com/en/articles/9615087-what-is-the-free-research-app) Daylio documents calendar/statistics, reminders, PDF/CSV and backup/import. [Source](https://daylio.net/) [Source](https://daylio.net/faq/backup-file-manual-import-and-export/) Manage My Pain documents pain capture, reflection and structured reports. [Source](https://managemypainapp.com/features)

**Fit:** borrow report clarity, visible personalisation, explicit recovery steps and voluntary review habits. Double down on simple manual energy planning, regional/personal choices, recoverable offline capture and trusted self-hosting. Do not copy wearable subscriptions, clinical scoring, medication adherence, gamified streaks, AI interpretation, paid report gates or a clinical portal without a separate evidenced need. Those change the audience, operating cost and responsibility.

## Personas used in Pass 2

| Persona                      | Situation                                                              | Main job                                                    | Constraints                                                                     |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| P1 — New member              | Has a trusted household/support-group instance and little spare energy | Join, make a first check-in and tailor a few choices        | Phone, cognitive load, uncertainty about costs and setup                        |
| P2 — Returning recorder      | Logs intermittently through fatigue and uses several devices           | Record quickly, correct mistakes and review recent days     | Interrupted work, offline access, gaps in logging                               |
| P3 — Appointment preparer    | Uses their log to explain several weeks of episodes                    | Find relevant records and share a concise, private summary  | Limited appointment time, notes may be personal, mixed activity/episode context |
| P4 — Small-instance operator | Supports a household or small group                                    | Restore access, maintain defaults and ensure recovery works | No need to read health content; limited infrastructure/support time             |

## Overall verdict

Jiggered is strongest at capture, personalisation and protecting work: there are already drafts, failed-edit recovery, conflict handling, back-dating, undo, shared defaults, export and account controls. The recent calmer History layout is the right direction. It is weakest at **finishing the job across feature boundaries**: CSV privacy differs from print privacy, selected-day detail does not flow straight into sharing, account mail failures are hard to diagnose, and backup status emphasises attempts rather than usable recovery. The biggest opportunity is to make existing records easier to trust, use and share with fewer decisions. There is a substantial small-change backlog; larger new features do not earn priority now.

## Audit scope and verification

- Source baseline: `main`, commit `e9a21f5883b928f17d4f96a7d13421f474cd501f`, fetched on 2 October 2026. No application edits, commits, issues or PRs were made.
- Read current routes and handlers in `main.go`, account/auth/security/admin/defaults/docs/validation/settings files, database schema, backup/archive/restore/remote-service/SMTP jobs and CLI; inspected application modules and targeted HTML/CSS, manifests, README, contributor guidance, CI and existing audit dispositions using direct reads and source searches. Consulted issue tracker entries #2–#5 and the open-PR search, which returned no open PRs at lookup. Those old issue checklists describe earlier implementations; source is authoritative. No tracked roadmap or actionable TODO backlog was found in the inspected tree.
- The 1 October `FEATURES_AUDIT.md` was reviewed for context. This report supersedes its shipping order; FEAT IDs below are a **new audit sequence**, not continuity identifiers for old tickets. The prior audit remains available through file version history.
- Ran nine dependency-free JavaScript test files: model, history, sync, profile/view state, util, picker, device, energy theme and metrics parity: **112 passed, 0 failed**. These support contracts, not live UI quality or server correctness.
- Go is not installed here. The application's real-browser harness builds a Go server, so a running regular-user/admin walkthrough and Go checks could not be performed. Walkthrough findings below are source-traced, not observations of a live session. Existing browser scenarios were read, not reported as newly run. No production data or real S3/SMTP credentials were used. Mobile touch size, print pagination, external email delivery and provider compatibility still need live validation.
- No measured funnel/retention data was found. Drop-off and benefit estimates are reasoned hypotheses, with confidence stated per recommendation.

## Pass 2 — Source-traced job walkthroughs

### P1: join and make the diary useful

1. Open public home → registration if enabled → enter username/email/password → follow verification link. Optional registration is already capability-aware, and email ownership is proved before account creation.
2. Successful verification/reset leaves the same form available with its token cleared; the next action is weaker than a clear completed state leading to sign-in (FEAT-004). Expired or undelivered mail leads back to manual retry or operator help (FEAT-015).
3. On Today, choose a check-in, set allowance and log an activity. The checklist's completion uses check-in/activity only, while budget is a displayed setup step: “You're set up” can appear with that step unticked (FEAT-008).
4. Activity/list editing and Account shortcuts already exist. A new Other activity still requires another trip to the editor and retyping if it should be available tomorrow (FEAT-010).
5. Optional 2FA setup can be confirmed, but lacks a Cancel setup companion (FEAT-005).

**Tomorrow/recommendation driver:** personalised choices and confidence that setup really completed, not additional features. Bearable's contextual symptom editor is an adjacent benchmark; its archived help establishes the pattern, not its current exact click count. [Source](https://bearable.app/support-archive/)

### P2: record, correct and return

1. Record activities with fixed-position +/- controls; edit/remove an activity with undo. These are implemented; do not reintroduce the removed duplicate “So far” section.
2. Save an interrupted episode/settings/profile draft and return, or recover a refused edit. Existing drafts/outbox/recovery solve much of the earlier audit.
3. Other activity accepts native HTML input up to 120 characters but submit rejects over 60, causing avoidable late correction (FEAT-002).
4. Review 7/30/custom days in the calendar. Filters, selected day and scroll are restored on refresh; do not recommend adding sticky state again. Opening a new session may intentionally differ because presentation storage is tab/session scoped.
5. Episode counts compare periods regardless of sparse capture; the energy average has a minimum-data gate. A user who simply logged less can interpret the episode difference too strongly (FEAT-009).

**Tomorrow/recommendation driver:** fast familiar capture and a gentle useful review (FEAT-017). Daylio demonstrates compact capture and regular review, but its goals/streak mechanisms should not determine Jiggered's tone. [Source](https://daylio.net/)

### P3: prepare and share an appointment record

1. Select period and filters → inspect calendar → pin relevant day. Details show up to five activities and three episodes.
2. To share only that day, manually change the period; selecting a calendar cell does not itself change report selection (FEAT-013). “Review day” enters Today for editing, requiring a return to History for episode/report context.
3. Prepare summary → choose whether to include notes/focus → preview → print/PDF. Good: private notes default off. Missing: optional activity-level detail for explaining what happened (FEAT-014).
4. Export episode CSV instead: notes are unconditionally present even though the nearby print control says include private notes (FEAT-001). Zero-match selection can still download a header-only CSV without a useful explanation (FEAT-006).
5. Day CSV flattens activities into one string; structured analysis requires spreadsheet parsing (FEAT-014).

**Recommendation driver:** a complete, explicit, privacy-conscious sharing journey. Manage My Pain's structured reports are the best adjacent benchmark; copy clarity and selection, not clinical positioning. [Source](https://managemypainapp.com/features)

### P4: support access and prove recoverability

1. Open People, scan accounts, expand Manage account, reset password or reset 2FA. Metadata-only support is good; search/filter and readiness/headroom are missing (FEAT-012).
2. Look at Activity for the failed signup email. New events use raw action-name fallback and the server supports only limit/before, so relevant events require paging/scanning (FEAT-003/011).
3. Configure SMTP/S3, save/test, run backup and browse/download it. These exist and should not be proposed again.
4. A failed latest backup becomes the “Last backup” status even when an earlier successful verified copy exists. Retention failure also sets the whole run failed after upload; recoverable copy and housekeeping need separate signals (FEAT-007).
5. Rehearse recovery: leave the product for README commands and separately preserve the service credential key (FEAT-016). Product status must not claim recovery has been tested merely because upload verification passed.

**Support reduction driver:** readable diagnostics and an in-product recovery checklist, with health contents kept private. Consumer competitors do not establish an equivalent small-instance admin workflow; this is Jiggered's own operational job.

## Tier 1 — Quick wins

### FEAT-001 — Make private-note choices apply consistently to sharing

- **Type / Serves / Pass:** Feature improvement / user, P3 / Product review and Walkthrough.
- **Where:** `web/history.js` CSV handlers; `web/model.js::episodesCsv`; `web/index.html` sharing controls.
- **Problem:** Someone turns off private notes for a summary, then uses episode CSV and unintentionally shares those notes.
- **Evidence:** `sum-notes` defaults unchecked and controls print rows; `episodesCsv` always emits `e.notes`. The same sharing area exposes both outputs.
- **Proposal:** Put a clearly labelled “Include private episode notes” choice above sharing actions and apply it to summary and episode CSV. Default off, retain an explicit preference only within the existing view-state policy, and state the choice beside download. Keep full personal JSON backup lossless and clearly separate from sharing. No server schema change.
- **Acceptance criteria:** (1) Unchecked notes do not occur in CSV or preview/print. (2) Checked notes occur in both. (3) Full JSON still retains notes. (4) Downloads explain selected period/filters and note inclusion.
- **Value:** Prevents accidental disclosure and inconsistent sharing; **high confidence**.
- **Effort & risk:** **S, 0.5–1 day**; downstream CSV consumers may expect populated notes—retain column and document omitted values. Privacy improvement, no recurring cost.
- **Dependencies:** None.

### FEAT-002 — Align activity name limits before submission

- **Type / Serves / Pass:** UX tweak / user, P2 / Product review and Walkthrough.
- **Where:** `web/index.html::entry-name`; `web/today.js` submit; shared limits/validation.
- **Problem:** A 61–120-character activity can be typed successfully then refused.
- **Evidence:** HTML `maxlength="120"`; Today rejects code-point length above 60.
- **Proposal:** Use the same 60-character rule and an inline count/help/error; account for browser UTF-16 maxlength versus server/code-point counting. Preserve the typed draft after refusal and move focus to the field. Do not silently truncate saved names.
- **Acceptance criteria:** (1) ASCII boundary 60 accepted/61 rejected inline. (2) Emoji names follow the same code-point rule on client/server. (3) Error retains the draft and identifies the field.
- **Value:** Removes predictable rework at capture; **high confidence**.
- **Effort & risk:** **S, under 0.5 day**; Unicode semantics, no ongoing cost.
- **Dependencies:** None.

### FEAT-003 — Translate account and backup audit events into useful sentences

- **Type / Serves / Pass:** Admin tooling / admin, P4 / Product review and Walkthrough.
- **Where:** `web/admin.js::SENTENCE`; security/remote-service audit emitters.
- **Problem:** An operator sees `account_email_failed` instead of an intelligible next step.
- **Evidence:** New account/remote-backup event families are missing from `SENTENCE`; fallback prints raw actor/action.
- **Proposal:** Add readable mappings for current account/email/2FA/backup events, retain exact timestamps/detail, and link delivery failures to Email & signup or backup failures to Backups. Preserve a safe fallback for future unknown events. Never put tokens, email bodies or health content into audit copy.
- **Acceptance criteria:** (1) Every current emitted event has understandable text or a deliberate generic label. (2) Email failure opens the appropriate admin section. (3) Rendered detail remains escaped and contains no secrets.
- **Value:** Faster diagnosis without interpreting internal names; **high confidence**.
- **Effort & risk:** **S, 0.5 day**; only presentation, identity/IP metadata remains sensitive.
- **Dependencies:** None; complements FEAT-011/015.

### FEAT-004 — End verification and reset with a clear sign-in action

- **Type / Serves / Pass:** UX tweak / user, P1 / Walkthrough.
- **Where:** `web/login.js::submit`, verify/reset success callbacks; `web/login.html`.
- **Problem:** The successful form remains submittable with its consumed token cleared; users can repeat the action and receive a confusing error.
- **Evidence:** Success callbacks set `token = ""`, while `finally` re-enables the same button. Existing sign-in links do not create a dedicated completion state.
- **Proposal:** Replace the successful form controls with “Email verified” or “Password changed” and a primary Sign in action. Avoid auto-login after password reset; preserve 2FA. Distinguish failed/expired links from completed actions.
- **Acceptance criteria:** (1) Consumed-token forms cannot submit again. (2) Primary sign-in action works by keyboard and touch. (3) Reset does not bypass 2FA or create a session.
- **Value:** Fewer stalls at activation/recovery; **high confidence**.
- **Effort & risk:** **S, 0.5 day**; auth presentation only, no recurring cost.
- **Dependencies:** None.

### FEAT-005 — Add Cancel to authenticator setup

- **Type / Serves / Pass:** Feature improvement / user, P1 / Product review and Walkthrough.
- **Where:** `web/security.js`; `two_factor.go`, `account_security.pending_secret`.
- **Problem:** Starting setup exposes a QR/key and hides the setup button, but the user cannot explicitly cancel that incomplete workflow.
- **Evidence:** `pending` is local UI state; controls offer start/enable/regenerate/disable, no cancel.
- **Proposal:** Add Cancel setup. Clear visible QR/key/code immediately and invalidate the pending server secret using the authenticated security action. Retain an existing enabled factor if a later workflow extends setup to replacement. Do not log the key or persist it as a draft.
- **Acceptance criteria:** (1) Cancel removes QR/key and restores the original state. (2) A cancelled pending key cannot subsequently enable protection. (3) Cancelling leaves existing enabled 2FA intact and does not claim setup completed.
- **Value:** Completes a sensitive setup lifecycle; **high confidence**.
- **Effort & risk:** **S, 0.5–1 day**; authentication regression risk needs focused server coverage.
- **Dependencies:** None.

### FEAT-006 — Explain empty sharing selections before downloading

- **Type / Serves / Pass:** UX tweak / user, P3 / Product review and Walkthrough.
- **Where:** `web/history.js::render` and CSV/summary actions.
- **Problem:** Zero matching episodes still permits a header-only episode CSV, which can look like a broken download.
- **Evidence:** Sharing actions are disabled only for `data.error`, not zero result counts.
- **Proposal:** Show separate day/episode counts beside their actions. Disable the empty record-type export with explanatory text and Clear filters/Change period actions. A summary with zero records should show an explanatory preview and offer an explicit empty report only if useful; avoid a silent blank result. No data change.
- **Acceptance criteria:** (1) Zero episodes cannot silently produce a header-only episode export. (2) A period with days but no episodes can still export days. (3) Clearing filters preserves the selected period, matching existing behaviour.
- **Value:** Less confusion and support around apparently missing data; **high confidence**.
- **Effort & risk:** **S, 0.5 day**; ensure disabled controls have nearby accessible explanation.
- **Dependencies:** None.

### FEAT-007 — Show last usable backup separately from last attempt

- **Type / Serves / Pass:** Admin tooling / admin, P4 / Product review and Walkthrough.
- **Where:** `remote_services.go::adminGetServices/runRemoteBackup`; `web/services.js::status`.
- **Problem:** A latest failure obscures an earlier successful copy; failed retention is reported as an overall backup failure even after successful upload.
- **Evidence:** UI uses `runs[0]` for Last backup. Run status becomes failed for upload, verification and retention errors alike; next schedule uses latest start.
- **Proposal:** First ship distinct last-attempt and last-success timestamps using existing history, plus a clear warning when the latest attempt failed. Do not infer usability from object-key presence on a failed run. In a follow-up within this item, record upload/verification/retention stages so successful verified upload with failed housekeeping reads “Copy verified; retention needs attention.” Show that hash verification is not a restore test. Keep scheduling semantics unchanged initially.
- **Acceptance criteria:** (1) Failure after a successful run displays both timestamps/statuses. (2) Unverified/failed upload is never labelled verified. (3) Retention failure cannot erase the successful-copy signal once staged outcomes exist. (4) No duplicate upload is triggered to repair display status.
- **Value:** Operators know whether a recovery copy exists; **high confidence**.
- **Effort & risk:** **S for display, 0.5 day; M for stages, 1–2 days**. Initial quick-win release only covers display. Schema compatibility and alert wording need care; verification has existing bandwidth cost.
- **Dependencies:** None; staged outcomes precede FEAT-016 status integration.

### FEAT-008 — Make first-use checklist completion match its steps

- **Type / Serves / Pass:** UX tweak / user, P1 / Product review and Walkthrough.
- **Where:** `web/today.js::renderOnboarding`; onboarding markup/settings.
- **Problem:** “You're set up” can appear while the displayed budget step is unticked.
- **Evidence:** `done = checked && logged`; budget tick checks `ob.budget` separately.
- **Proposal:** Make budget review explicitly optional with “Use this allowance”/“Change” or include explicit confirmation in completion. Prefer optional review, since a first log should not require settings work. Allow the user to reopen setup from Help after dismissal. Reuse existing settings patch, not a new onboarding service.
- **Acceptance criteria:** (1) Completed wording has no unexplained unfinished required step. (2) Keeping the default is an explicit valid choice. (3) Dismissal remains respected; reopen is user initiated.
- **Value:** More understandable first use with less forced work; **high confidence**.
- **Effort & risk:** **S, 0.5–1 day**; onboarding flag compatibility, no recurring cost.
- **Dependencies:** None.

### FEAT-009 — Put logging coverage beside episode comparisons

- **Type / Serves / Pass:** UX tweak / user, P2/P3 / Product review and Walkthrough.
- **Where:** `web/history.js` episode metric; `web/history-model.js` period metrics.
- **Problem:** “Fewer than previous period” may reflect fewer logs rather than fewer episodes experienced.
- **Evidence:** Average-energy comparison requires three activity days per period; episode difference is unconditional. General caveat exists but is separated from the count.
- **Proposal:** Say “X episodes recorded versus Y in the previous period”; place calendar span and check-in/log coverage next to the comparison. For an empty/sparse previous period use “Previous period has limited records.” Never infer episode-free days from absent entries or imply a health improvement. Keep raw count available.
- **Acceptance criteria:** (1) Empty previous period is described as limited data. (2) Counts remain correct with filters and unequal/sparse coverage. (3) No improvement/decline claim appears from recording frequency alone.
- **Value:** More interpretable review and sharing; **high confidence**.
- **Effort & risk:** **S, 0.5 day**; health-interpretation risk reduced; no recurring cost.
- **Dependencies:** None.

## Tier 2 — Incremental improvements

### FEAT-010 — Turn a one-off activity into a saved choice without retyping

- **Type / Serves / Pass:** Feature improvement / user, P1/P2 / Walkthrough.
- **Where:** `web/today.js` Other activity form; settings patch/editor and model activity IDs.
- **Problem:** Recording a useful new activity today does not make it available tomorrow; the user repeats its name/cost in Account.
- **Evidence:** Other activity dispatches only `addEntry`; saved activities are maintained separately by the editor.
- **Proposal:** Add an optional “Also add to my activities” checkbox, revealing optional group. Dispatch capture and settings addition as individually tracked operations; show capture success separately if settings addition fails. Reuse stable IDs and existing conflict checks. Exact duplicate name should offer existing choice/update in editor rather than silently add. Historical costs stay stamped.
- **Acceptance criteria:** (1) One action records the entry and creates tomorrow's choice when both saves succeed. (2) Duplicate/case/trim handling matches editor validation. (3) A failed settings save never loses or duplicates the captured entry. (4) Retry/recovery shows which operation remains unresolved.
- **Value:** Less repetitive personalisation; **high confidence**.
- **Effort & risk:** **M, 1–2 days**; two-operation consistency/conflicts; no external cost.
- **Dependencies:** FEAT-002 recommended first.

### FEAT-011 — Filter audit history around the support question

- **Type / Serves / Pass:** Admin tooling / admin, P4 / Product review and Walkthrough.
- **Where:** `admin.go::adminAudit`; `web/admin.js::loadAudit`; audit index/query and view-state.
- **Problem:** Finding one person's reset or yesterday's email failures requires scanning unrelated older pages.
- **Evidence:** API supports only bounded limit/before; UI offers refresh/older, no actor/target/action/date filters.
- **Proposal:** Add server-side actor/target, event family and date filters with stable ID cursor pagination. Provide readable chips and Reset filters; persist nonsensitive selections using existing view state. Exact date/time and timezone should be visible. Defer audit CSV until demanded; filtering delivers the primary benefit.
- **Acceptance criteria:** (1) Filtered older pages contain no duplicates/skipped matches. (2) Email-failure family finds existing and future mapped failure events. (3) Filters do not retrieve health documents. (4) Refresh/reload preserves selections and shows an empty-state action.
- **Value:** Faster support and diagnosis; **high confidence**.
- **Effort & risk:** **M, 2–3 days**; query/index changes and identity metadata privacy; no external service.
- **Dependencies:** FEAT-003.

### FEAT-012 — Give People search, account readiness and storage headroom

- **Type / Serves / Pass:** Admin tooling / both, P4/P2 / Product review and Walkthrough.
- **Where:** `users.go::listUsers`, `admin.go`, `account.go::handleMe`, `web/admin.js`, Account data panel.
- **Problem:** Operators scan all accounts and cannot quickly see access/recovery readiness; users learn fixed storage limits only at refusal.
- **Evidence:** People has counts/last login and no search/filter; `/api/me` has no usage. Limits are 10,000 documents and 25 MiB in `docs.go`; security readiness is in separate tables/routes.
- **Proposal:** Add username search and enabled/disabled/awaiting-first-password filters. Show verified-recovery available, 2FA enabled and unused-code count as support metadata without revealing email addresses by default or authenticator secrets. Show used/maximum record and byte capacity in Account and People; near-limit guidance links to export and support, never automatic deletion. A 2FA reset action should reflect the actual current state.
- **Acceptance criteria:** (1) Search/filter returns correct users without health content. (2) Readiness never exposes secrets/recovery codes. (3) Usage agrees with quota enforcement after saves/deletes/import. (4) Users receive useful near-limit warning before a refused new record.
- **Value:** Less account support and fewer quota surprises; **high confidence**.
- **Effort & risk:** **M, 2–4 days**; small additional metadata exposure and API/query work; no recurring external cost.
- **Dependencies:** None; FEAT-011 links can be follow-up.

### FEAT-013 — Connect selected-day review to complete records and sharing

- **Type / Serves / Pass:** Feature improvement / user, P3/P2 / Walkthrough.
- **Where:** `web/history-matrix.js::detail`; `web/history.js` filters/selectedDocs/summary; Today navigation.
- **Problem:** A pinned date is distinct from the report range; users must change dates manually to share it, and full review jumps to Today while episodes remain elsewhere.
- **Evidence:** Matrix detail truncates five activities/three episodes; Review day calls Today navigation. CSV/summary use `currentData` for the whole selected/filter range.
- **Proposal:** Add explicit “Share this day” and “Show all records for this day” beside “Edit day.” Reuse the History filter pipeline with a visible one-day selection and Return to previous period. Show complete activity/episode detail inline or in an accessible drawer, keeping editing in existing forms. Do not silently change sharing scope just because keyboard focus moves through cells.
- **Acceptance criteria:** (1) Share this day exports only that date's matching records. (2) Return restores prior range, filters, cell and scroll. (3) All day activities/episodes are reachable without switching tabs solely to read them. (4) Keyboard focus inspection alone cannot alter export selection.
- **Value:** Fewer steps and less selection ambiguity; **high confidence**.
- **Effort & risk:** **M, 2–3 days**; navigation/state interactions, phone drawer and focus QA; no external cost.
- **Dependencies:** FEAT-001/006.

### FEAT-014 — Include useful activity detail in report and structured export

- **Type / Serves / Pass:** Feature improvement / user, P3 / Product review, Walkthrough and Competitor comparison.
- **Where:** `web/history.js::renderSummary`; `web/model.js::daysCsv`; sharing markup.
- **Problem:** Printed days show totals but omit which activities used/recovered energy; day CSV encodes all activities in one cell.
- **Evidence:** Summary day columns are date/status/net/sleep. CSV joins entries with semicolons. Structured reports are a central Manage My Pain capability. [Source](https://managemypainapp.com/features)
- **Proposal:** Add optional “Include activity detail” in preview/print, off initially to keep reports concise. Offer activity CSV with one entry per row: day, entry ID where present, local time, label, signed cost and documented cost semantics. Retain existing day CSV for compatibility. Mark missing times and omit unknown legacy IDs rather than invent stable provenance. Reuse period/filter selection, explain filters that apply only to episodes.
- **Acceptance criteria:** (1) Optional detail matches the selected records exactly. (2) Activity CSV preserves repeat entries, recovery and zero-cost events separately. (3) Default print remains compact; long reports paginate without clipped rows. (4) Existing day CSV contract remains available.
- **Value:** Makes collected activity data usable for discussion/analysis; **high confidence**.
- **Effort & risk:** **M, 2–3 days**; print layout and sensitive content export; no messaging/service cost.
- **Dependencies:** FEAT-001/006; coordinate FEAT-013.

### FEAT-015 — Make account email failures diagnosable and retryable

- **Type / Serves / Pass:** Feature improvement / both, P1/P4 / Product review and Walkthrough.
- **Where:** `security_accounts.go::queueAccountMail/registerAccount/forgotPassword`; SMTP jobs; admin Email & signup; login UI.
- **Problem:** An eligible request can be acknowledged while a saturated mail semaphore drops its email; SMTP failure creates a generic audit event and no retry. A server restart loses in-flight work.
- **Evidence:** Queue acquisition has a nonblocking default that audits “email queue is busy” and returns. Jobs run in memory; failure audits no user target. Tokens expire in 30 minutes. Public generic response is deliberately enumeration-safe.
- **Proposal:** Start with bounded recent delivery status for operators: purpose, time, accepted/failed/expired and safe failure category. Keep public response generic. Add a resend/restart-registration path that does not require guessing which token is live; rate-limit by existing rules. Then introduce a small encrypted durable pending-mail queue with bounded retry/backoff and token-aware expiry—never send an expired/superseded link, and never store raw token in audit. For initial registration allow users to re-enter credentials instead of retaining them in browser storage. Do not promise inbox delivery when only SMTP accepted it.
- **Acceptance criteria:** (1) Queue-full/SMTP failure is visible to an operator with actionable category. (2) Resend does not reveal whether an account/address exists. (3) Durable retries survive restart and discard expired/superseded links. (4) No token/password/health text occurs in diagnostics. (5) Repeated retries are bounded and cannot flood recipients.
- **Value:** Fewer stalled signups and manual recovery requests; **high confidence** in failure path, medium in frequency.
- **Effort & risk:** **M, 3–5 days**, split status/resend before durable retry. Security/privacy and mail-abuse implications; extra SMTP sends and small retained metadata/storage. If reliable queue delivery exceeds estimate, stop at honest status/resend and scope it separately.
- **Dependencies:** FEAT-003/004; FEAT-011 useful but not required.

### FEAT-016 — Bring the restore runbook and rehearsal checklist into Admin

- **Type / Serves / Pass:** Admin tooling / admin, P4 / Product review and Walkthrough.
- **Where:** `web/services.js`, `web/admin.js`, `web/help.js`; backup/restore CLI and README.
- **Problem:** Backup UI delegates restore instructions to README, and uploaded/verified status cannot establish that the operator can restore after host loss.
- **Evidence:** Full restore is CLI-only; README documents stopping app, archive validation, separate credential key and rehearsal into another database. Database snapshots deliberately exclude the service key.
- **Proposal:** Add an Admin recovery guide with current-version copyable commands, separate paths for plain/encrypted archives, stopping the app, retaining the credential key and encryption password separately, and rehearsing to a disposable database. Allow operator-recorded “Last rehearsal” date/outcome, clearly marked self-reported, not app-verified. Keep whole-instance restore CLI-only; no destructive restore button. Make key-missing failure link to the guide, without exposing/downloading the key automatically.
- **Acceptance criteria:** (1) Commands match current CLI/container and work on a disposable instance in validation. (2) Encrypted and plain workflows state their prerequisites. (3) Hash verification and self-reported rehearsal are distinct. (4) Guide warns that full restore includes all users and signs everyone out, using existing privacy language.
- **Value:** More dependable recovery with less operator guesswork; **high confidence**.
- **Effort & risk:** **M, 1–2 days**; optional metadata only; no new service. Rehearsal needs temporary disk space; secrets must stay separate/private.
- **Dependencies:** FEAT-007 for status labels; guide can ship independently.

### FEAT-017 — Offer a gentle weekly review using existing History results

- **Type / Serves / Pass:** Usage & engagement / user, P2 / Product review and Competitor comparison.
- **Where:** `web/today.js`, History metrics/filter pipeline, per-user settings.
- **Problem:** The return loop is mostly “record again”; useful review is available but requires going to History and choosing a period.
- **Evidence:** Profile focus is displayed in History, but there is no weekly entry point on Today. Bearable documents weekly reports and Daylio documents regular statistics. [Source](https://bearable.app/) [Source](https://daylio.net/)
- **Proposal:** After sufficient existing records, show a small optional “Look back at your week” card at most weekly, below core capture. Include coverage and recorded episode/activity counts, linking to the exact seven-day History view. Dismiss/disable; never show guilt/streaks or a diagnosis. Prefer open-on-demand over outbound email/push. No new captured health fields.
- **Acceptance criteria:** (1) Card never blocks daily capture and can be disabled. (2) Counts match linked History with its explicit period. (3) Sparse data says limited records; no improvement claim. (4) Dismissal is remembered per user and no external notification is sent.
- **Value:** Makes accumulated records useful and may improve return visits; **medium confidence**, validate with voluntary feedback.
- **Effort & risk:** **M, 2 days**; interpretation/cognitive-load risk, no recurring messaging cost.
- **Dependencies:** FEAT-009; after sharing/recovery priorities.

### FEAT-018 — Measure a small set of task outcomes without health-content analytics

- **Type / Serves / Pass:** Usage & engagement / both, P4 and product decisions / Product review.
- **Where:** Acknowledged save/sharing/settings completion points; optional local metrics storage/admin summary.
- **Problem:** Login/document counts cannot show whether users finish setup, use History, complete exports or repeatedly hit failed saves. Priorities otherwise rely on intuition.
- **Evidence:** No product-event tracker or retention aggregation found; audit is operational/security history. Existing sessions can remain logged in for long periods.
- **Proposal:** Before tracking, define four decisions: first acknowledged record after setup, return on distinct days, successful export, and failed-save recovery. Begin with user interviews and personal coverage already in History. If shared instances want measurement, make locally stored coarse aggregates off by default with user-visible consent, bounded retention and deletion. No note/symptom/trigger/search/record-date payloads, IP or external analytics; no per-person engagement dashboard. Suppress small cohorts and make disablement stop collection. Export completion must distinguish click from generated file, and print action from confirmed print, which browsers cannot reliably prove.
- **Acceptance criteria:** (1) Disabled tracking creates no new usage data. (2) Approved events contain no entered health content or searchable person identifier. (3) Reports suppress small cohorts and expire/delete data under a documented policy. (4) Metric definitions describe what is actually measurable. (5) Diary functionality works unchanged without tracking.
- **Value:** Better future prioritisation with fewer speculative features; **medium confidence**.
- **Effort & risk:** **M, 2–4 days** if approved; privacy implications remain even for coarse activity in small groups. No third-party cost; storage/consent maintenance added.
- **Dependencies:** Agree the measurement policy before enabling; no dependency for preceding releases.

## Tier 3 — Larger bets

**None recommended now.** Eighteen worthwhile quick/incremental items remain, so the escalation rule is not met. Do not start a general health-metrics platform, wearable ingestion, clinician sharing accounts, hosted multi-tenant billing, AI interpretation or a notification platform on the strength of competitor feature lists. Revisit only after smaller changes and direct feedback establish a job they would solve. An optional symptom intensity field or personal reminder may later be reasonable, but neither has enough source/walkthrough evidence to outrank the current list.

## Top 10 by value relative to effort — shipping order and small releases

Ranking is qualitative: operational frequency and retention impact have not been measured. Preserve the current calm design. Each release should be a small independently reviewable change; audit approval is not implementation approval.

| Rank | Recommendation                                | Why now                                          | Small release                   |
| ---- | --------------------------------------------- | ------------------------------------------------ | ------------------------------- |
| 1    | FEAT-001 — Consistent private-note sharing    | Concrete disclosure mismatch, small fix          | A — Predictable sharing         |
| 2    | FEAT-002 — Activity name limits               | Immediate capture rework, tiny change            | A — Predictable sharing/capture |
| 3    | FEAT-004 — Verification/reset completion      | Clear next step at access boundary               | B — Finish setup                |
| 4    | FEAT-008 — Honest onboarding completion       | Resolves contradictory setup state               | B — Finish setup                |
| 5    | FEAT-003 — Readable audit events              | Small operator win, prerequisite for diagnostics | C — Understand recovery         |
| 6    | FEAT-007 — Last usable backup                 | Distinguishes recovery from failed attempts      | C — Understand recovery         |
| 7    | FEAT-006 — Empty sharing selection            | Prevents apparently broken exports               | D — Share the right records     |
| 8    | FEAT-009 — Coverage-aware episode comparisons | Makes existing review more trustworthy           | D — Share the right records     |
| 9    | FEAT-010 — Save Other activity as a choice    | Removes repeated daily personalisation           | E — Make capture personal       |
| 10   | FEAT-013 — Selected-day records and sharing   | Completes the calendar-to-result journey         | F — Use the day I selected      |

- **A, 1–1.5 days:** FEAT-001/002. Validate note omission in CSV/print and Unicode length boundaries.
- **B, 1–1.5 days:** FEAT-004/008. Exercise real verification/reset and first-use on phone. FEAT-005 is a useful separate auth patch, about a day, rather than a reason to enlarge B.
- **C1, about 1 day:** FEAT-003 plus FEAT-007 last-attempt/last-success display. **C2, 1–2 days:** FEAT-007 staged outcomes. Full acceptance of FEAT-007 requires C2; do not mark it complete after display only.
- **D, about 1 day:** FEAT-006/009 with zero/sparse/filtered fixtures. Review wording against actual counts rather than making health claims.
- **E, 1–2 days:** FEAT-010 with independent operation failure/retry coverage.
- **F, 2–3 days:** FEAT-013 after A/D; test keyboard, phone, return-to-range and refresh state.

Next: FEAT-014 report/activity export, FEAT-016 recovery guide, then FEAT-011/012 operator retrieval. FEAT-015 deserves earlier scheduling if users report stalled account mail; that would be stronger evidence than the current unmeasured frequency. FEAT-017/018 come after core task quality.

## Validation before implementation is considered done

Use existing Go/Node/browser checks for each changed contract; do not invent broad coverage targets. Auth changes need live verification/reset/2FA with disposable accounts. Sharing changes need actual mobile/desktop CSV and PDF/print inspection. Admin changes need ordinary-user denial, health-content privacy checks and last-admin protections. Backup changes need a failed-upload/verification/retention sequence and disposable restore rehearsal. Keep known-good sticky ranges, scroll, activity layout, drafts and offline recovery intact. No ongoing service cost should be introduced without identifying who operates it and how it fails.
