# Jiggered — UI and first-run audit

> **Historical audit, not the current specification.** This report describes
> commit `f3e34cb` on 1 Oct 2026. By 2 Oct the application includes a public
> landing page and optional verified-email registration, so its original
> first-run assumptions no longer describe the product. See [README.md](../../README.md)
> for current behavior and [CONTRIBUTING.md](../../CONTRIBUTING.md) for development.

## Disposition as of 2 Oct 2026

The original measurements below are preserved as historical evidence, not
instructions to reproduce the proposed designs. Later UI work changed Today,
History, account forms, navigation and styles. Re-check a finding against the
current view before making further changes.

| Original findings | Current disposition / evidence |
| --- | --- |
| Landing/sign-up assumptions, C3 and H10 | Superseded first-run flow: `web/landing.js`, `web/login.js`, `web/help.js`; enrollment and sign-in covered by `test/browser-accounts.cjs`. |
| C1, C2, H5, H6 | Today has since changed; current interaction behavior is covered by `test/browser-today.cjs`. Original coordinates and proposed layouts need a fresh visual review. |
| C4, H1, H7, H8, H9, H11 | Navigation and responsive styles have since changed. Current mobile/admin overflow checks live in `test/browser-mobile.cjs` and `test/browser-admin.cjs`; target sizes and theme contrast still need visual measurement. |
| C5, H12 | Episode form has since changed (`web/episodes.js`, `web/index.html`). Review current duration/onset behavior before applying the historical proposal. |
| H2, H3, H4 | History/profile behavior has since changed (`web/history.js`, `web/profile.js`). Current search/calendar checks are in `test/browser-history.cjs`; original empty-state measurements need rechecking. |
| N1 | Styles are now split across `style.css`, `dashboard.css` and `presence.css`; further consolidation needs cascade/visual validation. |
| N2–N5 | Needs confirmation against current login, Account, Today and date-format behavior. No open-work status is implied by the old recommendations. |

---

Audited at commit `f3e34cb` (1 Oct 2026). Source read: `web/*.html`, `web/*.js`, `web/style.css`. App built and run
locally on a fresh database with an admin-created account (`jiggered user add sam`), then walked with Playwright
Chromium at 375×812 (mobile, touch) and 1440×900 (desktop), with spot measurements at 320px.

## Read this first: the brief doesn't fully fit the product

Jiggered has **no landing page, no sign-up, no free trial, no pricing, no paywall and no upsell code**
(`grep` for trial/upgrade/paywall/pricing/subscri/stripe/premium finds nothing outside DB-migration wording). Accounts
are created by an admin; the first thing a new person sees is a sign-in form.

So "conversion" here means **activation and habit**: does someone who has just been handed a temporary password get
to a useful first check-in and activity log fast, and come back tomorrow? Every finding below is judged against that.
The paywall checks are reported as not applicable at the end rather than invented.

One deliberate non-recommendation: this is a personal health log for people managing limited energy. Do not port SaaS
growth patterns (streak guilt, nag modals, red badges). The one "upsell-like" surface, the shared-defaults notice, is
already respectful (dismissible, remembered per change). Keep it that way.

**What's genuinely good** (so it isn't "fixed" away): Atkinson Hyperlegible + Bricolage Grotesque is an intentional,
non-templated type pairing that suits the audience; the check-in cards are clear; the 999 warning on Episode is right;
no horizontal page overflow at 375px on any tab; reduced-motion and forced-colours are handled.

---

## 1. Critical — blocks activation or breaks the experience

### C1. The core action is two screens down on Today
- **Pass:** Designer / First-time user
- **Where:** `web/index.html` `#today-panel` (panel order), `web/style.css`; mobile 375px and 320px
- **Problem:** The thing you do most — tap an activity — starts at **y≈1430px** at 375px for a returning user (≈1490px
  at 320px), i.e. below roughly two full screens. Above it sit: a full-card day navigator, the check-in card with two
  lines of hint copy, the gauge card with its own hint, the sleep switch and a "How points work" disclosure. On a
  first visit the onboarding card pushes it down further. A tired person logging "nap" should not have to scroll past
  four cards every time.
- **Fix:**
  1. Delete the standalone `.panel.daynav`. Move ‹ / date / › into the gauge header row as a compact control
     (`.gauge-head` → three columns: `‹ Today ›` on the left, points on the right). Keep `#day-pick` but render it as
     a visually hidden input behind the date label button.
  2. Merge `#checkin` and the sleep switch into one "Start of day" panel; drop the `.hint` paragraph under the check-in
     (the card labels already say it) and move "How points work" into the existing `?` tooltip.
  3. After the person has checked in today, collapse the check-in to a single summary row
     (`● Amber · −3 points  Change`) so the activity panel rises above the fold.
  4. Target: first activity button above `y=812` at 375px once checked in.

### C2. A brand-new user sees zero activity buttons
- **Pass:** First-time user
- **Where:** `web/today.js` `renderActivities()` (`opened` starts empty, groups render as closed `<details>`);
  `web/picker.js` `PICKER.searchFrom = 8`; default list is 24 items in `web/model.js` `DEFAULTS.activities`
- **Problem:** The default list (24) exceeds `searchFrom` (8), so Today renders a search box, a row of group pills and
  four **collapsed** groups — *Work / Home / Out and about / Recovery* — and not a single tappable activity. The
  heading says "Tap what you've done" and there is nothing to tap. My scripted first run timed out on exactly this:
  the first `.act` button exists but is not visible. Favourites can't help because a new account has no usage.
  It also offers two controls for the same thing: pills filter by group *and* each group is a collapsible header.
- **Fix:**
  1. Pick one grouping control. Keep the pills; render groups as plain `<h3 class="label">` section headings, always
     expanded, with the existing per-group "Show N more" paging (`PICKER.page = 12`) doing the length control.
  2. When `usage()` returns nothing (new account), render a "Common to start" row of the first 6 defaults in place of
     "Frequent and recent", so the first screen always has buttons.
  3. If you keep `<details>`, persist `opened` in the settings doc (`settings.ui.openGroups`) and default every group
     to open.

### C3. Onboarding shows once, on one device, then sends you away from the task
- **Pass:** First-time user
- **Where:** `web/app.js` lines ~126–127 and 317; `web/index.html` `#onboarding`
- **Problem:** `#onboarding` is un-hidden only on the single page load that creates the `settings` doc. That same load
  dispatches the doc, so on any reload or any other device it never appears again, whether or not it was dismissed (the
  `jiggered:onboarding:*` "dismissed" key is effectively dead). In the walkthrough it showed on the phone and never on
  desktop. Its only button, "Personalise my activities", navigates a person who hasn't logged anything yet off Today
  into a 4,200px Account page. Nothing explains the first two actions that actually create value: check in, log one
  activity.
- **Fix:** Replace the card with an inline first-run checklist on Today, state stored in the synced settings doc so it
  follows the person across devices:
  ```js
  settings.onboarding = { checkedIn: false, loggedActivity: false, tunedBudget: false, dismissed: false }
  ```
  Render three rows with ticks: "Pick green, amber or red" (ticks on first `setStatus`), "Tap one thing you've done"
  (first `addEntry`), "Optional: set your daily points" (inline number input bound to `budget`, saved via
  `settingsPatch` — no navigation). Hide when all three are done or dismissed. Patch `onboarding` with the existing
  `settingsPatch` op so it merges like the profile does.

### C4. The tab bar clips on small phones, and admins get a sixth tab
- **Pass:** Designer
- **Where:** `web/index.html` `#tabs`; `web/style.css` `nav{overflow-x:auto;scrollbar-width:none}`; `web/app.js`
  `syncAdmin`; 320px and 375px
- **Problem:** Five tabs measure 328px of content. At 320px the bar scrolls and **Help is cut off** (right edge at
  352px) with the scrollbar hidden, so nothing says there is more. At 375px it fits with 1px to spare. Every admin
  gets a sixth tab, which guarantees hidden navigation on every phone. Help is also duplicated by the header Help
  button, so a whole tab slot is spent on a duplicate.
- **Fix:** Remove the Help *tab* (keep the header Help button, which already calls `views.help.open`; render the help
  panel as a full-screen sheet). That leaves Today / Episode / History / Account (+ Admin). Below 480px, move the nav to
  a fixed bottom bar (`position:fixed;bottom:0;padding-bottom:env(safe-area-inset-bottom)`) with equal-width items,
  and put Admin inside Account as a section for admins rather than a tab. Never ship a horizontally scrolling nav with
  the scrollbar hidden.

### C5. Every episode defaults to "Still going"
- **Pass:** First-time user
- **Where:** `web/episodes.js` lines 65–67, 77 (`DURATIONS[0]`); `web/model.js` `DURATIONS`
- **Problem:** The duration `<select>` defaults to "Still going". Someone recording yesterday's dizzy spell who
  doesn't touch that field saves an **ongoing** episode, which then pins a "Still going (1)" card on Today and Episode
  until they find "Record when it ended". The app records something the person never chose, in a health log they may
  hand to a GP.
- **Fix:** Add a blank first option (`<option value="" disabled selected>Choose how long it lasted</option>`), make
  `#ep-dur` `required`, and validate in `body()`/submit with the message "Choose how long it lasted, or Still going."
  Only preselect "Still going" when `#ep-when` is within the last 30 minutes.

---

## 2. High impact — significant friction or lost trust

### H1. Desktop is a phone column, and the tab bar changes width between tabs
- **Pass:** Designer
- **Where:** `web/style.css` `.wrap{max-width:560px}`, `body[data-view="history"] .wrap{max-width:1120px}`,
  `body[data-view="account"] .wrap{max-width:760px}`; 1440px
- **Problem:** Today and Episode use 528px of a 1440px screen (63% empty). Worse, because the width is set per view,
  the header and tab bar **jump** between 560, 1120 and 760px when you switch tabs — the nav moves under your cursor.
- **Fix:** Fix the chrome (header + tabs) at one width (`max-width:1120px`) for every view; vary only the content.
  On Today at `min-width:960px`, use `grid-template-columns:minmax(320px,400px) 1fr`: left column = check-in + gauge
  (`position:sticky;top:72px`), right column = activities + "So far". Episode at ≥960px: form left, a live "this
  episode" summary right with the Save button.

### H2. History is a 5,600px wall of empty charts for a new user
- **Pass:** First-time user
- **Where:** `web/history.js`, `web/history-charts.js`, `web/history-matrix.js`; mobile 375px
- **Problem:** With one day logged, mobile History is 5,625px tall: four metric tiles of zeros, a calendar of dashes,
  two empty charts each with its own "Inspect a day" box, a "Patterns need…" placeholder, a 14-day grey strip, then
  records, then sharing. It tells a new person "you haven't done enough" eight different ways.
- **Fix:** In `history.js` `render()`, compute `const thin = days.filter(d => d.status).length < 3 && episodes.length === 0`.
  When `thin`, hide `#trends-panel`, `#history-matrix`, `#history-graphs`, `#history-patterns` and the filter panel,
  and show one panel: "Patterns appear after 3 check-ins — you have N." with a 3-segment progress bar, followed by
  Days, Episodes and Share. Remove the thin mode as soon as the threshold is met.

### H3. History leads with a filter form, not your history
- **Pass:** Designer
- **Where:** `web/index.html` `.history-filter-panel`; mobile
- **Problem:** Two date fields, a search, two selects and a checkbox (~600px at 375px) sit above any result. The range
  presets right above already cover the common case.
- **Fix:** Wrap `#history-filters` in `<details class="panel">` with `<summary>Filter</summary>`, closed by default.
  When any filter is active, show the summary as removable chips (`Amber ×`, `"walk" ×`) and keep it open.

### H4. "What I'd like to notice" is collected and then ignored
- **Pass:** First-time user
- **Where:** `web/index.html` `#profile-focus`; `web/profile.js` (only `profileIdentity` reads `focus`)
- **Problem:** The profile asks a reflective question — what do you want to notice? — and the answer is only echoed
  back in the Account hero. History, the one place built for noticing, never shows it. Asking and then ignoring it
  teaches people the app doesn't listen.
- **Fix:** Render it as the History intro line (replace the static "Explore what you've recorded…" in
  `.history-intro .meta` with `“${focus}”` and an "Edit" link when set), and print it at the top of the doctor summary
  under a "What I'm tracking" heading (opt-in checkbox next to "Include private episode notes"). If you won't use it,
  delete the field.

### H5. Tapping the selected check-in silently erases it
- **Pass:** First-time user
- **Where:** `web/today.js` `$("checkin")` click handler
- **Problem:** A second tap on the selected colour clears the day's check-in and restores the budget, with no
  confirmation and no Undo. Thumb slips on a phone are common; the hint text that warns about this is the kind people
  don't read. Activity removal already has a proper Undo toast — check-ins don't.
- **Fix:** When the click clears a status, call
  `ctx.toast("Check-in cleared.", { label: "Undo", fn: () => op("setStatus", previous) })`. Do the same when switching
  colours ("Changed to Red. Undo").

### H6. Logging an activity moves the button out from under your finger, and duplicates "So far"
- **Pass:** Designer
- **Where:** `web/today.js` `renderActivities()` (`pinned` "Logged today" block, `unpicked` filter)
- **Problem:** A tapped activity disappears from its group and reappears in a new "Logged today" block inserted
  **above** the list, shifting everything below it down by a card's height. The next tap lands on the wrong item.
  The same information is then listed again in "So far" at the bottom.
- **Fix:** Keep each activity in its place and switch it to the logged state in place (the existing `.act.on` stepper
  with ×count). Drop the separate pinned block; "So far" remains the chronological record. If you want quick access
  to logged items, put them in "Frequent and recent", which is already above the groups and doesn't reflow on tap.

### H7. Many tap targets are under 44px
- **Pass:** Designer
- **Where:** `web/style.css` `.x`, `.daynav .ghost`, `.help-tip`; measured at 375px on Today
- **Problem:** Measured heights: "Edit" / "Remove" in So far **21px**, "Edit activities" / "Edit my budget" 21px, day
  arrows 33×38px, `?` tips 32×32px, group pills 40px. "Remove" sits right next to "Edit" at 21px tall.
- **Fix:** `.x{min-height:44px;padding:10px 8px;display:inline-flex;align-items:center}`;
  `.daynav .ghost{min-width:44px;min-height:44px}`; `.help-tip{width:44px;height:44px}` (keep the 32px visual circle
  via an inner span); `.pill{min-height:44px}`. In the So far list, put Edit and Remove behind one row tap that opens
  the existing edit form, with Remove inside it.

### H8. A 39px dead band sits between the header and the tabs on every screen
- **Pass:** Designer
- **Where:** `web/index.html` `#sync`; `web/style.css` `.sync{min-height:1.5em;margin:.5rem 0}` and
  `[data-state="saved"]{opacity:0}`; mobile header wrap
- **Problem:** The sync line reserves its height even when empty (to avoid layout shift — a good goal), leaving a
  measured 39px blank strip above the tabs. On mobile the header also wraps to two rows ("sam / Help / Sign out"),
  so the first ~170px of every screen is chrome.
- **Fix:** Move the status into the header as a fixed-size indicator: a 10px dot plus short text in a
  `position:absolute` element at the header's right, so it never affects layout. Remove `#sync` from the flow.
  Collapse the header to one row: logo + "Jiggered" left, avatar initials button right (opening a menu with display
  name, Help, Sign out). Drop the date under the title on mobile; Today already says "Today".

### H9. Sign out is a one-tap neighbour of Help
- **Pass:** Designer
- **Where:** `web/index.html` `#signout` header form
- **Problem:** "Help" and "Sign out" are identical ghost buttons side by side. Signing out wipes this device's copy
  (`ctx.leave()` clears store and drafts); a confirm only appears if there are unsent changes. Signing in again on a
  phone is a real cost for this audience.
- **Fix:** Covered by H8's avatar menu. If you keep the buttons, move Sign out to the bottom of Account, above the
  danger zone.

### H10. The forced password screen has a dead Help button and no welcome
- **Pass:** First-time user
- **Where:** `web/app.js` boot (`if (me.must_change_password) { … return }` runs before the document click handler
  that handles `[data-help]`)
- **Problem:** The very first screen a new user sees shows a header "Help" button that does nothing, and the only copy
  is a warning-coloured banner about the temporary password. There is no sentence about what Jiggered is or what
  happens next.
- **Fix:** In that branch, hide `[data-help]` in the header (or open the help sheet in a minimal mode). Change the
  banner from amber warning styling to the neutral `.setup` style and add one line:
  "Welcome to Jiggered. Choose your own password, then you'll do a 10-second morning check-in."

### H11. Hard-coded colours bypass the theme tokens and break dark mode
- **Pass:** Designer
- **Where:** `web/style.css` — `.recovery{border:2px solid #a73131}`, `[aria-invalid=true]{outline:…#a73131}`,
  `.recovery-item` and `#summary-preview` borders `#d5ddd8`, `.order-row` fallback `#d5ddd8`, `.drag-preview`
  shadow `#163d3b40`, `.strip button{color:#142a22}`
- **Problem:** These are light-theme values pasted into later CSS blocks. In dark mode the recovery panel and summary
  preview get light-grey borders on a near-black surface and the error red doesn't match `--red`. The recovery panel
  is exactly where trust matters most.
- **Fix:** Replace with tokens: `#a73131` → `var(--red)`, `#d5ddd8` → `var(--line)`, `#142a22` → `var(--fg)`
  (and check contrast on amber), drag shadow → `color-mix(in srgb,var(--fg) 25%,transparent)`. Add a CI grep that
  fails on hex colours outside the `:root` token blocks.

### H12. The Episode form opens with engineering copy and ends 2,600px later
- **Pass:** Designer / First-time user
- **Where:** `web/index.html` `#epform`, `#episode-panel`; mobile
- **Problem:** The first sentence under "Log an episode" is about time-zone offsets on older records — irrelevant to
  someone who just had symptoms. "Edit symptoms and triggers" sits *above* the heading. Field labels switch between
  two styles (`.label` small caps for "When it started" / "How long it lasted", bold `<legend>` for "What you noticed"
  / "How it came on"). Save is at the bottom of a 2,600px page.
- **Fix:** Move the time-zone note into the episodes Help topic. Put "Edit symptoms and triggers" as a small link in
  the heading row, right-aligned, replacing the separate Help link (one link, not two). Use `<legend>`-style bold
  sentence case for every field. On mobile, make the Save row sticky:
  `#epform .save-bar{position:sticky;bottom:0;background:var(--surface);padding-block:12px;border-top:1px solid var(--line)}`.

---

## 3. Nice to have — polish

### N1. The stylesheet is a stack of patches
- **Pass:** Designer
- **Where:** `web/style.css`
- **Problem:** `.sync` is defined four times with conflicting `margin`/`text-align`; `.advice` three times;
  `.checkin button` padding three times; `.strip` grid twice (14 columns, then 7); `.row` gap twice; section comments
  like "Self-hosted additions" mark layers. Units mix px and rem. This is how inconsistent spacing creeps in.
- **Fix:** One pass to fold each selector to a single rule in source order, adopt a spacing scale
  (`--s1:4px … --s6:24px`) and use it everywhere. No visual change intended; verify with the existing
  `browser-*.cjs` tests plus before/after screenshots.

### N2. Login help floats away from the form
- **Pass:** Designer
- **Where:** `web/login.html` `.login`; `web/style.css` `.login{min-height:100vh;display:grid;place-items:center}`
- **Problem:** Two grid rows share 100vh, so "Need an account or forgot your password?" sits ~130px below the form at
  375px, reading as unrelated.
- **Fix:** `.login{align-content:center;gap:12px}` so both cards centre together.

### N3. Account is ordered by implementation, not use
- **Pass:** Designer
- **Where:** `web/index.html` `#account-panel`
- **Problem:** Change password is the second panel; Energy & personal lists (the thing people come to adjust) is
  fourth, 1,900px down. The settings form ends with four full-width stacked buttons at mobile, and "Discard draft" looks
  enabled with no draft.
- **Fix:** Order: Energy & lists, Profile, Your data, Devices, Password, Privacy, Delete. Disable `#set-discard` when
  `!dirty` (as `#profile-discard` already does). Put "Add new shared items" / "Replace with shared defaults" in an
  overflow `<details>` "Shared defaults" under the lists.

### N4. One logged activity renders as a half-width card
- **Pass:** Designer
- **Where:** `web/today.js` `selectedCard`, `.acts` 2-column grid
- **Problem:** A single logged card leaves an empty half-row. Moot if H6 is done.
- **Fix:** If the pinned block stays, `.act-picked .acts{grid-template-columns:repeat(auto-fill,minmax(160px,1fr))}`.

### N5. The date picker ignores the date-format setting
- **Pass:** Designer
- **Where:** `#day-pick` (`<input type="date">`)
- **Problem:** The header says "Thursday 1 October 2026" from the person's locale setting; the native date field
  beside it follows the browser locale (showed `10/01/2026` in an en-US browser). Two date formats on one card.
- **Fix:** Show a button labelled with `fmtLongDay(key, S.locale)` that calls `#day-pick.showPicker()`; keep the input
  visually hidden.

---

## Specifically requested checks

| Check | Result |
| --- | --- |
| Upgrade/paywall modal before value | **Not applicable.** No paywall, plan or upgrade code exists. |
| Multiple simultaneous upsells / nagware | **Not applicable.** The only promotional surface is the shared-defaults notice, which is dismissible and remembered per change. Don't add more. |
| Broken or cramped mobile layouts | No horizontal page overflow at 375px on any tab. Problems are vertical length (C1, H2, H12), tab bar clipping at ≤360px (C4) and small tap targets (H7). |
| Onboarding answers collected but never used | No onboarding questions as such; the profile "What I'd like to notice" field is the equivalent and is unused (H4). The onboarding card itself is effectively single-shot (C3). |
| Value before being asked to pay | Not applicable; but value before friction is the issue: a new user meets a forced password change, then a Today screen with no tappable activities (C2). |
