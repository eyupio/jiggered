# UI audit, October 2026: landing to first value, and every page

> **This file holds two audits.** **Part 1** (this audit, finding IDs `A-C1`, `A-H1`, `A-N1`…) covers the whole product from a stranger's first visit to the last admin screen, including the Tools tab and the timeline tooling. **Part 2** (from "UI audit: Today, Plan, History and the visual planning calendar" onward) is the earlier, narrower audit with its own IDs (`C1`–`C5`, `H1`–`H9`, `N1`–`N6`), kept exactly as it was. Where Part 1 found statements in Part 2 that no longer match the code, they are listed in [Appendix B](#appendix-b-statements-in-part-2-that-no-longer-match-the-code) and not edited in place.
>
> Source revision `6ee614a`. The findings describe that revision; [Appendix F](#appendix-f-what-the-fix-batches-changed) records, finding by finding, what the fix batches in #88 and #89 changed and what is still open. Part 1 has **96 findings: 4 Critical, 49 High impact, 43 Nice to have**, each with Pass, Where, Problem and Fix (Critical and High add an Evidence line; Nice-to-have items fold their measurements into Problem). All 96 are listed in one table in [Appendix E](#appendix-e-every-finding-at-a-glance).

## How this was done, and what to discount

- **Real server, real browser.** The server was built from `6ee614a` and run on a disposable database with a local SMTP sink, so registration, verification, password reset and recovery mail were real. Chromium (Playwright) at **1440×900** and **375×812** (touch and mobile emulation), with 320, 360 and 768 spot-checks where a layout looked tight. Accounts were created through the real CLI, registration and admin screens: brand-new, seeded (45 days of history with gaps, six future plans, eight episodes, one still going), and admin.
- **Lead plus six parallel auditors.** A lead audited the landing page, sign-up funnel, first run and cross-cutting design. Six auditors each took a slice: public pages, errors and email; Today; Plan and the timeline tooling; Tools and Fretboard; Episode and History with every export path; Account, Help, Admin, first sign-in, error states and the operator CLI. Between them they exercised real mouse, real keyboard and real touch events (CDP), offline and hung connections, forced 500s, dark mode, reduced motion and print.
- **Evidence standard.** Every finding says how it was established (measured, reproduced, or code-read). Each of the four Criticals was reproduced twice: by two auditors, or by one auditor and then by me. For the Highs I re-ran the claims most likely to be doubted (the colour bug, future-dated logging, the Episode errors, the offline hang, a card covering the Undo toast, the dead Fretboard button, the 320px tab overflow) and checked the cited source lines for the rest; those remaining measurements are single-auditor results. Where a detail did not reproduce in my run it is worded as position-dependent (for example, the Episode error field landing behind the tab bar). Line numbers are for `6ee614a`.
- **Earlier reviews.** `docs/audits/UI_AUDIT.md` is an archived review of commit `f3e34cb` (1 Oct 2026) that predates the landing page and registration; it was not edited. Five of its themes are still open in the current code and appear here under new IDs: the core action below the fold on Today (A-C1), the tab bar clipping on small phones (A-N43, A-H40), "Still going" pre-selected on every episode (A-H30), the forced-password first screen (A-H16, with different defects now) and Account ordered by implementation (A-H49). Part 2 below is a separate review of Today, Plan and History.
- **Not done:** real iOS and Android devices (long-press menus, on-screen keyboards, Safari), screen-reader speech (ARIA was read from the DOM, not heard), Firefox and Safari, real inboxes (mail was rendered in Chromium), the external Spoon Theory essay link (unreachable from the sandbox), and the user-side consent UI when usage measurement is enabled. Screenshots and test scripts were kept outside the repository.

### The brief's "free trial" framing does not apply

There is **no paywall, trial, upgrade modal, billing or upsell anywhere in this product.** The landing says "Free to use", `web/public/pricing.html` says "There is no paid plan offered in this app.", the structured data says `price: 0`, the source is MIT, and a grep of `web/` and all non-test Go files for `paywall|trial|upgrade|upsell|premium|subscribe|stripe|billing|checkout` finds only database-schema "upgrade" comments. So I did not invent conversion problems. I substituted the nearest honest equivalents:

| Brief says | Audited as |
| --- | --- |
| Start a free trial | **Activation:** visitor → registered → verified → first check-in → first logged activity → comes back tomorrow |
| Paywall before value | N/A. Checked instead: does the first screen show value before it asks for effort? |
| Stacked upsells / nagware | Competing prompts on one screen: checklists, banners, notices, repeated instructions, toasts, dialogs |
| Onboarding answers unused | Settings the user gave that something ignores, and questions the product should ask and does not |

### The brief's four specific checks

1. **Upgrade or paywall modals before value:** none exist. The only things that interrupt are the hide-able first-run checklist, an admin-triggered shared-defaults notice (A-N14), an opt-in weekly review, 8-second toasts, one remove dialog, and 17 native `confirm()`/`prompt()` calls on destructive actions (A-N39). There is no consent modal; usage measurement is an off-by-default checkbox inside Account.
2. **Several simultaneous upsell touchpoints:** none. The nearest things to nagware are a "Still going" episode banner that never expires (A-H31), the read-only-tab notice that appears twice (A-H47), and the 426px shared-defaults panel on a phone (A-N14).
3. **Broken or cramped mobile layouts:** yes, and they are the largest class of findings: the first-run Today (A-C1), the register page (A-H2), landing label and CTA wraps (A-H9), both timelines (A-H23), History cells at 90+ days (A-H34), the Fretboard board (A-H37), the list editor (A-H48), messages hidden under the tab bar (A-H43), and the tab bar itself at 320px (A-N43).
4. **Onboarding answers collected but never used:** the first-run checklist collects exactly one answer, the daily allowance, and it is used everywhere (typing 7 gives Today "7 of 7", an Amber cap of 4, Plan's Today allowance, and Account's budget field). The real gaps run the other way: a question the product should ask and does not (points or spoons, A-H13), an answer silently dropped (Plan's per-day allowance on an empty day, A-C3), settings that planning ignores (Amber, Red and poor sleep on future days, A-H28), and Account fields whose copy promises more than the product does (A-N38).

### The funnel in numbers

| Measure | Phone 375×812 | Desktop 1440×900 |
| --- | --- | --- |
| Landing hero CTA (bottom edge vs fold) | 613px vs 812 | 709px vs 900 |
| Landing page height | 7,342px | 4,628px |
| Taps from the landing CTA to first-run Today | **11**, plus a mail-app round trip | same |
| `/register` submit button (y) | 1,112–1,162 | 821–871 |
| First-run Today page height | **6,478px** | 3,829px |
| Check-in buttons (y) | **866–1,001** (below the fold) | 798–933 (cut by the fold) |
| First activity tile (y) | **≈4,034** (4.9 screens down) | ≈2,009 |
| Distance from the energy ring to the first tile | **≈2,900px** | ring stays in view |
| Console errors across the whole funnel | 0 | 0 |
| Horizontal overflow on landing, auth, app | none | none |
| Contrast of sampled public text / app dark mode | ≥5.5:1 / ≥6.9:1 | same |

## What already works (keep it)

- The hero CTA is above the fold at both widths, white on green at 7.75:1. Landing, sign-in and the first-run app produce **no console errors and no horizontal overflow** at 375 and 1440. Public pages make nine same-origin requests each and no third-party request anywhere (74 distinct paths across landing, auth and all six tabs) and set no cookies; the eight article pages ship no script. The "no third-party trackers or external fonts" claim is true.
- The check-in buttons state their consequence ("Full points / −3 points / −6 points") and the choice really sets the day's allowance. The onboarding allowance is applied everywhere. Zero now reads `0`, not `−0`.
- Keyboard focus rings are visible on every stop tested (3px solid), the skip link works, the tab bar has roving tabindex, and the timeline's keyboard model (arrows, Shift+arrows, Enter, Delete, Escape, ContextMenu key) is complete with live announcements and Undo.
- Offline works when the failure is instant: airplane-mode reload opens the app in 316–445ms with an honest pill, check-ins queue and sync, and sign-out purges the device copy. Drafts survive tab changes and reloads with an explicit message.
- Restore is careful (preview counts, a pre-restore backup, a red danger button for replace mode); two-step enrolment, recovery codes, device revocation and the last-admin guard are complete; the operator CLI is consistent with sane exit codes and `--yes` guards.
- Copy is mostly calm and blame-free ("That isn't your current password."), insight text is careful about causation ("this doesn't establish a cause"), the emergency-number block is well placed and contrast 10.18:1, and the registration email is multipart with the token in the URL fragment so link scanners cannot consume it.
- Fretboard's desktop design, voice, canvas keyboard shortcuts, Undo, escaping and server bounds are finished work; text is escaped and a read-only tab never writes.

## Fix these first

| # | ID | Why |
| --- | --- | --- |
| 1 | [A-C1](#a-c1-first-run-today-buries-the-check-in-and-logging-something-shows-no-result-on-the-screen-where-you-tapped-phone) | The activation moment is three screens away from its cause on a phone |
| 2 | [A-C2](#a-c2-registration-silently-does-nothing-when-the-username-or-email-is-already-taken-and-every-recovery-path-loops-back-into-it) | A taken name looks like a mail outage, and nothing recovers |
| 3 | [A-C3](#a-c3-starting-points-for-this-day-is-discarded-on-any-day-with-nothing-planned-and-files-a-false-conflict-in-recovery) | The first control on Plan's Add card raises a permanent error pill |
| 4 | [A-C4](#a-c4-the-empty-fretboards-start-with-an-example-button-does-nothing-when-clicked-with-a-mouse-and-enter-on-it-adds-a-blank-card) | A dead primary button on a new feature's first screen (one-line fix) |
| 5 | A-H1 | Your request: a coloured timeline block must change its fill, not only its border |
| 6 | A-H3 | Eleven taps and a "Welcome back" for someone who has never been |
| 7 | A-H17 | "Log it now" and drops into the future record unfinished activities as done |
| 8 | A-H18 | One activity shows "−2" everywhere except the field you type into |
| 9 | A-H35, A-H36 | Fretboard loses another device's change, and a card can cover its own Undo |
| 10 | A-H47 | A second tab looks live and silently ignores everything you do |

## 1. Critical

Four findings block activation or break a first-use screen. Each was reproduced in a browser, not only read from code.

### A-C1. First-run Today buries the check-in, and logging something shows no result on the screen where you tapped (phone)

- **Pass:** First-time user + Designer
- **Where:** `web/index.html:81-94` (masthead), `:172-209` (checklist), `:216-255` (check-in), `:257-345` (ring panel), `:347-366` (timeline panel, `open` by default), `:367-447` (activity tiles); `web/dashboard.css:784-859` (≤600px rules); `web/today.js:217-223` (`logOne`, which dispatches and does nothing else), `:460-465` (second picker); `/#today`, 375×812 (milder at 1440×900).
- **Evidence:** measured on brand-new accounts at 375×812: check-in buttons y=866–1001 (the first screen ends at 812, and the floating tab bar covers 740–802); ring panel y=1106–2207; timeline panel y=2229–3578; first activity tile y≈4,034 (3,965 after checking in), 4.9 screens down; page height 6,478px. Tapping a tile turns that tile green and moves the ring 10→8 about 2,900px above the finger; there is no toast on add. A second picker (24 dashed chips, 661px tall at 375) sits before the tiles, and tapping a chip opens "Choose a time on the timeline… Log it now / Cancel" instead of logging. At 1440×900: check-in buttons y=798–933 (cut by the fold), first tile y≈2,009.
- **Problem:** the product's whole pitch is "tap what you did, watch your budget move". On a phone those two things are three screens apart, so cause and effect never share a screen. The first screen is brand copy (eyebrow, 2-line H1, 2-line description: 228px) plus a 357px checklist whose step 2 says "Tap one thing you've done so far" while the nearest thing to tap is 2,400–3,900px away. The new user taps, sees one rectangle change colour, and scrolls up to find out whether anything happened. The activation moment is invisible.
- **Fix:** (1) ≤600px: hide `.dashboard-eyebrow` and `#view-description`, `.dashboard-masthead{padding:14px 0 10px}`, h1 28px (saves ≈130px) so the check-in header is on the first screen. (2) Sticky balance pill: where `render()` writes `$("left")` (`today.js:861`) also write `#balance-pill` ("8 of 10 left"); `.balance-pill{position:sticky;top:8px;z-index:5}` inside `#today-panel`, ≤700px only. (3) `logOne` → `ctx.toast(`${x.a} logged · ${left} of ${cap} left`,{label:"Undo",fn:()=>removeEntry(entry)})`; the toast bar already sits above the tab bar (`dashboard.css:850`). (4) Keep `<details id="today-timeline-panel">` closed until there is something to draw (drop `open` at `index.html:349`; open it when `d.entries.length || pending.length`), so the tiles follow the check-in. (5) Make the palette one row of `favourites()` (≤8 chips, 44px tall, `picker.js:46`) plus "All activities…", or delete it and keep the existing tile drag (`today.js:437-444`). Target: first tile within 1,500px, and the number visible whenever a tile is tapped.

### A-C2. Registration silently does nothing when the username or email is already taken, and every recovery path loops back into it

- **Pass:** First-time user
- **Where:** `security_accounts.go:62-64` (`genericEmailResponse`), `:110-138` (duplicate check `:110`; `recoveryLimit.take("register:"+email)` `:116`; earlier pending token deleted `:131`), `:194-243` (`verifyEmailToken` creates the account only at click time: `INSERT INTO users` `:232`, "This account cannot be created" `:234,:243`); `web/login.js:151-160` ("Request a new link" opens a blank register form), `:163-167` (advice to "submit this form again"), `:180` (clears both password fields on success); `/register`, all viewports.
- **Evidence:** measured twice, independently. `POST /api/auth/register` with the existing username `admin` and a fresh address returns HTTP 200 `{"message":"If this request is eligible, an email will arrive shortly…"}` and **no mail arrives** (sink unchanged after 3s; a second run saw none in 9s). A weak password on the same endpoint returns a specific 400. In the browser the button becomes "Send another link" with both passwords already wiped, so pressing it shows "Please fill out this field." and sends nothing. A dead verify link shows a red error, keeps the dark "Verify email address" button, and "Request a new link" opens an empty register form. The 4th request for one address in 15 minutes is swallowed the same way (`:116`).
- **Problem:** usernames are the public handles people sign in with; their existence is not the secret, the email address is. The server hides both behind one cheerful success, so three ordinary situations end identically: the name is taken (the earliest sign-ups take every good name), the person forgot they already registered, or it is their 4th try. They check spam, wait, and leave. The advertised remedy cannot work (the passwords were wiped), and the worst loop is someone who already verified: old email → "expired or already used" → "Request a new link" → re-register the name they own → silent case. A collision that slips through surfaces only after the email round trip.
- **Fix:** (1) Check `users.username` (and unexpired `register` tokens for that name) separately and answer `409 {"error":"That username is taken. Try another."}`; `login.js` already prints `value.error`; focus `#register-name`. If usernames must stay unguessable, make the email the login name instead; the current middle path fails the visitor either way. (2) Keep the email-exists branch generic on the page, but mail that address "You already have a Jiggered account" with Sign in and Reset links (only the mailbox owner learns anything). (3) Limiter branch: `429 {"error":"Too many links requested for this address. Try again in 15 minutes."}`. (4) `login.js:180`: keep the typed values in memory and replace the form with a confirmation panel ("We sent a link to a•••@example.com", "Resend" after 60s, "Use a different address"). (5) `login.js:151-160`: on a dead link make "Sign in" the primary button, "Create an account again" secondary, and hide the dead "Verify email address". Add cases to `account_test.go`.

### A-C3. "Starting points for this day" is discarded on any day with nothing planned, and files a false conflict in Recovery

- **Pass:** First-time user
- **Where:** `web/planner.js:393-407` (the change handler passes `before: {date: undefined, allowance: undefined}` when the day has no plan document), `web/model.js:383-385` (`operationConflicts`: a non-null `before` plus a missing server body returns `["deleted record"]`), `web/sync.js:425-436`, `web/index.html:605-616`; `/#plan`, all viewports, every day on a new account including today.
- **Evidence:** measured by two auditors and re-run by me on a brand-new account: type `6` into the field and Tab away → the field snaps back to `10`, no request is made for the plan day (the only PUT is the unrelated `settings`), and the header pill reads "1 refused change needs recovery below." on Plan, Today and History. The Recovery panel then lists `p-2026-10-05 · Changed elsewhere: deleted record`. The same field on a day that already has an activity saves normally; the repo test only sets the allowance after plan rows exist (`test/browser-planner.cjs:237-243`). Out-of-range entries (0, 31, 6.5) also snap back with no message.
- **Problem:** the allowance is the first control on the Add card and the only way to say "today is a low day" before planning. For a new person it silently does nothing, then raises a permanent error pill that points "below" (the recovery panel lives in Account, not on Plan) and describes a conflict that never happened. A normal first action produces a data-error state on a health log.
- **Fix:** in `planner.js:400-406` pass `before` only when the document exists: `f.plan.date ? {date: f.plan.date, allowance: f.plan.allowance} : undefined`. In `model.js:383-385` return `[]` when every `before` value is `undefined` (creating a document cannot conflict with a deletion). Under the field show "Use a whole number from 1 to 30." instead of resetting silently. Add to `test/browser-planner.cjs`: empty day, type 6, expect a PUT of `p-<date>` with `allowance: 6` and no "refused" pill.

### A-C4. The empty Fretboard's "Start with an example" button does nothing when clicked with a mouse, and Enter on it adds a blank card

- **Pass:** Designer + First-time user
- **Where:** `web/fretboard.js:108-114` (the empty state lives inside `#fb-canvas`), `:774-836` (canvas `pointerdown`; `setPointerCapture` at `:823`), `:962-999` (canvas `keydown`; Enter on a non-card adds a card at `:993-998`); `/#tools` → Fretboard, empty board, any mouse.
- **Evidence:** measured by the Tools auditor and re-run by me on a new account: `mouse.click` on the button leaves 0 items; the event log of one click is `pointerdown:secondary`, `gotpointercapture:fb-canvas`, `pointerup:fb-canvas`, `click:fb-canvas`, so the click never reaches the button. Enter on the focused button gives 1 blank card in edit mode; Space loads the 7-card example; a phone tap works. `test/browser-tools.cjs` never clicks this button.
- **Problem:** the one guided way to see what the board is for is a dead primary button for every mouse user, on the tool's first screen. A stranger who clicks it and sees nothing concludes the tool is broken. Workarounds exist (double-click, "+ Card", right-click → "Start with an example"), so it is not a blocker for the product, but it is a broken first impression of a new feature.
- **Fix:** in the canvas `pointerdown` handler, right after `closeMenu();` (`fretboard.js:775`), add `if (e.target.closest("button, input, textarea")) return;`; add the same line in the canvas `keydown` handler after `if (editing) return;` (`:963`). Verified by patching the served file: mouse click → 7 items and Enter → 7 items. Add to `test/browser-tools.cjs`: on a fresh account `await page.locator('[data-fb="example"]').click(); assert.equal(await page.locator(".fb-item").count(), 7);`.

## 2. High impact

Findings are grouped by journey (landing and sign-up, then Today, Plan, Episode and History, Tools, Account), not ranked across groups. A-H1 is first because it was requested explicitly.

### A-H1. Choosing a colour for a logged timeline block changes only its border; the fill never changes (requested)

- **Pass:** Designer + First-time user
- **Where:** `web/dashboard.css:1937-1941` (`.cal-block.cal-tone` sets `border-color` and `background`, specificity 0,2,0) is out-ranked by `web/dashboard.css:1973-1978` (`.cal-block.cal-logged.is-spend` / `.is-recovery` set `background`, specificity 0,3,0); menu `web/planner.js:53-103` (swatch row `:84`, `patch({col})` `:99-101`); `TONES` `:27-34`; tone passed from `web/today.js:488` (logged) and `:499` (planned) and `web/planner.js:809`; classes applied at `web/calendar.js:96` and `:101`; swatches `web/dashboard.css:1942-1966`; `/#today` Day timeline and `/#plan`, 1440 and 375, light and dark.
- **Evidence:** measured by three people. A logged "Meeting or call" has fill `color(srgb 0.8965 0.8408 0.7314)`; after choosing each of Sand, Sage, Sky, Rose, Plum and Slate the fill is unchanged in 6 of 6 (1 distinct fill) while the border changes in 6 of 6 (Sky → `rgb(91,143,185)`). A logged block with cost 0 does take the tone; a logged recovery keeps its green fill. On Plan the fill does change, but only to a 24% tint: Sand on a work block moves the fill by ΔE 0.8, Sage on a rest block by 4.1 (light) / 1.5 (dark), while the border moves by 10–85. Swatches are a 70% mix, 16–30 ΔE away from the fill they produce. Side defects from the same run: meta text on a logged amber fill is 4.36:1 (light) and 3.87:1 (dark) at 0.72rem (`dashboard.css:2016-2022`); the Sand border is 2.31:1 against the light surface; done blocks fade with `opacity:.72`, dropping meta to 2.78–3.87:1.
- **Problem:** colour is how a person sorts a busy day (appointments vs housework vs rest), and Today's timeline is where the day is read. On logged blocks the choice shows as a 1px outline around an unchanged amber or green fill, so it looks like a rendering glitch ("did it save?"), colour coding is useless at a glance, and the same menu repaints the fill on Plan. A tone also replaces the green/amber cost cue, so a toned work block and a toned rest block look the same (see A-H27).
- **Fix:** make the fill a variable and let a chosen tone replace the cost tint in every state. Replace `dashboard.css:1903-1910`, `:1937-1941` and `:1973-1978` with the block below. Validated in a scratch session (old rules removed through the CSSOM, this CSS injected) for all six tones in light and dark: 7 of 7 distinct fills on logged and on planned blocks, title ≥5.95:1, meta ≥4.62:1.
  ```css
  .cal-block { background: var(--fill, var(--accent-soft)); }
  .cal-block.is-spend    { --fill: color-mix(in srgb, var(--amber) 16%, var(--surface)); border-color: var(--amber); }
  .cal-block.is-recovery { --fill: color-mix(in srgb, var(--green) 15%, var(--surface)); border-color: var(--green); }
  .cal-block.cal-logged.is-spend    { --fill: color-mix(in srgb, var(--amber) 30%, var(--surface)); }
  .cal-block.cal-logged.is-recovery { --fill: color-mix(in srgb, var(--green) 28%, var(--surface)); }
  /* a chosen colour wins over the cost tint, logged or planned: keep these rules LAST */
  .cal-block.cal-tone, .cal-chip.cal-tone { --fill: color-mix(in srgb, var(--tone) 24%, var(--surface)); border-color: var(--tone); }
  .cal-block.cal-logged.cal-tone { --fill: color-mix(in srgb, var(--tone) 38%, var(--surface)); }
  .cal-chip.cal-tone { background: var(--fill); }
  .cal-block .cal-meta { color: color-mix(in srgb, var(--fg) 82%, var(--fill, var(--surface))); }
  ```
  Then: (a) show the real result in the swatch (`.fb-menu .fb-swatch{background:color-mix(in srgb,var(--tone) 38%,var(--surface));border:3px solid var(--tone)}`; and make "Automatic" a diagonal split of the amber and green tints, not a stripe pattern); (b) replace Sand (`#c9a46b`) and Sage (`#6f9a73`) with hues away from the cost tints, for example Teal `#2f9aa6` and Orange `#d9622b`, because they are the same family as the Automatic amber and green; (c) darken the Sand edge to ≥3:1 (`#a9812f` is 3.55:1); (d) drop `opacity:.72` on `.is-done` (`:1913`, `:2148`) and use a flatter fill instead so done text stays ≥4.5:1; (e) add to `test/browser-calendar.cjs`: right-click a logged block, choose Sky, assert `backgroundColor` changed and equals the planned formula, for all six tones with `colorScheme` light and dark. A fuller per-tone token set (edge, fill and ink for light and dark, 3.55–4.91:1 edges) was worked out by the Plan auditor and is a drop-in replacement for the hard-coded `--tone` values if you want AA on every state.

### A-H2. `/register` leads with a pitch: the submit button is 350px below the fold on a phone, there are two H1s, and the form is four fields plus two reveal rows

- **Pass:** First-time user + Designer
- **Where:** `web/login.html:41-54` (aside precedes the form), `:109-148`; `web/presence.css:1193-1215` (stacked layout), `:716-738`; `web/login.js:97-111` (password toggles), `:190-205` (confirm check); `/register`, 375×812.
- **Evidence:** measured: `.auth-story` y=105–359; form starts y=389; username y=609; password y=794; confirm y=996; submit y=1112–1162 against an 812px screen; page 1,475px; two visible `<h1>`s ("Your day. Your story. Your own pace." and "Make yourself at home."); each "Show password" is a separate 118×33 text button; 8 targets under 44px.
- **Problem:** by the time someone taps "Create your free account" they are sold. Re-pitching in 39px type before a four-field form pushes the button off the first screen on every phone and adds a second H1. Confirm-password is redundant when a reveal toggle exists, and each toggle is its own 33px row, which is why the form is 861px tall.
- **Fix:** ≤700px: `.auth-page .auth-story{display:none}`; make the aside heading a `<p class="display">` so each view has one `<h1>`; delete `#register-confirm` and `passwordsMatch("register")`; put the reveal toggle inside the input as a 44×44 icon button (`position:absolute; inset-block:0; right:0`); add `enterkeyhint="next"`. Result: the submit button inside the first 812px.

### A-H3. After the email link the new person is still signed out: eleven taps and a "Welcome back" with empty fields

- **Pass:** First-time user
- **Where:** `web/login.js:169-179` (success → "Sign in" → `location.assign("/login")`), `web/login.html:63-67,198-207`; `security_accounts.go:194-277` (the verify handler reads the username at `:227` but replies only with a message at `:276`); `/login#verify=…`, 375×812.
- **Evidence:** measured walk with a live mail sink: landing CTA (1), four fields + submit (5), leave for the inbox, tap the mail button, "Verify email address" (7), "Sign in" (8), `/login` reloads **empty** ("Welcome back." / "A little check-in starts here."), username (9), password (10), "Sign in" (11). After success the card still says "Verify your email" and offers two buttons ("Sign in" and "Back to sign in") that go to the same place. Both auditors who walked it counted the same.
- **Problem:** the person has proved they own the inbox and must still authenticate, on a phone, with a password they set two minutes ago, after switching apps (keyboard and password-manager context gone). "Welcome back" tells someone who registered 90 seconds ago that the product has never seen them. The second "Verify" click is justified (link scanners cannot consume a fragment token) but nothing says why or that it is the last step.
- **Fix:** minimum: return `username` from `verifyEmailToken`, store it in `sessionStorage`, show the sign-in view with `#username` prefilled and `#password` focused, heading "Email verified. Sign in to start.", and hide `[data-signin]` (`form.querySelectorAll("[data-signin]").forEach(b=>b.hidden=true)`). Better: same-device auto sign-in. At register, `login.js` stores `device=crypto.randomUUID()` in `localStorage` and sends its SHA-256 with the registration; the token payload keeps the hash; the verify call sends `{token, device}`; on a match create the session as `handleLogin` does (`auth.go:322`) and `location.assign("/")`. Another device falls back to the minimum. Eleven taps become six.

### A-H4. The "check your email" moment has no success state

- **Pass:** First-time user + Designer
- **Where:** `web/login.js:163-167` (appended copy `:165-166`), `security_accounts.go:62-64`, `web/login.html:145-147`; `/register`, 375×812.
- **Evidence:** the form stays live, the primary button silently relabels "Send another link", and a 14px bold green message reads "If this request is eligible, an email will arrive shortly. Check your inbox and spam folder. Check spam folders. To request another link, submit this form again; a newer link replaces the previous one." One sentence appears twice (server and client both add it) and two sentences are hedges.
- **Problem:** this is where the funnel leaves your site and the screen looks as if nothing happened: no heading, no echo of the address, no way to fix a typo in it, no resend cooldown, no hint that the link opens on the device they are holding. "If this request is eligible" reads like a tax form, so people retry. (The silent-failure half of this screen is A-C2.)
- **Fix:** on `r.ok` for `register`, replace the form with a state panel: `<h1>Check your inbox</h1>`, "We sent a link to **a•••@example.com**. It works once and expires in 30 minutes.", buttons "Resend link" (disabled with a 30s countdown) and "Use a different address" (back to the form, fields kept). Server text: "If that address can be used, a link is on its way." Delete the client-appended sentence (`login.js:165-166`). Move focus to the new H1; keep `role="status"`.

### A-H5. A failed sign-in wipes the username and reloads the page

- **Pass:** First-time user
- **Where:** `auth.go:330,374,398` (`Redirect … /login?e=bad`), `web/login.js:34-44`, `web/login.html:63-90`; `/login`, all viewports.
- **Evidence:** measured: after one wrong password `#username` is empty; the error appears after a full reload: "That username or password didn't match. Try again. (After ten wrong tries an account is paused for 15 minutes.)" The lockout warning is shown on the first failure.
- **Problem:** one typo costs both fields again. For people who sign in rarely, on a phone, with a half-remembered password, that is the whole conversion. Showing the lockout threshold up front raises anxiety in an audience that is already tired.
- **Fix:** `login.js`: on submit `sessionStorage.setItem("jiggered:u", username.value)` (never the password); in `initAuth`, when `?e=bad|busy` is present, restore it into `#username` and focus `#password`; clear it after a successful load. Show the lockout sentence only from the 5th failure (server adds `&left=4`) or drop the parenthetical.

### A-H6. The verification, reset and recovery emails waste the inbox preview, two of three never say "ignore this if it wasn't you", and nobody is named

- **Pass:** Designer + First-time user
- **Where:** `branded_email.go:17-32` (template), `:24` (eyebrow), `:25` (H1 repeats the subject), `:31` and `:47-51` (taglines), `:65-66` (headers); copy at `security_accounts.go:136`, `:183`, `:414`; labels `product_improvements.go:126-129`.
- **Evidence:** decoded and rendered at 600 and 375px: the first visible text is "jiggered. YOUR OWN RHYTHM Verify your Jiggered account Confirm your email to create your account…" with no hidden preheader, so the first 55 characters of the inbox snippet are wordmark, eyebrow and the subject again. The registration body is 75 characters with no "if this wasn't you". The reset body is one 192-character paragraph. The recovery body says "It will replace your previous verified address" when none exists. Headers carry no `Message-ID`. Three slogans appear in the HTML, two in the plain text. What works: multipart with plain text first, display name "Jiggered", 30-minute expiry stated, token in the URL fragment (scanners cannot consume it), CTA 137×48, contrast 6.2–11.9:1, arrival in 1.0s locally.
- **Problem:** a stranger who typed your address gets nothing to reassure them, the username and server are not named (the host appears only inside the URL), and the snippet is filler. RFC 5322 recommends a `Message-ID` and filters check for it.
- **Fix:** add `Preheader string` and, as the first child of `<body>`, `<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;color:#f8f9f4">{{.Preheader}}</div>`. Verify: subject "Confirm your email to start using Jiggered", preheader "Tap the button within 30 minutes. If this wasn't you, ignore this email.", H1 "One tap to finish.", body "Hi {username}, confirm {email} to create your Jiggered account on {host}. The link works once and expires in 30 minutes. Didn't ask for this? Ignore this email; no account will be created." Reset: preheader "Your password hasn't changed yet. Use the button within 30 minutes.", two short paragraphs, the 2FA sentence only when enabled. Recovery: "Confirm {email} as the recovery address for {username} on {host}." Replace the eyebrow and both slogans with one footer line; add `Message-ID: <rand@host>` and `Auto-Submitted: auto-generated` in `brandedEmail`.

### A-H7. The recovery-email link silently does nothing when opened in the browser you are signed in to

- **Pass:** First-time user (account safety)
- **Where:** `main.go:327-331` (`loginPage` redirects any signed-in request to `/`), `product_improvements.go:126-131` (the link is `/login#verify=<token>`), `security_accounts.go:414`, `web/app.js` (no `#verify` handler; `grep verify=` finds only `login.js`), `web/early-nav.js:22` (treats the hash as a tab id), `web/security.js:5`; `/login#verify=…` while signed in, 375.
- **Evidence:** measured by the public-pages auditor: a signed-in context requests the recovery email, then opens the emailed link in that same context → it ends at `/#today`, title "Jiggered", and the verify form is never shown; the identical URL in a fresh context verifies, proving the token was not consumed. The code path is as read: the 303 keeps the fragment, and the app treats `#verify=…` as an unknown tab.
- **Problem:** the person adding a recovery email is by definition signed in, and the mail usually opens in the same browser. They land on Today with no confirmation or error, and "No verified recovery email yet." never changes. Self-service reset needs a verified address (`security_accounts.go:158`), so the safety net is never installed, nothing says so, and Help tells people to do exactly this (`web/help.js:18`). A `#reset=` link opened while signed in dead-ends the same way. The Account auditor independently measured the same result (the server still reports `email: ""`) and rated it Critical; I rate it High because opening the link signed out works and it is off the sign-up path. When it does work, the server answers "Email verified. You can now sign in." for every purpose (`security_accounts.go:276`), which is the wrong sentence for someone already signed in.
- **Fix:** in `app.js` boot, before `go(startTab())` (line 819): `const f=new URLSearchParams(location.hash.slice(1)); if(f.get("verify")){history.replaceState(null,"","/#account"); const r=await api("POST","/api/auth/verify",{token:f.get("verify")}); toast(r.ok?"Recovery email verified.":r.error);}` then `go("account")`, which refreshes the address; for `reset` while signed in, toast "That is a password-reset link. Sign out, then open it again." Return "Recovery email verified." from `security_accounts.go:276` when `purpose == "email"`. Call `security.load()` on `visibilitychange` so the manual "Refresh security status" button is not needed. Alternative: serve the verify and reset screens at `GET /verify` and `/reset` without the signed-in redirect and email those paths. Add the signed-in case to `test/browser-accounts.cjs:406-410`, which only opens the link in a fresh context.

### A-H8. The only picture of the product is a mock with its "Example" label hidden and its rows covered, and the eight public pages have no product image at all

- **Pass:** Designer + First-time user
- **Where:** `web/landing.html:60-127`; `web/presence.css:375-425` (`.floating-note`, `.note-top{top:0;right:-12px}`, `.note-bottom{bottom:13px;left:-15px}`), `.preview-badge` `:249`; `web/public/*.html` and `web/public/layout.html:102`; `/welcome` 1440×900 and 375×812.
- **Evidence:** measured at 1440: `elementFromPoint` at three points across `.preview-badge` ("Example check-in") returns `.floating-note.note-top` every time, so the badge is fully covered. The second activity row reads "of tea" and the card footer "mall moments. A clearer picture." The mock's labels ("Low energy / Somewhere in between / Feeling good", "Energy left 6/10") are not the product's ("Green / Amber / Red", "Points left today"). The same `↗` glyph is the CTA arrow, the "short walk" icon and the "Patterns, not pressure" icon. The eight public pages contain only the logo twice: no figure, no screenshot, no number; the Alex/Riley worked examples are paragraphs where the real chips and ring would prove the idea.
- **Problem:** a health tracker asking strangers to trust it with symptoms shows an illustration, hides the one word ("Example") that makes the illustration honest, lets decoration cover its own content, and sets up labels the app does not use. Its true trust signals (MIT source, self-hostable, zero third-party requests, CSV/JSON export, no cookies) exist only as prose and an 11px footer line.
- **Fix:** replace the mock with a real 2× WebP of Today after a check-in (Amber, 6 of 10, two activities) captured at 390px from the app, `alt="Jiggered Today screen: Amber check-in, 6 of 10 points left"`. If keeping the illustration: `.note-top{top:-26px;right:-8px}`, `.note-bottom{bottom:-30px;left:-15px}`, `.hero-art{padding-bottom:40px}`, `.preview-badge{position:relative;z-index:3}`, and swap the arrow in `.activity-icon` and `.note-icon` for walking and pattern glyphs. Public pages: add a `.public-figure` component, whitelist a `/shots/` prefix beside `/fonts/` in `routes()` (`main.go:362`), use real captures (Energy → check-in + ring, Symptoms → Episode form, Getting started → one per step), and add `<ul class="trust">Open source (MIT) · Self-hostable · No third-party trackers · Export anytime</ul>` under every `.public-lead` (each item verified true).

### A-H9. Landing and public pages have phone-width layout defects and a header that costs 20% of the first screen

- **Pass:** Designer
- **Where:** `web/presence.css:490-495` (`.feature-number` inline) with `:506-511,1148-1153` (`.mini-chart` inline SVG, max-width 240px); `.p-button` `:98-115` and `.closing .p-button` `:684-689`; `web/public/layout.html:36-58`, `web/public.css:161-197`, `web/presence.css:1056-1081`; `/welcome` at 375 (also 414, 768) and the public pages at 761–820.
- **Evidence:** measured: card 3's `.feature-number` is 36px tall (two lines) at 375, 414 and 768 but 13px at 320, 1024 and 1440, so "03 /" floats beside the chart and "NOTICE PATTERNS" wraps below; the closing CTA is 291×80 with its label wrapped to "Create your free / account" at 375 (280×80 at 320); the header occupies y=0–168 at 375 (logo row, button row, nav row) before the first words, 172px at 761–820 and 188px on the article pages, and "Create your free account" appears twice in the first 612px.
- **Problem:** visible bugs at exactly the widths most visitors use; a wrapped CTA label looks broken; a three-row header costs a fifth of the first screen.
- **Fix:** `.mini-budget,.mini-chart{display:block}`; `.p-button{white-space:nowrap;gap:12px;padding-inline:20px}` and `.closing .p-button{width:100%;max-width:340px}`; ≤600px one header row (logo, "Log in", "Join free") with the four nav links in a `<details>` "Menu" or the footer; tablet: move the header breakpoint from 760px to 900px (`public.css:161`) and order `.wordmark`/`.nav-actions`/`.public-nav` so the buttons share the logo's row (≈130px).

### A-H10. Every public page's only sign-up prompt is 1.7–3.7 screens down and its only supporting line is the requirement

- **Pass:** First-time user + Designer
- **Where:** `public.go:109-110` (`Availability = "Email verification is required."`), `web/landing.html:51-58,223-230`, `web/public/layout.html:103-107`, `web/public.css:109-125`, `web/public/pricing.html:21`, `web/public/start.html:9`; every public page, all viewports.
- **Evidence:** measured: under the hero button, in 13px grey, "Email verification is required."; the closing aside on all eight article pages is "Make a little space for today." + the same sentence + a button, and its top is at 1,537–1,923px at 1440 and 1,945–2,976px at 375; sign-up links inside the article: 0 on seven pages and one plain link on `/pricing`; the header button scrolls away; each "Next:" line offers three other docs.
- **Problem:** nothing between the header and the last screen invites the click; when it arrives, the headline is a mood and the one supporting line is a hurdle with no promise of effort or outcome. A page that has convinced someone ends with a menu.
- **Fix:** open state `Availability` → "Free. No card. We'll email you a link to confirm your address, then you're on Today in about a minute." After `.public-lead` on energy, symptoms, spoon and start add `<p class="public-cta"><a class="p-button" href="{{.CTA}}">{{.CTALabel}}</a> <span>Free. One email link to confirm.</span></p>` (open state only). Aside heading → "Start with one check-in."; turn each "Next:" paragraph into one sentence with one link; make the `/pricing` box link a `.p-button`; render the button directly in `start.html:9` when `.Registration`.

### A-H11. Nothing says who runs this server, and on a default install every public page sells an account the visitor cannot get

- **Pass:** First-time user
- **Where:** `web/landing.html:213-234,287-308`, `web/public/privacy.html`, `.privacy-detail` in `web/presence.css`; `public.go:94-117` (closed branch `:111-114`), `web/public/layout.html:46-57,103-107`, `web/public/pricing.html:6-22`, README line 99 ("Registration is closed by default"); `/welcome` and every public page.
- **Evidence:** the honest sentence "Server operators can access the database and backups, so use an instance you trust." is 13px muted green; the only identity on the page is "Developed by EyUp.io" (13px); grep finds no operator name, address or setting. Measured on a default-config private instance: the `/pricing` box reads H2 "Create an account", pill "REGISTRATION CLOSED", "Registration is currently closed…", then "If registration is closed, ask the administrator…", then a text link "Log in"; every article's aside is "Make a little space for today." → "Registration is currently closed…" → "Log in"; the landing hero's primary button reads "Log in".
- **Problem:** for symptom data "who can read this?" is the first objection; the answer is honest (a strength) but buried, and "Choose a service and operator you trust" is followed by no operator to trust. On a default install the invitation heading is contradicted by the sentence under it, "If registration is closed" appears inside the branch that renders only when it is closed, and "ask the administrator" has no name or address.
- **Fix:** add instance settings `operator_name` and `operator_contact` (beside `PublicURL` in the `Accounts` struct, `remote_services.go:60`, the Admin form, and `publicData`). Put a bordered three-row "Your data" box directly under the hero CTA and in the choice card: *Who runs this server:* {operator_name}; *Who can read your log:* you, and operators with database access; *Leave any time:* export CSV/JSON or delete the account in Account. Set `.privacy-detail` to 16px in the ink colour; keep the sentence verbatim. Closed state: aside H2 "This Jiggered is invite-only.", P "Ask {contact} for an account, or run your own copy.", "Log in" primary and "Run your own" (GitHub) secondary; drop the pill and the conditional sentence on `/pricing`.

### A-H12. The public privacy page is softer and less complete than what the product tells you after sign-up

- **Pass:** First-time user
- **Where:** `web/public/privacy.html:8-13,28-33,34-40,41-46,47-50`; versus `web/index.html:1184-1190` (in-app "Your privacy"), `users.go:283-294,318-321` (`auditKeepFor` = 180 days), `account.go:198`, `web/account.js:57` (optional usage counts), `security_accounts.go:25` (email stored in `account_security`).
- **Evidence:** in-app: "An admin can reset your password and sign in with it, can download a backup of the whole database, and anyone with access to the server's files can read them." Public: "Admin screens… show account details and record counts… Administrators can reset passwords and download a full database backup." Measured on a private instance: after `DELETE /api/me` the audit log still holds 4 rows naming the deleted account, three with the sign-in IP, retained 180 days, while `privacy.html:30` says deletion "removes your account's records from the active server database". The opt-in usage counts are not mentioned; `privacy.html:49` points to "access and release status" on `/pricing`, which has none.
- **Problem:** this is the page a person with a health condition reads before typing symptoms. Where the product is more candid after sign-up than the public page promises, trust is spent for nothing. It omits that an admin can sign in as you, that username and sign-in IPs outlive deletion for up to 180 days, that an email address is stored, and that an opt-in usage feature exists.
- **Fix:** add a five-row "Who can see what" list at the top: **You** (everything you log); **Admins** (account names and record counts; they can reset your password and sign in as you); **Whoever runs the server** (the database and backups, in plain text); **Audit trail** (username, sign-in times and IP addresses for 180 days, even after you delete your account); **Your email address** (stored for verification and recovery, in the database and backups). Add one sentence on optional usage counts. Change `privacy.html:49` to "See pricing and access before getting started."

### A-H13. The landing sells spoons; the product starts in "points" and never asks

- **Pass:** First-time user
- **Where:** `web/landing.html:186-202`, `web/public/spoons.html:19-20`, `web/energy-theme.js:2` (`profile.energyTheme === "spoons" ? "spoons" : "points"`), `web/index.html:325-343` ("Choose points or spoons" is the third link in the collapsed "How points work" disclosure, `:341`), `web/index.html:172-209` (the checklist has no wording step); hard-coded "points" in `web/planner.js:63-70,144`, `web/calendar.js:259,480`, `web/today.js:287,458-459`; `/guides/spoon-theory` → `/register` → `/#today`.
- **Evidence:** a fresh account says "points" on the first screen. The guide tells people to "choose Account → Profile → Energy language → Spoons, then Save profile" and links nowhere inside the app. From Today the shortest path is four clicks, through a disclosure that is reachable only in the last ~190px of scroll at 1440 and 2,157px down at 375. After switching, 14 strings change but seven still say points: the timeline help ("…the points follow"), the menu ("POINTS FOR 1 H: −2 / More points (+1)"), the live region ("…, −3 points"), the remove dialog, and the form hint directly under the label "Spoons it costs".
- **Problem:** the visitors most likely to convert clicked a Spoon Theory page. Their first minute says "points", the word they came for is three disclosures deep, and when found it is half applied.
- **Fix:** give the spoon pages' CTAs `/register?w=spoons` (`public.go` CTA href); `login.js` stores `sessionStorage.wording`; on first app load `patchSettings({profile:{...profile, energyTheme:"spoons"}})` (`today.js:132`). Add an optional fourth checklist row "Count in: points / spoons" (`index.html:184-208`) wired to the same patch. Route the seven strings through `energyCopy`/`energyWords` (menu and form hint in `planner.js`, the two announcements in `calendar.js`, dialog and help in `today.js`).

### A-H14. The public docs describe the app in words the app does not use, and the export steps cannot be followed

- **Pass:** First-time user
- **Where:** `web/public/export.html:9-15,22-31`, `web/public/energy.html:9-12`, `web/public/start.html:14-18`; versus `web/index.html:243-255` (check-in), `:730-775` (History "Prepare a summary"), `:771-773` (CSV buttons); `web/tooltips.js:38` (dead `#sum-range` hint).
- **Evidence:** measured on a seeded account: on first view of History none of the CSV buttons or Print is visible; they live inside the collapsed `<details id="history-share">`, opened by the green **Prepare summary** button. That panel has three checkboxes and no period selector, yet `export.html:24` says the summary "has its own period selector". The check-in buttons read **Green · Feeling good · Full points / Amber · In between · −3 points / Red · Low energy · −6 points**; the docs say "normal plan, reduced plan, essentials only". **Activities as CSV** and "Include activity detail" are undocumented; the guide's page title suggests a PDF download while the body correctly describes the browser print dialog.
- **Problem:** a reader hunts for "Days as CSV" and cannot find it. The pricing page sells "CSV exports, a printable summary" as a feature; the how-to for them is wrong.
- **Fix:** replace the `export.html` steps with: "1. Open History. 2. Pick a Period at the top (open Filter and search to narrow it). 3. Press **Prepare summary**. 4. For a spreadsheet press **Days as CSV**, **Episodes as CSV** or **Activities as CSV** (one row per entry). 5. For paper or PDF, set **Include private episode notes** as you want, check the preview, press **Print or save as PDF** and choose Save as PDF in your browser's print window." Rewrite `energy.html:9` and `start.html:15-17` with the real labels. Retitle the page "Export Your Symptom Diary: CSV and Print to PDF". Delete `tooltips.js:38`.

### A-H15. "Works offline" fails on a hung connection: the signed-in app sits in "Connecting…" for 26–41 seconds

- **Pass:** First-time user + Designer
- **Where:** `web/app.js:358-359` (`await Promise.all([loadDefaults(), store.load()])` before first paint), `web/sync.js:24-29` (`snapshotTimeout` = 300000ms), `web/sw.js:126` (5s abort before the cached shell is used), `web/app.js:63-70` (6s `/api/me`); promises at `web/public/offline.html:3-7`, `web/public/start.html:44-48`, `web/landing.html:351`.
- **Evidence:** measured by two people. Airplane mode (`setOffline`): usable in 316–445ms. With every API call stalled for 20s (a hung connection, which is what one bar of signal or a captive portal looks like) the app stayed on "Connecting…" and became usable after ~26s in my run and 31s in the auditor's (41s for a 30s stall); `/api/docs` has no short timeout. The device copy is already hydrated (`store.hydrate`, `:358`).
- **Problem:** a tired person trying to log a symptom sees an empty page. The public docs promise the app opens without a connection; that holds only when the failure is instant.
- **Fix:** do not gate first paint on the network: `await Promise.race([Promise.all([loadDefaults(), store.load()]), new Promise(r=>setTimeout(r,3000))])` and let `store.load()` finish in the background (it already calls `notify()`); keep the 300s ceiling for refreshes only. After 3s set the pill to "Showing this device's copy while we reconnect." In `sw.js` serve `/` stale-while-revalidate when a cached shell exists. Add to `offline.html`: "If your connection is slow rather than gone, the app opens from this device's copy after a few seconds." Pluralise `app.js:619-620` ("1 changes queued").

### A-H16. The first screen of every admin-created account has a dead "Sign-in security — Loading" panel, a no-op menu and an invisible error, and the promised "ten-second check-in" is below the fold

- **Pass:** First-time user + Designer
- **Where:** `web/app.js:120-148` (forced branch hides `#account-panel > .panel:not(#pw-panel)` at `:128-130` **before** `accountView.init` runs at `:140-145`), `web/account.js:87-88` (inserts `securityMarkup` after the hide, so it appears unhidden), `web/security.js:2-14`, `web/app.js:137-138` (banner), `:441-453` (account-menu handlers, attached after the early `return` at `:147`), `web/login.js:97-111` (the sign-in page has show-password toggles; this form does not); forced password change on first sign-in (every account created by an admin or `jiggered user add`; registration is closed by default), 1440 and 375.
- **Evidence:** measured by two auditors. The page is 1,908px (1440) / 2,047px (375) tall for one task. `#security-panel` is visible with a "Loading" badge that never resolves, because `security.load()` only runs from `show()`; its calls are refused: with the temporary session `GET /api/me/security` returns 403 "Choose a new password before doing anything else." At 375 the panel is 968px beside a 480px password panel. Tapping "Account and settings" in the avatar menu leaves the heading "A space of your own." with the menu open, covering the welcome banner. A mismatch error lands at y 814–841 on an 812px screen (A-H43). The banner promises "a ten-second morning check-in", but the next screen says "under a minute" and at 375×812 `#checkin` is at y 866–1001, below the fold (A-C1). The required field is labelled "Current password" although the person holds a *temporary* one, and the hint says "Changing it signs out your other devices" to someone with none.
- **Problem:** the first screen every invited person sees contains an unrelated "Sign-in security" form (recovery email, authenticator, "Refresh security status") stuck on LOADING that can only return 403. It looks broken exactly when trust is formed, and invites two-factor setup before the temporary password is even changed.
- **Fix:** (1) in `account.js:87-88` skip `insertAdjacentHTML(securityMarkup)` and `initSecurity` when `me.must_change_password`, or move the hide at `app.js:128-130` below `accountView.init(...)`. (2) Forced copy: label "Temporary password (the one you were given)"; drop the "signs out your other devices" sentence while forced; keep "At least 8 characters." (3) Extract `login.js:97-111` into a shared password toggle and apply it to `#pwform` and `#delform`. (4) Move the menu handlers (`app.js:441-453`) above the forced `return`, or hide `[data-menu-go]` while forced. (5) Banner: "Welcome to Jiggered. Choose your own password to continue (the one you were given was temporary). Then one tap checks you in." and give first-run Today's check-in priority over the onboarding card.

### A-H17. Dropping, placing or "Log it now" records activities as already done at future times

- **Pass:** Designer + First-time user
- **Where:** `web/today.js:368-378` (`onDrop` → `logAt`), `:409-413` (`place`), `:425-432` ("Log it now"), `:217-223` (a tile tap writes `t=now` with no length); `/#today`, 1440 and 375.
- **Evidence:** measured by the Today auditor at 14:2x: dropping "Deep focus (2 hours)" on 15:05 created a solid *logged* block 15:00–17:00, "left" 4→3 at once, with no warning, overlapping the dashed 16:00 Appointment. Re-run by me at 14:49: tap a palette chip, then "Log it now" logged "Meeting or call 14:49–15:49 −2 points" and the ring went to 8 of 10: a 60-minute block ending in the future. A tile tap writes `t=14:49` with no length, so three ways to log the same activity make three different records.
- **Problem:** dragging to a later hour is how anyone says "I'm going to do this". The app files it as history and spends the points now, and History, the clinician summary and the CSV all treat it as done. "Log it now" means "I just did this" but stamps an hour that has not happened. A health log where "logged" can mean "maybe later" cannot be trusted.
- **Fix:** in `logAt(preset, start, dur)` (`today.js:370`), when `key() === ctx.today()` and `start` is after the current minute, dispatch `addEntry` to `planId(key())` (the same call as `change()`, `today.js:331-340`) with `{id: uid(), a, c, t, dur}` and toast `Planned ${a} for ${t}. Tap it when it's done.` with Undo; draw `.cal-drop` dashed when its start is after now. Make "Log it now" (`today.js:425-432`) call `logOne` (`:217-223`) so it equals a tile tap.

### A-H18. One activity, three signs: every surface shows "−2" for a cost of 2 except the field you type into, and "More points (+1)" lowers recovery

- **Pass:** Designer + First-time user
- **Where:** display `web/util.js:78` (`signed`), `web/today.js:463,729,731`; Today form `web/index.html:420-422`, `web/today.js:526-531,583`; Plan form `web/index.html:628-636` and `web/planner.js:414-426`; menu `web/planner.js:63-70`; screen-reader label `web/calendar.js:61`; copy `web/index.html:265`, `web/tooltips.js:28-29`, `web/help.js:30`; Today, Plan, 1440 and 375.
- **Evidence:** measured for "Meeting or call" (stored +2): tile `−2`, palette chip `−2`, pill `−2 points`, block `08:30–09:30 · −2`, aria-label "…, −2 cost", but the Edit form reads **`Points it costs: 2`**. The menu heading says "Points for 2 h: −4" and "More points (+1)" gives "Meeting or call now −5". On a recovery block, "Nap or lie down" shows "+2" and "More points (+1)" gives "now +1" (stored −2 → −1: less recovery). To plan a nap the person types −2 in "Points it costs", then reads +2 everywhere. The ring tooltip says "Positive activity costs spend points" yet no spending activity is shown with a plus anywhere.
- **Problem:** someone who copies a recovery's "+2" from a tile into the form records a spend; "More points" lowers the balance on work blocks and the recovery on rest blocks; "minus 2 cost" is a double negative read aloud. The one explanation contradicts every number the person has been reading.
- **Fix:** one rule everywhere: the sign is the effect on points left. (1) Forms: label "Effect on points left", show `−c`, store `c = −Number(value)`, placeholder "−2 uses 2, +1 recovers 1" (`today.js:526-531,583`, `index.html:420-422,437`, Plan form, `tooltips.js:28-29`), or a segmented control "Costs energy / Gives energy back" with a positive 1–10 number negated on submit. (2) Menu buttons "Costs 1 more (−1)" / "Costs 1 less (+1)" (`planner.js:69-70`). (3) `calendar.js:61`: "uses 2 points" / "recovers 1 point". (4) Tooltip `index.html:265`: "An activity that uses energy shows as −2; one that gives energy back shows as +2." The export side of the same problem is A-H33.

### A-H19. Finishing a planned block from the timeline throws the page 1,500–1,800px away from it

- **Pass:** Designer + First-time user
- **Where:** `web/planner.js:227-231` (`completePlanned` focuses the first "Done" in `#today-plan`), caller `web/today.js:297` (`onOpen` for `plan:` blocks); cue hidden by `web/dashboard.css:1995-2002` (`.cal-block.is-short .cal-meta{display:none}`); `/#today`, 1440 and 375.
- **Evidence:** measured: at 1440×900 one click on planned "Appointment" moves scrollY 759 → 2,316 (+1,557px) and puts focus on "Log Walk or dog walk as done"; at 375×812 one tap moves 3,716 → 1,928 (−1,788px) and the "Logged Appointment. Undo" toast then covers the next row's Done. The list's own Done at 1440 jumps +1,136px. On 30-minute blocks the "tap to finish" cue is not drawn.
- **Problem:** the headline gesture of the new timeline ends with the page leaving the timeline. You never see the dashed block turn solid; you land in the duplicate "Still to come today" card. A short planned block also commits on any stray click with no visible hint that a click commits.
- **Fix:** `completePlanned(ctx, day, id, {focus = true} = {})`: wrap `planner.js:227-231` in `if (focus)`; call it with `{focus:false}` from `today.js:297`. Keep keyboard on the grid: add `focusBlock(date,id)` to the object returned by `createTimeGrid` (`calendar.js:493-519`) and call it after the dispatch. Prefix every planned title with "○ " (done ones already get "✓ ", `calendar.js:96`) so the cue survives `.is-short`.

### A-H20. The lower half of Today's sticky left column cannot be reached until the bottom of the page at 1440×900

- **Pass:** Designer
- **Where:** `web/style.css:3096-3101` (`#today-panel > .today-side{position:sticky;top:76px}`); contents `web/index.html:257-344`; `/#today`, ≥960px.
- **Evidence:** measured by stepping scrollY 50px and requiring ≥20px of the element below the 76px tab bar. Fresh account (column 1,600px, max scroll 2,790): the poor-sleep switch is visible only at scrollY 2,550–2,750; "Plan your day" 2,450–2,750; "How points work" (and the spoons link inside it) 2,600–2,750. With a plan (column 2,349px, max 3,262): switch 3,000–3,250; every "Done" 2,800–3,250. At 1366×768: switch 3,050–3,300.
- **Problem:** a sticky column taller than the window keeps its top, so everything below its first ~820px sits under the fold until the last 8–9% of the scroll range. The poor-sleep switch is a daily input; "Done" is the plan card's primary action. The earlier C3 moved the timeline out of this column for this reason but left the same trap for everything else.
- **Fix:** pin only what needs pinning: `#today-panel > .today-side{position:static}` plus a compact sticky `.today-pin` (ring at 120px, "4 of 7", check-in summary) at `top:76px`; move the poor-sleep switch into the check-in panel (`index.html:316-324` to after `#advice`). Minimum change: `.today-side{max-height:calc(100vh - 92px);overflow-y:auto;overscroll-behavior:contain}`.

### A-H21. Focus is dropped to `<body>` after almost every action, and Undo cannot be reached from the keyboard

- **Pass:** Designer + First-time user (accessibility on the main path)
- **Where:** re-renders via `setHTML` (`web/util.js:30`): tiles `web/today.js:785-802`, filter pills `:785-788`, palette `:460-465`, check-in `:829-831`, form `:555-560,639`; Plan `web/planner.js:381-384,483-486`, `web/util.js:246-250`; toast `web/app.js:641-655`, markup `web/index.html:1248` (last element in the document).
- **Evidence:** measured: Enter on a tile leaves `activeElement` on BODY and the next Tab goes to the first tile of the list; Enter on "Amber", a filter pill, a palette chip, Cancel/Save in the entry form, and clicking Undo all end on BODY. From the "−" stepper it takes **42** Tab presses to reach the toast's Undo, and the toast lives a fixed 8s; 57 Tab presses reach the first Today timeline item and 47 reach the first Plan block. On Plan, Delete → Tab → Enter on "Remove" ends with focus on BODY. Each arrow-key move is announced twice (grid `role=status` plus the toast).
- **Problem:** a keyboard user logging five activities starts again from the top of a 30-tile list each time and cannot take a mistake back before the toast disappears. "Undo" is advertised in every toast; for them it does not exist.
- **Fix:** (1) remember `document.activeElement.closest("[data-i],[data-filter],[data-preset],[data-s]")` before `setHTML` and refocus the logged tile's `.step[data-step="1"]`, the same pill or chip, `#checkin-change` after a check-in, and the originating block after Cancel/Save/Remove. (2) Toast: `pointerenter`/`focusin` clears `toastTimer`, 12s when it has Undo, and a global Ctrl/⌘+Z runs the last `undo.fn` while the toast shows (`app.js:641-655`). (3) Print the grid's keyboard help under the timeline paragraph (it exists only in an `sr-only` paragraph, `calendar.js:99`). (4) Skip the toast for keyboard moves, the grid already announces them.

### A-H22. Adding or editing from either timeline ejects you 1,000–3,500px down the page to a form that does not name the day

- **Pass:** Designer + First-time user
- **Where:** Today `web/today.js:296-300` (`onOpen` → `edit`), `:303-310` (`onCreate`), `:381-390` (`fromTimeline`, `backToTimeline`), `:640-664` (toast); form at the end of the activities panel `web/index.html:405-446`. Plan `web/planner.js:312-341` (`openForm`, focus at `:340`), `:548-565`, `:716-736`; form in the last panel `web/index.html:620-672` (`#plan-form-title` never names the day).
- **Evidence:** measured. Today 1440: Enter/click on a logged block scrollY 661 → 3,666 (+3,005px); clicking empty space at 07:40 goes 759 → 3,703 with the heading "Other activity"; 375: a block tap 3,722 → 7,155 (+3,433px); at 320 +5,271px. Plan 1440: clicking an empty 18:20 slot jumps scrollY 710 → 1,964; after Save the page is at 1,521, focus on `#plan-add`, the toast says "Plan update queued." and the new block is above the viewport; Cancel leaves focus on BODY; a palette click jumps 1,236px and fills the form for the selected day, not the day being looked at. Escape does nothing in the open form.
- **Problem:** the headline use of both timelines (fix a time, a length or a name) is a full-page round trip that leaves the block and its neighbours thousands of pixels behind. "Queued" is sync jargon and a new activity has no Undo.
- **Fix:** open the editor beside the block: in `fromTimeline` (`today.js:381`) move the form into `#today-timeline-panel .history-section-body` right after `#today-board`, or render it as a `<dialog>` in the `confirmDialog` pattern (`util.js:208-255`) titled "Edit Admin or paperwork" / "Add to Sat 10 Oct, 18:15"; Escape, Cancel and Save close it and focus the affected block (add `focus(date,id)` to `createTimeGrid`). Replace the toast with `Logged ${name} at ${t}.` plus Undo (reuse `logAt`'s, `today.js:374-377`).

### A-H23. On a phone, both timelines trap swipes, hide their handles, and a scroll that starts on a block's edge resizes it

- **Pass:** Designer + First-time user
- **Where:** `web/dashboard.css:1844-1850` (`.cal-scroll`), `:2238-2240` (`#today-board .cal-scroll{max-height:min(52vh,420px)}`), `:2023-2052` (`.cal-resize`, `touch-action:none`, indicator `opacity:0` until hover), `:2072-2093` (touch hit areas 24px), `:2053-2071` (grip 36px), `:2280-2298` (remove 36px, side by side), `:2128-2141` (chips 32px); `web/calendar.js:366-395`; `web/planner.js:694-701,727`; `/#today` and `/#plan`, 375×812 touch.
- **Evidence:** measured with real touch events by two auditors. Today: a vertical swipe starting inside the grid moved the grid's own scroller 78 → 349px and the page by 0; the window is 420px of 812 (52%), and the sticky header takes 99px of it. Plan: a 70px upward swipe starting 8px above the bottom edge of "Appointment" (14:00, 60 min, −2) scrolled nothing, turned the block into 14:00–14:15 and the cost 2 → 1 (toast "…now 14:00–14:15, −2 to −1 points. Undo"); the same swipe from the middle scrolled the timeline. Three consecutive 250px swipes inside the Plan board moved only the timeline; the page moved on the fourth. Resize zones are 158×24px and invisible on touch; two overlapping blocks are 118px wide and read "Meeting …" / "Walk or …"; after tapping a palette chip the "Choose a time on the timeline… Cancel" banner is scrolled off-screen (y −147).
- **Problem:** scrolling is what a thumb does most on these pages; a large share of every block is an invisible edit zone that rewrites the plan and its points, and two nested scrollers make the page feel stuck. Overlaps, the point of a timeline, are unreadable.
- **Fix:** at ≤700px let the page scroll: `#today-board .cal-scroll,#plan-board .cal-scroll{max-height:none;overflow:visible}` with `.cal-top{position:sticky;top:0}`; window Today to "now − 2 h … now + 6 h" with "Show earlier / later". On coarse pointers start move or resize only after a 250ms press-and-hold (arm a timer in `calendar.js:375`, cancel if the finger moves >6px), delete `touch-action:none` from `.cal-resize` and `.cal-grip` and set it only on `.cal-block.is-dragging`; show edge handles on touch (`@media (pointer:coarse){.cal-resize::after{opacity:.7}}`) with a 44px hit height on the selected block only. For `data-lanes` > 1 hide `.cal-remove` (it is in the menu), shrink the grip to 28px or stack overlaps full width with a "2 at 09:00" badge; chips `min-height:44px`. After `setPlacing(i)` make the banner `position:sticky;top:8px`.

### A-H24. Help describes a Today that no longer exists, other Help and README claims are wrong, and neither timeline is documented anywhere

- **Pass:** First-time user
- **Where:** `web/help.js:33-36` (topic `activities`), `:54` (history), `:91` (admin), `:93` (setup button), `:9-81` (13 topics; none for Plan), link `web/index.html:371`; on-screen copy `web/today.js:457-459`, sr-only help `:471`, `web/planner.js:818-826`; `README.md:153`; live strings `web/index.html:361`, `web/history-matrix.js:143`, `web/admin.js:225-226`, `web/services.js:6,30`; `/#today` and `/#plan`, Help.
- **Evidence:** "How it works" opens: "Activities you have logged turn green and move to a Logged today block at the top of the list… Its position stays the same." The string "Logged today" exists nowhere in the UI (grep: only `help.js:36`); tiles change in place with a ×N stepper. No topic mentions the timeline, dragging, tap-then-time, stretching to change points, the right-click menu, colours or keyboard moves (the Fretboard topic does document right-click and press-and-hold). `README.md:153` promises in-app help for planning; there is none. The only Plan drag cue is a 10px label ("DRAG ONTO THE TIMELINE"); on an empty board the help line describes blocks that do not exist; a touch tablet at 768px is told to drag but touch drags from the palette are disabled (`planner.js:717`); a 900ms touch press on a block opened the edit form, not the menu. Also wrong against the live product (checked by the Account auditor): Help says History's buttons are "Previous/Next" and "**Review day**" (they are ← / → and **Edit day**, `history-matrix.js:143`); it names an admin tab "**Off-site backups & email**" (the tabs are "Backups" and "Email & signup", `admin.js:225-226`) and says admin changes need the password "each time" (Backups and Email & signup remember it for 30 minutes, `services.js:30`); the "Review first-use setup" button is appended to `topics[0]` (`help.js:93`), which is now the spoon-theory topic; the security topic (`help.js:18`) sends people down the recovery-link path that fails when signed in (A-H7); and the README calls Help a "tab" (it is a header button, hidden on the forced-password screen). Topic order opens with spoon theory and security rather than getting started, searching "restore" ranks "Can I use spoon theory instead of points?" first, `/#help-restore` falls back to Today, and the browser Back leaves the app because `go()` uses `replaceState` (`app.js:396`).
- **Problem:** the app's own help contradicts the screen, and its newest feature has no documentation anywhere a person would look. Colour, Duplicate and the points steppers have no discoverable touch route.
- **Fix:** replace the first paragraph of the `activities` topic: "Tap an activity to log it now: it turns green with ×1; + logs another, − takes the latest off (Undo is offered). To log something that already happened, open Your day on a timeline: drag an activity onto the hour (on a phone, tap it, then tap the hour), drag a block to move it, and drag its bottom edge to change how long it took: the points follow. Right-click a block, or tap ⋯, to edit, duplicate, colour or change its points. With a keyboard, focus a block and use Up/Down to move it 15 minutes, Shift+Up/Down to change its length, Enter to edit, Delete to remove." Add a `plan` topic after it. Replace `#plan-board-help` with state-aware copy; choose tap-to-place by `matchMedia("(pointer: coarse)")`, not width. Add a visible 44px "⋯" button to each block (`calendar.js:90-94`) that opens `showEntryMenu`, always shown under `(pointer: coarse)`. Fix the rest in `help.js`: "Review day" → "Edit day" and "Previous/Next" → "the ← and → buttons" (`:54`); "**Backups** and **Email & signup** let you set up…" and "Most admin changes ask for your password; Backups and Email & signup remember it for 30 minutes." (`:91`); attach the setup button to the `start` topic (`topics.find(t => t[0] === "start")`, `:93`); reorder topics start, points, activities, episodes, history, settings, spoons, data; rank search by title before body; support `#help/<topic>` in `hashTab()`; use `history.pushState` when entering Help with a `popstate` listener that calls `ctx.back()`; README: "The in-app **Help** button (top right)". Add a unit test that fails when a bold UI label quoted in `help.js` is absent from `index.html` and the JS templates.

### A-H25. Plan's first screen has no call to action above 700px, and the timeline starts a screen or three below the fold

- **Pass:** First-time user
- **Where:** `web/index.html:550-557` (start card), `:558-583` (strip panel above the board), `:600-604` (Add button in the last panel); `web/dashboard.css:1639-1641` (`.plan-start{display:none}`) and `:1701-1706` (shown only at ≤700px); `web/planner.js:386,745,772`; `/#plan`, new account.
- **Evidence:** measured: `#plan-add` top is 1,544px at 1440, 1,676 at 768, 2,067 at 375 and 1,919 at 320 (earlier audit: 748 and 870–882). The board starts at y 850 on a 900px screen, so the first desktop screen is the masthead, the tab bar and seven "No plan" cards. On a phone there are two empty-state cards with different copy ("Nothing planned yet." at the top, "A little breathing room starts here." at the bottom with no button). Tapping "Plan your day" scrolls 2,396px to the plain form, skipping the palette and timeline, and the page grows from 2,766 to 3,658px.
- **Problem:** the timeline and palette, the feature the tab is built around, are a screen below the fold on desktop and three on a phone, and the first interaction a new person is invited to is the old form. The strip above the board duplicates the board's own day header.
- **Fix:** show `#plan-start` at every width while nothing is planned (delete `display:none` at `dashboard.css:1640`) and make its button `$("plan-board").scrollIntoView({block:"start"})` then `setPlacing` on the first saved activity, not open the form. Move "Add activity or recovery" into the board panel header (`index.html:585-590`). Collapse the strip panel to a one-line summary under the board when a timeline is shown; render the bottom empty card (`planner.js:772`) only when `#plan-start` is hidden.

### A-H26. Plan's board is hard to read: the "Any time" row eats the hours, and seven narrow columns cut titles to 4–12 characters

- **Pass:** Designer
- **Where:** `web/dashboard.css:1781-1787` (`.cal-top` sticky, contains the tray), `:1835-1843`, `:2128-2141` (`.cal-chip`, 999px radius), `:2010-2015` (`.cal-title` nowrap), `:1885-1887`; `web/calendar.js:74-86,101`; `web/calendar-model.js:77-98`; `web/planner.js:535,793`; `/#plan`, 375 and 701–1440px.
- **Evidence:** measured. Header height / hours left at 375×812 with N untimed items: 2 → 135px / 431px; 5 → 243 / 323; 8 → 351 / 215; 12 → 495 / **71px (about 1 h)**; at 320×640 and 12 items the grid is not visible at all. At 1440 (125px columns) 5 of 10 seeded titles are ellipsised ("Presentatio…", "Travel or co…"); at 768 (86px columns) 10 of 10. Three blocks at the same time in a 125px column are 37px wide with titles "M", "A", "Q". Three consecutive 5-minute blocks are each drawn 22px tall at 5px offsets, so only the first block's top 5px is clickable. A 56-character untimed name renders as a 5-line pill with text touching the curved border; "Housework" (−2) and "Time outside" (+1) chips are pixel-identical.
- **Problem:** time is optional, so people build lists of untimed items, and the tray lives in the sticky header; at eight items the header takes 62% of the board on a phone. Names are how a timeline is scanned; the full text exists only in `title` and `aria-label`.
- **Fix:** move the tray out of the sticky header or cap it (`.cal-tray{max-height:76px;overflow-y:auto}` plus a "+N more" chip). Chip `border-radius:14px; white-space:normal; overflow-wrap:anywhere`. Choose the column count from the board's own width, `cols = Math.max(1, Math.floor((boardWidth - 46) / 150))` in `planner.js:535,793`. Two-line titles on tall blocks (`.cal-block:not(.is-short) .cal-title{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}`). With ≥3 lanes draw one "3 at 10:00" block that expands on focus. Lay out with the drawn height: in `calendar.js:74-78` pass `end: start + Math.max(dur, 24 / pxPerMinute)` to `layoutDay` and clamp `top` so a block never passes the column end.

### A-H27. Work versus recovery, and the cost itself, are carried by colour alone on short blocks, blocks without a length, "Any time" chips and any coloured block

- **Pass:** Designer
- **Where:** `web/dashboard.css:2000-2002` (`.cal-block.is-short .cal-meta{display:none}`), `:1903-1910`, `:1937-1941`; `web/calendar-model.js:7,29-31` (a block with a start but no `dur` is drawn 30 min, so `is-short`); `web/index.html:638-646` (Duration is optional); `web/calendar.js:96,101`; `/#plan` and `/#today`, all viewports.
- **Evidence:** measured: "No duration work" (+2) and "No duration rest" (−2) differ only by a 1px dashed border (`#a77a24` vs `#64825a`) and fills `#f1e9d9` vs `#e8ebe3` (ΔE 5.7 light, 2.8 under a deuteranopia simulation). With a tone chosen, two blocks differ only by the hue the person picked. All "Any time" chips are identical. In the seeded week 3 of 10 blocks hide their meta. `aria-label` and `title` do carry "−2 cost" / "+2 recovery".
- **Problem:** the test (does anything rely on colour alone to mean work versus recovery?) fails for every block of 30 minutes or less, every block without a length, every chip and every block the person has coloured. Duration is optional, so a timed block without a length is common.
- **Fix:** always render the signed cost as visible text: in `calendar.js:96` put `<b class="cal-cost">${signed(b.cost)}</b>` in the title row so `.is-short` hides only the time range (`.is-short .cal-time{display:none}`), and add it to chips (`:101`). Add a non-hue recovery cue that survives tones: add `is-recovery` to chips and use a hatch (`background-image:repeating-linear-gradient(135deg,transparent 0 6px,color-mix(in srgb,var(--tone,var(--green)) 18%,transparent) 6px 7px)`): hatched = recovery, plain = spend.

### A-H28. Planning ahead still assumes a Green day (earlier H5, re-verified and now repeated in the timeline)

- **Pass:** First-time user
- **Where:** `web/planner-model.js:21` (`logged ? capOf(day, settings) : (plan.allowance ?? settings.budget)`), `web/planner.js:755-759` (hint copy), `:793-801` (day header values), `web/index.html:605-616`; `/#plan`.
- **Evidence:** measured: budget 10, Amber −3, Red −6, poor sleep −3. After choosing Amber on Today, Plan's Today allowance is 7 (disabled); Tuesday's field is 10 with the hint "Your estimate for this day, including expected sleep or check-in effects." One 3-point activity for Tuesday gives "Tue | 7 | 1 planned | 7 points projected" and the same 7 in the timeline header, computed from an assumed 10. Typing a value by hand works only once the day has an activity (see A-C3).
- **Problem:** the three penalties set in Account are never offered when planning ahead, the hint claims they are included, and every future number on the strip, the timeline header and the tiles is a Green-day number.
- **Fix:** as the earlier H5: Green / Amber / Red chips and a Poor-sleep toggle under the field, calling the same patch with `capOf({statusPenalty, poorSleep}, settings)`; change the hint to "Starts at your full budget (10). Pick a day type to subtract your Amber, Red or poor-sleep amount." and show "assumes Green" in the day header tooltip until a type is set.

### A-H29. The Episode form's "how long it lasted" error is drawn in the success colour at 4.26:1, goes stale, and the start-time field silently blanks the duration

- **Pass:** Designer + First-time user
- **Where:** `web/episodes.js:290-295` (a start-time change blanks the duration), `:326-330` and `:332-337` (messages); `web/style.css:571-576` (`.toast` is green), `:679` (`.err` exists but is not applied), `:3049-3059` (sticky `.save-bar`); `web/dashboard.css:845-849` (`bottom:78px`); `web/tooltips.js:32` (`#ep-dur` tooltip); `web/index.html:501`; `/#episode`, 375.
- **Evidence:** measured by the History auditor and re-run by me at 375×812: setting "When it started" to three hours ago resets `#ep-dur` from "Still going" to the disabled placeholder with no word; Save then shows "Choose how long it lasted, or Still going if it hasn't stopped." in `rgb(100,130,90)` 16px/700 on `rgb(255,254,251)`, which is **4.26:1** and the same `.toast` class as "Saved.". After choosing "1–4 hours" the old error stays on screen. A future start gives the browser's own bubble ("Value must be 10/05/2026, 2:01 PM or earlier.") with the stale error still showing; an end before the start reads "End time must be between the start time and now, including the recorded time-zone offset." Nothing on the form marks any field required. The auditor also measured `focus()` scrolling the select to y 768–812 behind the fixed bars; in my run the field landed at y 384–428, so that part is position-dependent.
- **Problem:** the one required field is the most likely to be missed (changing the start to "this morning", the normal retrospective case, clears it without a word). When it is missed the app answers in the colour of success, in text that can wrap under a tooltip. A first-time user taps Save repeatedly and concludes it is broken.
- **Fix:** (1) every validation branch in `submit` (`episodes.js:326-337`, `:361`) adds `eptoast.classList.add("err")` and `role="alert"`; remove both and clear the text on the next `input`/`change` (`:299`). (2) In `@media (max-width:700px)` add `html{scroll-padding-bottom:280px}` and call `scrollIntoView({block:"center"})` before `focus({preventScroll:true})`. (3) When the start handler blanks the duration show a hint under the select ("Choose how long it lasted", `aria-invalid="true"`) and add "(required)" to the label. (4) Own the time copy: drop `max` from `#ep-when`/`#ep-ended`, keep `validateEpisodeTimes`, and say "Start time can't be in the future. Choose a time before now." The success-text colour is app-wide, see A-H43.

### A-H30. Episode "Save" does nothing on an untouched form, and a note-only save creates a symptom-less "Still going" episode that never expires

- **Pass:** First-time user
- **Where:** `web/episodes.js:324` (`if (ticket || (!editing && !dirty)) return;`), `:22-28` (default "Still going"), `:326-331`; `web/model.js:787-789` (`ongoingEpisodes`, no age limit); `web/index.html:539`; `/#episode`, `/#today`.
- **Evidence:** measured and re-run: on a fresh account the green full-width "Save episode" on the untouched form leaves `#eptoast` empty and creates nothing. Typing only "just a test note" and tapping Save gives "Saved." and stores `{"symptoms":[],"duration":"Still going","notes":"just a test note"}`; a "Still going (1)" panel then appears at the top of Today and Episode, dated "2026-10-05 14:49". A 60-day-old "Still going" episode still renders as "Still going (1)".
- **Problem:** the most prominent control on the tab does nothing and says nothing until a field changes, which reads as broken. The reverse is worse: because "Still going" is pre-selected, a stray note creates an open-ended episode that nags on two tabs forever.
- **Fix:** untouched Save → toast "Nothing to save yet. Tick what you noticed or add a note." and focus the first chip. In `submit`, if `!value.symptoms.length && !value.notes.trim()` say "Tick at least one symptom or write a note, so this episode means something later." Pre-select "Still going" only once a symptom is ticked. For the age cutoff see A-H31.

### A-H31. "Record when it ended" opens the full edit form and asks for a duration bucket; the end time is hidden until a select changes

- **Pass:** Designer + First-time user
- **Where:** `web/episodes.js:18` (button; banner prints `e.when.replace("T"," ")`), `:216-232` (`edit(..., finish)`), `:378-380` (`renderEnd`), `web/app.js:466-469`, `web/index.html:210` and `:460` (the two banners), `web/today.js:864`; `/#today` → `/#episode`, 375 and 1440.
- **Evidence:** measured on a seeded account: the Today banner's button goes to `#episode`, title "Edit episode", focus on `#ep-dur`, toast "Choose a duration, or Ended (duration unknown). An exact end time is optional." The "When it ended (optional)" row stays hidden until the select leaves "Still going". Minimum path is banner → open select → pick option → Save, four interactions, and the person is left in "Edit episode" on the Episode tab. The banner prints the raw ISO string "2026-10-04 20:30" while History prints "4 Oct 2026, 20:30". There is no age limit. The same state is "Still going" in the form and "ongoing" in the History filter.
- **Problem:** the label promises "record when", but the screen asks "how long it lasted" in a drop-down, hides the time, and strands you in a form. This is the only way to close an episode, so the persistent banner is also the product's one nag, and it never expires.
- **Fix:** replace the banner button with two inline controls, **"Ended just now"** and **"Ended at…"** (a `datetime-local` with `max=now`, default now), both dispatching the existing patch (`episodes.js:338-372`: `endedAt`, `endZone`, `endOffset`, and a `duration` chosen from `DURATIONS` by `endedAt − when`), then `ctx.toast("Episode ended 14:05.", {label:"Undo"})` and stay on Today. Format with `fmtWhen(e.when, locale)`. After 72 hours show "Started 6 Aug — still going?" with "Ended" / "Still going". Say "Still going" everywhere and rename the History filter "Still going only".

### A-H32. History can no longer show an episode beside a check-in or an activity: the earlier C4 fix was deleted in `dd201fc` and nothing replaced it

- **Pass:** Designer + First-time user
- **Where:** `web/history-matrix.js:70-89` (one metric per colour mode), `:192-195` (cell markup), `web/history-charts.js:20-87` (three separate charts; none puts episodes on the energy or check-in chart), `web/history.js:437-512`; `/#history`, all widths. Earlier audit C4.
- **Evidence:** `git show --stat dd201fc` deletes `web/history-week.js`, `web/week-model.js` and `test/week-model.test.mjs`; grep for "week view" in `web/` and `test/` returns nothing. Measured on a new account with one episode today and no check-in: the default calendar paints today as an empty "–" square while the facts row says "1 Episodes". Only "Colour by → Episodes recorded" shows it, and in that mode the check-in colours are gone. On a seeded account, 2 Oct has an episode (08:00) and its green cell carries no hint of it. The first-run line says squares fill in "when you check in or record an activity" and never mentions episodes.
- **Problem:** the product's pitch is energy next to symptoms, and History is where that comparison should happen. The person must flip the colour mode back and forth, or open each day, to ask "did this follow the heavy Tuesday?". C4's "can't see a symptom next to the activity before it" is open again.
- **Fix:** keep the chosen colour mode and add an episode dot to every cell: in `history-matrix.js:194` append `${c.episodes ? html`<i class="matrix-ep" aria-hidden="true"></i>` : ""}`; CSS `.matrix-cell{position:relative}` and `.matrix-ep{position:absolute;top:3px;right:3px;width:8px;height:8px;border-radius:50%;background:var(--fg);box-shadow:0 0 0 2px var(--surface)}`, plus a legend item "● Episode recorded"; hide the dot only in the dense heatmap. Add an "Episodes" row to the combined chart (`history-charts.js:89-107`). Mark C4's time/lane half open in the earlier audit.

### A-H33. The exports contradict each other on the sign of a cost and never say what a "point" or a colour is

- **Pass:** Designer + First-time user
- **Where:** `web/model.js:642` (Days CSV writes `(-2)` for a cost of 2), `:861-866` (`activitiesCsv`, raw `c`), `web/history.js:346` (print "Cost" column), `:341-342` (Days table), `web/index.html:745-749,765-769` (the on-screen sign note); History → Prepare a summary.
- **Evidence:** measured from downloaded files, same entry ("Meeting or call 08:30"): Activities CSV `cost_points` = **2**; Days CSV `points_used` = 3 but its `activities` cell reads "08:30 Meeting or call **(-2)**"; the printed summary says "Cost **−2 points**". A "Quiet break" is −1 in the Activities CSV, "(+1)" in the Days CSV and "+1 points" in the PDF. The panel's note ("Activity costs are positive for spending, negative for recovery") is true for one of the three. Nothing defines "point", `points_available` or green/amber/red; the PDF prints "3 of 1" for a day whose allowance was 1 and carries no name or identifier.
- **Problem:** a GP, or the user in a spreadsheet, gets two opposite signs in one pair of files; a column headed "Cost" showing "−2" for something that drained you reads as a gain. For a health record that is a trust problem, and a clinician has no key to the colours or the budget.
- **Fix:** machine exports use spend-positive everywhere. `daysCsv`: add `points_spent`, `points_recovered`, `points_net`, and write the packed cell in words ("08:30 Meeting or call (spent 2)", "12:40 Quiet break (recovered 1)") at `model.js:642`. Print table (`history.js:346`): header "Effect on balance", values "Used 2" / "Recovered 1", singular "1 point"; Days table "3 used · allowance 1 (2 over)". Append before the small print: "Green, amber and red are the person's own rating of their energy when the day started (green = good, red = low). Points are the person's own daily energy budget, not a medical measure; ‘net points used’ is spent minus recovered." Add an opt-in "Include my name" tick next to the notes toggle.

### A-H34. On a phone the History calendar is tappable for 30 days only: 90/180/365 days are 19/9/4px cells with no letters

- **Pass:** Designer
- **Where:** `web/history-matrix.js:46-49`, `:104-105` (`limit = () => 366`), `:160` (dense flag), `web/style.css:2710-2745` (`.matrix-dense … .matrix-mark{display:none}`); `web/index.html:735-743`; `/#history` ≤700px. Updates the earlier H9/C4.
- **Evidence:** measured cell sizes at 375 / 320 / 768 / 1440: 30 d 46 / **40** / 88×58 / 88×58; 90 d **19** / 16 / 41 / 41; 180 d **9** / 8 / 20 / 20; 365 d **4** / 3 / 9 / 9. When dense (>13 weeks on a phone) the G/A/R letter is hidden, so green and red differ only by colour. The profile can make 365 days the default. The "Include private episode notes" and "Include activity detail" toggles are 13px boxes in 23px-high rows.
- **Problem:** the day-selection model (tap a square) silently stops working above 30 days, and colour-only encoding returns exactly where a colour-blind user most needs the letter. The "Choose a day" select is the only way left and nothing says so.
- **Fix:** `history-matrix.js:105` → `limit = () => (compact.matches ? 35 : 366)`; the Earlier/Later bar that already exists (`:110`, `:218-222`) pages the rest. On desktop never drop the letter: replace `.matrix-dense … .matrix-mark{display:none}` with a hatch for amber and a cross-hatch for red. Give the share-panel `label.toggle` rows `min-height:44px`.

### A-H35. On a stale device, moving or recolouring a Fretboard card silently reverts the other device's change to that card

- **Pass:** Designer + First-time user (trust)
- **Where:** `web/fretboard-model.js:89-103` (a patch replaces the whole item: line 100 `board.items[id] = normaliseItem(value)`), `web/fretboard.js:255-262` (`setStatus` sends `{...item(id), s}`), `:375-386` (`moveSelection`), `:601-605` (text edit), `:165-176` (undo restores whole-item snapshots). The header comments (`fretboard.js:1-3`, `fretboard-model.js:89-91`) promise "two devices never overwrite each other's cards".
- **Evidence:** measured by the Tools auditor with two browser contexts and a 4-card board: device 2 goes offline, drags "Item X" and "Item Y", deletes "Item Z"; meanwhile device 1 sets X to Done and renames Z. On reconnect (409 → replay) X = `todo` at device 2's position (**device 1's Done is gone**), Y moved, Z deleted (device 1's rename gone). No toast, no Recovery entry. The code path is confirmed by reading `applyBoardPatch`.
- **Problem:** the app's headline promise (queue offline, replay on the server copy) loses a status change made on another device with no trace. Tick Done on the phone, drag the same card on a stale laptop, and the tick is undone.
- **Fix:** make item patches field-level. In `applyBoardPatch` add `arg.fields` (id → partial fields) next to `arg.items`: `for (const [id, f] of Object.entries(arg.fields || {})) if (board.items[id]) board.items[id] = normaliseItem({...board.items[id], ...f});` (a patch for a deleted item is dropped, so a delete wins and nothing resurrects). Send only what changed: drag/nudge `{x,y}`, `setStatus` `{s}`, text edit `{t}`, restack `{z}`, convert `{k,s}`; build `inverse()` from the same fields. Add a model test: `{s:"done"}` and `{x,y}` on one item both survive in either order.

### A-H36. Fretboard cards paint over the sticky tab bar and over the "Card removed. Undo" toast

- **Pass:** Designer
- **Where:** `web/fretboard.js:423` (`el.style.zIndex = String(10 + (src.z || 0))`), `web/fretboard-model.js:190-191` (`nextZ` = max+1, never reset), `web/fretboard.js:306-320`, `web/tools.css:359-384` (no stacking context on `.fb-canvas`) vs `web/style.css:148` (nav z 5), `:998-1013` (`.toastbar` z 20), `web/tools.css:668` (`.fb-menu` z 60); desktop.
- **Evidence:** measured by the Tools auditor and re-run by me. With cards at z-index 32 and scrolled so a card sits at viewport y 34, `elementFromPoint` inside the tab bar (y 12–74) returns the card. With a card placed under the toast (card z 40, toast z 20), the Undo button's centre is covered (the element at that point is `fb-text`) and Playwright's click on Undo is blocked: "`<span class="fb-text">Sits under the toast</span>` … subtree intercepts pointer events". Thresholds: any card beats the tab bar, z≥11 beats the toast, z≥51 beats the menu, and `z` only grows. On a 400-card board 6 of 6 menu items were covered.
- **Problem:** the destructive action's only on-screen undo can be unclickable, cards visibly slide over the navigation on scroll, and on a busy board the context menu is partly under cards.
- **Fix:** add `isolation: isolate;` to `.fb-canvas` (`web/tools.css:269`). The Tools auditor verified by injection that the tab bar then wins; optionally re-rank `z` densely in `nextZ`.

### A-H37. Phone Fretboard: the board sticks out of its card and widens the page, cards are 102px wide, the canvas swallows swipes, and double-tap never edits

- **Pass:** Designer + First-time user
- **Where:** `web/tools.css:170-174` (`.fb-board` has an `auto` grid track), `:190-192` (`.fb-axis-x{margin-left:34px}`), `:221-237` (nowrap labels), `:284` (`touch-action:none` on the whole canvas), `:293-298` (`aspect-ratio:3/4; min-height:360px`), `:363-369` (`.fb-item{max-width:min(34%,260px)}`); `web/fretboard.js:810` (`preventDefault` on card `pointerdown`), `:939-948` (editing needs `dblclick`), `:798-808,824-834` (550ms long-press menu); `/#tools` → Fretboard, 375 and 320.
- **Evidence:** measured. 375×812: canvas right edge x=377 while the card ends at 355, so `innerWidth` becomes 377 (the page pans); at 320 the canvas edge is at 358 and right-hand cards are cut off. Cards are 102px wide on a 302px canvas (~12 characters per line): a 240-character card is 102×565px and gets clipped. A 200px upward swipe starting on empty canvas leaves `scrollY` unchanged (567→567) while the same swipe on the left axis strip scrolls. Double-tap on a card yields `click, click` and no `dblclick`. The shipped example collides ("Daily walk" over "Finish the course").
- **Problem:** the phone view of a text-first tool is visibly broken at 320–375 and unreadable beyond a handful of short cards; people cannot scroll past the board they are looking at, and the only way to edit text on a phone is a long-press menu that nothing on screen mentions.
- **Fix:** `.fb-board{grid-template-columns:minmax(0,1fr)} .fb-axis-x,.fb-axis-label{min-width:0}`; in `@media (max-width:600px)`: `.fb-canvas{min-height:0;min-width:0} .fb-axis-x{margin-left:0} .fb-axis-x .fb-arrow{display:none} .fb-axis-label{font-size:.68rem;letter-spacing:0;padding:2px 4px} .fb-item{max-width:62%} .fb-item:not(.is-selected):not(.is-editing) .fb-text{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}`. Then `.fb-canvas{touch-action:pan-y} .fb-item{touch-action:none}`, skip the marquee for `pointerType==="touch"` on empty canvas, and treat a non-moved tap on an already-selected card as "edit" in `endPointer` (`:897`). The auditor verified these by patching the served files: canvas 259×345 at 375 and 224×299 at 320, `innerWidth` unchanged, tallest card 71px, and the swipe scrolls (567→777) while a finger drag still moves a card.

### A-H38. Fretboard hides its save, offline and error states, and a refused save removes the card from view

- **Pass:** First-time user
- **Where:** `web/style.css:3105-3125` (`#sync` is `position:absolute` under the header and scrolls away), `web/app.js:568-634` (`paintSync`, recovery), `:630-632` ("Edit a recovered copy" only for `settings` and `e-…`), `web/fretboard.js:178-191` (`commit` has no failure path); desktop.
- **Evidence:** measured. Offline: the pill says "2 changes queued on this device. Will retry when connected." but with the board on screen it is off-screen (bottom −445 at `scrollY` 558); the board shows nothing. PUT forced to 500: three attempts in 4s, then the same off-screen pill, the card stays drawn, no toast. PUT forced to 400: **the card disappears from the board** with no toast; the Recovery panel (document y 83–442) says "t-fretboard — item text is limited to 240 characters. [Retry] [Discard]" with no way to edit the text.
- **Problem:** offline-first is a headline feature, yet at the board the person cannot tell whether cards are saved, and a refused change removes their work from view with a message naming an internal id.
- **Fix:** add a status line next to `#fb-summary` fed by `ctx.store.status()` in `render()` ("Saved on this device, not yet sent (2 changes)" / "Couldn't save — your change is kept in Recovery. [Show]"); keep a refused item drawn with a "not saved" outline until retried or discarded; in `app.js:632` give `/^t-/` ids an "Edit a recovered copy" and list tool docs by name ("Fretboard board"). The app-wide second-tab version of this is A-H47.

### A-H39. "+ Card" and typed today's-three entries land on a fixed 20-slot cascade, so a brain dump piles up on itself

- **Pass:** Designer + First-time user
- **Where:** `web/fretboard.js:1053-1060` (`x = 0.56 + (n%4)*0.05`, `y = 0.12 + ((n*7)%5)*0.06`, n = item count), `:264-286` (`cardFor`, same formula), `:220-241` (`addItem` only clamps).
- **Evidence:** measured: 21 cards via "+ Card" on a fresh board give **26 overlapping pairs**; card 21 is saved at exactly (0.56, 0.12), card 1's position, and most labels read "Th…". Typing "Ten minutes outside" into today's three placed it over "Sleep". Overlap starts around the 6th card.
- **Problem:** the core use is "lay it all out", adding many things fast. The tool covers its own cards, and every new card is pre-judged as "in your hands, matters most", the question the tool exists to ask.
- **Fix:** place by free space: in `addItem` (no pointer position) and `cardFor`, scan a 0.08×0.08 grid from the middle (0.42, 0.42), left to right, top to bottom, and take the first cell whose ≈0.17×0.07 rectangle intersects no existing item; fall back to the cell with fewest overlaps. Keep the midline default so the person decides the side.

### A-H40. A sixth top-level tab for one tool, a launcher that does not say what the tool does, and a first screen that is mostly header

- **Pass:** First-time user + Designer
- **Where:** `web/index.html:144-155` (`#t-tools`), `:80-93` (masthead), `:835-856` (tools panel; launcher `h2` `:838`; stage header `:846-853`), `web/tools.js:16-31` (placeholder `aria-hidden` at `:26`), `web/tools.css:33-43` (`.is-soon`), `web/fretboard.js:30-38` (`meta.description`); `/#tools`.
- **Evidence:** measured. Tab width with vs without Tools: 320px → 41 vs 51px; 375px → 50 vs 62px; at 320 "Episode", "History" and "Account" overflow their 41px buttons (verified by me), and for an admin the seven labels collide. Path to the first card: Tools → the one card → scroll. Empty board at 1440×900: toolbar y 560–606, canvas top 648, empty-state button y 976 (below the fold); at 375×812 only 23px of board show above the fixed nav. The launcher's H2 and the page H1 are both "Small tools for heavy days."; the card says "A board for the things on your mind. Drop each one where it belongs, colour it by where it stands, and keep what is not yours in its place." (three abstract clauses); "Fretboard" reads as guitar, explained only in a 10px eyebrow. The dashed "NEXT — More tools, in time" tile is `aria-hidden`, does nothing, and takes half the grid. Tools is absent from the landing, the public pages and the first-run checklist.
- **Problem:** a one-tool menu is navigation debt in the primary nav: it costs every phone user tab space, adds a destination unrelated to the first-session path, advertises features that may never ship, and the tool's first screen is headings and a corner of an empty grid.
- **Fix:** until a second tool exists remove `#t-tools` from `#tabs` and open Fretboard from an account-menu item beside `index.html:54` (`data-menu-go="tools"`); skip the launcher when `TOOLS.length === 1`; delete the `.is-soon` tile (`tools.js:26-30`, `tools.css:33-43`). Move `data-heading`/`data-description` to `#tools-panel` and read them there in `go()` (`app.js:386-394`). Drop the stage's second header panel: put "‹ All tools" in the toolbar row and `scrollTo({top: canvas.offsetTop - 80})` on `open()`. Card copy: "Sort what is weighing on you on a simple map: right = in your hands, up = matters now. Then pick today's three." with a 120px SVG of the 2×2 map. If the tab stays: `nav button{padding-inline:4px}` at ≤380px.

### A-H41. Fretboard's status pills look like a palette but are filters, and recolouring, editing and deleting hide behind right-click, number keys or a long-press

- **Pass:** First-time user
- **Where:** `web/fretboard.js:63-68` (legend), `:1041-1049` (a pill click hides/shows that status), `:679-710` (menu), `:445` (`has-selection` is toggled but has no CSS rule in `web/tools.css`), `:98` (canvas `aria-label`), `web/help.js:42` (the only mention of "press and hold").
- **Evidence:** measured: select "Pay council tax" (In progress), click the "Done" pill: the card's status stays `fb-s-doing`, the pill goes struck-through (`aria-pressed=false`) and three other cards dim. Nothing visible says how to set a status: the launcher says "colour it by where it stands", the empty state only mentions double-click and "+ Card", and tapping a card draws only a ring. A card added while "Not started" is hidden is born dimmed (opacity .28, `pointer-events:none`) and untouchable.
- **Problem:** the only visible controls named after statuses do the opposite of what a first-timer expects, so cards stay "Not started" (red) and the board reads as a pile of alerts.
- **Fix:** when a card is selected (the `.fb.has-selection` hook already exists) show an action row under the toolbar with four status buttons (swatches, "Set: Not started · In progress · Done · Not my problem"), "Edit", "Add to today's three" and "Delete"; label the legend "Show:" and separate it; clear the `hidden` filter for a just-created or edited card's status; add to the empty state "Right-click a card (press and hold on a phone) to colour it."

### A-H42. Fretboard's keyboard and screen-reader path has five holes

- **Pass:** First-time user (accessibility on the main path)
- **Where:** `web/fretboard.js:78-92` (axis rows `aria-hidden="true"` containing `<button class="fb-axis-label">`), `:467-478` (the three list is rebuilt via `setHTML`), `:472` (checkbox name `Done: ${t.t}`), `:395` (`tabIndex = 0` on every card), `:23` (`NUDGE = 0.01`), `web/tools.js:34-54` (`open()` moves no focus).
- **Evidence:** measured by the Tools auditor. (1) Four focusable axis buttons sit inside `aria-hidden`: Tab stops 9–12 of 20 land on them. (2) Space on a today's-three checkbox leaves `activeElement` on BODY. (3) Enter on the "Fretboard" launcher card leaves focus on BODY. (4) Every card is a Tab stop (400 on the 400-card board); the checkbox is named "Done: …" ticked or not; a filtered, dimmed card is still focusable and Delete removes it. (5) Moving a card without dragging means 1% nudges (about 50 presses to cross the canvas); there is no click or menu way to move (WCAG 2.2 SC 2.5.7).
- **Problem:** a keyboard or screen-reader user can add and edit cards but loses focus after common actions, tabs through hidden controls and cannot move a card efficiently.
- **Fix:** (1) remove `aria-hidden` from the axis rows and label the buttons ("Rename left axis label: Out of my hands"). (2) In `renderThree` remember `document.activeElement?.dataset.threeDone` and refocus it after `setHTML`. (3) After `open(id)` focus `#tool-title` (`tabindex="-1"`). (4) Only the selected (or first) card `tabindex=0`; add a visually hidden "Skip board" link (`href="#fb-three-title"`); label "Mark done: …"; ignore dimmed cards in `focusin` and `removeItems`. (5) Add "Move to ▸ In my hands, matters most / …" to the menu (`:679-710`) and keys Q/W/A/S.

### A-H43. Save confirmations and validation messages sit under the button and out of sight on phones, and the success green fails contrast at 4.26:1 app-wide

- **Pass:** Designer + First-time user
- **Where:** `web/account.js:27-30` (`say()` sets text and class only, no scroll or focus); each `.msg` is below its button at `web/index.html:1052,1085,1161,1179,1207`; `web/account.js:101-121`, `web/profile.js:164-184`, `web/editor.js:26,284`; `web/style.css:820-828` and `:63` (`--green: #2e8a57`), `:571-576` (`.toast`); `web/dashboard.css:820-828` (fixed tab bar, bottom 10px, 62px tall). The sticky pattern that exists but is not used here: `.save-bar` (`web/style.css:3044-3057`, `web/dashboard.css:845-849`, used at `web/index.html:538`).
- **Evidence:** measured at 375×812. Forced password screen, mismatched passwords, tap "Change password": `#pw-msg` is at y 814–841 and the viewport ends at 812, `scrollY` stays 0, so nothing visible happens. "Save profile": `#profile-msg` ("Saved.") is at page y 2,913 while the viewport bottom is 2,910 and the fixed tab bar covers the strip above it; the only visible change is the theme flipping. "Save settings": the message is 37px above the tab bar, visible by luck of scroll position. Success `.msg`/`.toast` text measures **4.26:1** on `#fffefb` in light (fails 4.5:1 for 16px bold); dark is 7.5:1. The Episode form has the same colour problem (A-H29).
- **Problem:** on a phone the person taps Save and either nothing seems to happen or the confirmation is hidden under the navigation. After a failed password change, the first action every invited person performs, there is no visible reason. People tap twice or distrust saves in a health log.
- **Fix:** one `report(el, text, bad)` helper in `account.js` that does what `say()` does, then for errors calls `el.scrollIntoView({block:"center", behavior: reduced ? "auto" : "smooth"})` and, at ≤700px, `ctx.toast(text)` (the toast bar already floats above the tab bar, `style.css:3271-3273`). Wrap the action rows of `#profile-form` (`index.html:1046-1052`) and `editorMarkup` (`editor.js:26`) in `<div class="save-bar">`. For the password form use `$("pw-new2").setCustomValidity("The two new passwords don't match."); $("pw-new2").reportValidity();` and move `#pw-msg` above the submit button. Add `--green-text:#26774a` (5.4:1 on `#fffefb`) and use it for `.msg` and `.toast`.

### A-H44. Two-step setup asks for the password a second time after you have scanned the code, and the on-screen steps never say so

- **Pass:** First-time user
- **Where:** `web/security.js:8` (steps), `:9` (label), `:56-98` (`action()` reads the password at 57-61 and clears it at 74 *before* the request); `two_factor.go:186` (every action, including `enable`, re-verifies the password); Account → Sign-in security.
- **Evidence:** measured: password typed, then "Set up authenticator": QR and key shown and `#security-password` is now `""`. Typing the code and pressing "Confirm & enable" gives "Enter your current password to continue." A wrong code gives "Enter the six-digit code from your authenticator app." **and clears both the password and the code**. The key is one unbroken 32-character string; the code box is labelled "Authenticator or unused recovery code" while no recovery codes exist yet.
- **Problem:** type password, switch to the authenticator app, scan, type the code, tap confirm, then be told to enter the password that is now empty, on a phone where that field is a screen above the QR. The instructions omit it, and a typo wipes both fields again. People abandon an optional security step on the second unexplained failure.
- **Fix:** keep the password in the field for the 10-minute setup window: in `security.js:73-75` clear `#security-password` only after `enable`, `cancel`, `disable` or `regenerate` succeed. Rewrite step 2 as "Enter the six-digit code from the app, then press Confirm & enable." While `pending` label the code box "Six-digit code from your authenticator app". Show the key grouped in fours (`secret.match(/.{1,4}/g).join(" ")`) with a Copy button.

### A-H45. Admin row actions fail silently: both the error and the success message are erased by the list refresh

- **Pass:** First-time user (operator)
- **Where:** `web/admin.js:467-541` (row-action handler; `confirm()`/`prompt()` run at 490-495, 504-509, 516-521, 528-531 **before** the password is checked), `:367-381` (`confirmation()` empties the field and focuses it), `:382-392` (`loadUsers()` begins with `say(target, "Loading people…")`, then "Updated hh:mm:ss"), `:537-539`.
- **Evidence:** measured on the shared server. Click Disable with the "Confirm an admin change" field empty and accept the confirm: a `MutationObserver` on `#users-msg` sees `""` → "Loading people…" → "Updated 2:38:16 PM." The error "Enter your password to confirm this change." is never painted, and the page jumps from scrollY 1,844 to 90 (focus moved to `admin-confirm-pw`) with no explanation. Delete with a wrongly typed username gives "Updated 2:23:39 PM." instead of "Type the username to confirm." Successes ("… was deleted.", "… was signed out everywhere.") are erased the same way.
- **Problem:** the step-up password lives in a panel above the list, 1,800+px from the buttons it authorises (about 19,000px on a phone with 75 accounts), and its absence is discovered only after a native confirm, after which the page teleports with no message. Every failure of reset, disable, promote and delete, including "That would leave no active admin", is invisible. An admin cannot tell whether a destructive action happened.
- **Fix:** check `$("admin-confirm-pw").value` first; if empty, `say(msg, "Type your password in “Confirm an admin change” first.", true)` and scroll that panel into view before any dialog. Stop `loadUsers()` overwriting the status (add `loadUsers({quiet:true})` that skips `:385`, or set the message after `await loadUsers()`). Better: replace the shared password panel with a per-action `<dialog>` like the existing reset dialog (`admin.js:74`, `:485`) that asks at click time. Unify the five admin password fields (three labels at `admin.js:74-75,104,122` and `services.js:30`, two behaviours: cleared on every use vs remembered 30 minutes; Help says "each time", `help.js:91`).

### A-H46. The one-time temporary password lands out of sight, and "Add someone" is the last thing on the page

- **Pass:** First-time user + Designer
- **Where:** `web/admin.js:91-96` (reveal block inside the "Add someone" panel), `:138` (`panels: ["users","adduser"]`), `:442-448` (`reveal()` shows it, no scroll or focus), `:556-563`; `web/style.css:1222-1225`.
- **Evidence:** measured. Private instance with 3 people at 1440×900: after "Create account", `#reveal` top is 965px against a 900px viewport. Shared server with 76 people, Reset password on a row at scrollY 1,888: `#reveal` is at y 965–1,402, not in view. At 375 "Add someone" is at y 2,040 with 3 people and **21,505** with 76 people. The password wraps mid-token ("Bsd4 / -dqtu-twkJ-wnk2") and the reveal is not a live region (only "Created acct-made-d." is announced).
- **Problem:** the credentials are "shown once". An admin who resets someone's password far down the list sees no change except a refreshed timestamp, and the password is outside the viewport; missing it means resetting again and signing the person out a second time. On phones the primary action of People is beneath the whole directory.
- **Fix:** `reveal()` opens a modal `<dialog id="reveal-dialog">` (like `#factor-reset-dialog`) with the text, a Copy button that has focus, and "Hide"; put the password in a `<kbd>` with `user-select:all; white-space:nowrap`; reorder `ADMIN_SECTIONS.people.panels` to `["adduser","users"]`; cap `#users` at 20 rows with "Show more" (rows are 241px at 1440 and 265px at 375: 75 accounts gave a 19,368px page).

### A-H47. A second browser tab is silently dead: it looks editable, ignores input, and says nothing

- **Pass:** First-time user
- **Where:** `web/app.js:218-234` (capture-phase handler calls `preventDefault()` and `stopImmediatePropagation()` on every button, input and form outside a short allow-list), `:235-252` (the only cue: a one-line notice above the tab bar), `:607-608` (the same sentence again in `#sync`); Plan `web/planner.js:818-826`, `web/dashboard.css:2142-2145`; Fretboard `web/fretboard.js:154-163,516-527`.
- **Evidence:** measured by three auditors. With the app open in one tab, a second tab shows the full UI. Today: clicking Green leaves `aria-pressed` false with no toast. Account: typing into Display name leaves `value === ""` and "Save profile" does nothing. Fretboard: of 14 actions, 4 show "Use the active Jiggered tab to make changes." and **8 do nothing and say nothing** (the context menu even opens and its items do nothing). Plan: the help line still reads "Drag an activity to move it…", the palette keeps `cursor:grab`, and clicks on chips, blocks and slots do nothing. The notice sits at the top of the page and scrolls away; the same sentence appears twice.
- **Problem:** opening the bookmark while another tab is open (or the installed app plus a browser tab) is routine. The second tab renders identically to a live one, so the person's effort is silently discarded in a health log and "is the app broken?" is the natural conclusion.
- **Fix:** when the handler blocks something call `ctx.toast("This tab is read-only: another Jiggered tab is editing. Close it and press Reload to edit here.")` at most once every 3s; add `document.body.classList.add("read-only-tab")` with `.read-only-tab :is(button,input,select,textarea):not(.safe){opacity:.55;cursor:not-allowed}`; make the notice sticky (`position:sticky;top:0;z-index:7`) and drop the duplicate from `#sync`; set the Plan and Fretboard help lines to "This tab is read-only…", mark `#plan-palette` `inert`, add `[data-cal-day]` and `#fb-legend` to the allow-list (`app.js:225`), and disable the Fretboard toolbar buttons when `!writable()`.

### A-H48. The activity and list editor is 224px per row on a phone, the points box has no visible label, and validation errors are out of sight

- **Pass:** Designer + First-time user
- **Where:** `web/editor.js:35` (row markup), `:280-299` (`validate()`), `:26` (message line at the end of the form); `web/style.css:1106-1114,1227-1239,1516-1522` (row layout and the ≤480px wrap); `web/model.js:744-758` (messages).
- **Evidence:** measured. Rows are 64px tall at 1440 and **224px at 375**; the open "Activities" section is 1,926px (1440) and **5,857px (375)** for 24 defaults. The points box has only an `aria-label`; there is no header row at either width. Adding a duplicate "Meeting or call" and pressing Save gives "Use distinct **activities names** (including capitalisation)." under the last button, focus jumps to the first row, and a red outline surrounds all 25 rows. An empty name gives "Each **activities name** needs 1–60 characters." Cost 11 is blocked by native validation, so the JS never runs and the previous message stays on screen. Row buttons are 40×44.
- **Problem:** the points-per-activity table is what the whole product computes from. On a phone it is a 5,857px column of three stacked fields per item with no visible label for the number. A mistake gets an unspecific sentence with broken grammar, shown a screen or more away from where focus lands, with the whole list marked invalid instead of the offending row.
- **Fix:** phone layout `.order-row{display:grid;grid-template-columns:44px 1fr 72px}` with the group input on a second line (≈110px per row, ≈2,700px for 24); a header line "Name · Points · Group"; in `validate()` mark the specific row (`aria-invalid` on the duplicate's input), render the message inside the open `<details>` (new `[data-list-msg]`) and focus that row, not row 1; singular nouns in `model.js:754-758` (`{activities:"activity", symptoms:"symptom", triggers:"trigger"}`); `form.noValidate = true` on `#setform` so custom messages always show.

### A-H49. Account is ordered by what was cheap to build, and the energy allowance is the fifth of eight panels

- **Pass:** Designer + First-time user
- **Where:** `web/index.html:858-1210` (panel order), `:879-886` (shortcut chips), `web/account.js:89-98` (chip handler), `web/profile.js:40-53` (hero), `web/style.css:122-129`.
- **Evidence:** measured on a fresh account (y at 1440 / 375): hero 382 / 297; chips 693 / 661; Make it yours 811 / 889 (1,543 / 2,114px tall); Change password 2,375 / 3,025; Sign-in security 2,865 / 3,527; Devices 3,822 / 4,517; **Energy & personal lists 4,037 / 4,721**; Your data 4,723 / 5,641; Delete 5,844 / 7,115. Page 6,305 / 7,651px. The first editable control (profile photo input) is below the fold at both sizes. Chip order differs from page order. "Save profile" and "Save settings" are 2,347 / 2,502px apart and nothing in Account is sticky. Three of six chips move focus to a help "?" button, not the first field. There is no "Sign out" in the Account page, only in the avatar menu in a header that scrolls away. The hero repeats the username three times and shows "0 check-ins / 0 activities / 0 episodes" on a new account.
- **Problem:** README step 4 is "Set your energy allowance … in Account". That control is behind a photo uploader, a display name, a "what I'd like to notice" box, region, appearance and an energy-language picker, under a trophy card of zeros. A person who wants to leave must scroll back to the top.
- **Fix:** reorder to a compact hero (title only; hide stats until the first check-in) → **Energy & personal lists** → Profile (split into "You" = photo/name/focus and "Display" = appearance, energy language, region, history period, weekly review in a `<details>`) → Password → Sign-in security → Devices → Your data → Privacy → Delete. Make the chips follow the page order and focus the panel heading (`tabindex="-1"`), not `querySelector("input,select,textarea,button")` (`account.js:97`). Put Save rows in `.save-bar` (A-H43). Add "Sign out" to the Devices panel. Target at 375×812: first form field above y 700, Energy & lists above y 1,200.

## 3. Nice to have

Polish, consistency and small honesty fixes. Measurements are folded into the Problem line.

### A-N1. The hero headline's tracking collapses the word spaces

- **Pass:** Designer
- **Where:** `web/presence.css:160-166` (`.hero h1{letter-spacing:-0.065em}`); `/welcome`, 1440 (76px) and 375 (44px).
- **Problem:** measured letter-spacing is −4.94px at 76px, so a space renders 11.2px wide (0.15em) and the first words every visitor reads look cramped ("Trackyour energy", "Atyour pace.").
- **Fix:** `letter-spacing:-0.045em; word-spacing:0.12em` (the generic `.presence h1` is already −0.045em at `:21-27`).

### A-N2. The button system is fragmented across three stylesheets, and `↗` marks buttons that do not leave the page

- **Pass:** Designer
- **Where:** `web/presence.css:98-135` (`.p-button`), `web/style.css` (`button.primary/.secondary/.ghost/.x`), `web/dashboard.css`; `web/landing.html:34-45,88-98,112-121,367-378`, `web/login.html:91-103`; `web/login.js:20` (the CTA copy is rewritten at runtime).
- **Problem:** computed primary heights are 57 (hero), 52 (choice card), 51 (auth), 59 ("Use this allowance", whose 12.8px label wraps onto two lines) and 45 ("Other activity"); radius is 8px everywhere except auth `button.primary` at 7px; label size is 16/14/16/12.8px. `↗` means "opens elsewhere", yet "Sign in ↗" and "Create your free account ↗" do not.
- **Fix:** one `.btn` base in `style.css` (`min-height:48px; padding:12px 20px; border-radius:8px; font:700 16px/1.2 var(--body); white-space:nowrap`) with `.btn-primary/.btn-secondary/.btn-quiet`; map `.p-button`, `button.primary`, `button.secondary` onto it; shorten "Use this allowance" to "Save"; use `→` or no icon on in-site actions and keep `↗` for the GitHub link.

### A-N3. Template tells and vague copy on the landing page, and a voice that turns defensive one click later

- **Pass:** Designer + First-time user
- **Where:** `web/landing.html` (seven eyebrows and six two-line `<br>` headlines in one rhythm), `web/login.html:43-53`, `web/index.html:83-93`; all `web/public/*.html`.
- **Problem:** eyebrows such as "A LITTLE CLARITY. A LITTLE MORE YOU.", "THE LITTLE THINGS ADD UP", "TWO WAYS TO MAKE IT YOURS", "PERSONAL MEANS PERSONAL"; headlines such as "Your rhythm. Your choice." and "A little more clarity."; the tagline family ("Patterns, not pressure.", "Small moments. A clearer picture.") repeats on landing, auth and every app tab; "(a) little" appears 17 times across surfaces. The hero never says what is distinctive (a daily energy budget you plan around) or who it is for. On the content pages 50 of 202 sentences (25%) are disclaimers (Spoon Theory 12 of 25), pricing spends its second paragraph on "This page does not promise a support response time…".
- **Fix:** hero H1 "Plan your day around the energy you actually have." Sub: "Check in each morning, log what costs energy and what gives it back, and see which days and triggers add up. Free, private to your account, works on your phone." Rename "Your rhythm. Your choice." → "Use ours, or run your own." with cards "Hosted" / "Self-hosted". Drop three eyebrows and cap "a little" at one per page. Keep the safety statements verbatim in three places only (the symptoms page's closing section, the footer, one boxed "What Jiggered is not" list on `/docs/getting-started`) and delete the per-paragraph hedges. Pricing → H1 "Free.", lead "No plan to pick, no card to enter, no ads. Your account is yours; the code is MIT, so you can run your own.", and move the operator-cost and no-warranty paragraphs to the README.

### A-N4. Public pages and sign-in force light mode while the app follows the OS, and there are no print styles

- **Pass:** Designer
- **Where:** `web/landing.html:2`, `web/login.html:2`, `web/public/layout.html:77` (`data-theme="light"`), `web/presence.css:1-13` (`color-scheme: light`) vs `web/style.css:70-100`, `web/dashboard.css:19-38`; no `@media print` in `public*.css` or `presence.css`.
- **Problem:** with the OS in dark mode the landing and register body is `rgb(248,249,244)` and the app `rgb(23,34,28)`: a bright page, then a dark app after sign-in, for a product whose own symptom list includes "Light sensitivity". `page.pdf()` of `/docs/export-and-share` prints the header, nav, closing CTA and footer, and the white-on-green button text is near-invisible without background graphics.
- **Fix:** drop the hard-coded `data-theme`; add `@media (prefers-color-scheme: dark){.presence{--bg:#17221c;--surface:#1f2d25;--fg:#e6efe4;--muted:#b4c4b6;--line:#2c3d33;--accent:#8fc29f;--accent-soft:#22332a;color-scheme:dark}}` and override the hard-coded `#285c46` / `#203c31` surfaces (`.p-button`, `.closing`) so buttons invert. Add `@media print{.skip-link,.site-header,.public-next,.site-footer nav{display:none!important}.public-article{max-width:none}}`.

### A-N5. Small auth details

- **Pass:** Designer
- **Where:** `web/login.html:183-193` (reset asks everyone for an authenticator code), `:214-220` (code input), `:135-137` (password hint), `web/landing.html:45` ("Take a look ↓"), `<meta name=theme-color>` (`#2f6f62` app/auth, `#edf2e7` public).
- **Problem:** every person resetting a password sees a two-step field that only some have; the hint invites passphrases the server then refuses (`checkPassword` caps at 72 bytes); "Take a look" scrolls to a preview that is already beside it at 1440; the browser bar changes colour between the landing page and sign-in.
- **Fix:** reveal the code field only after the token lookup says 2FA is on; for the code input use `autocapitalize=none spellcheck=false enterkeyhint=done` (not `inputmode="numeric"`, recovery codes are not digits only); hint "Use 8–72 characters."; hide the demo link ≥1100px; one `theme-color` for all entry points.

### A-N6. Verify and reset result screens keep stale instructions, an orphaned hint and a focus box

- **Pass:** Designer
- **Where:** `web/login.js:169-179` (success hides only `label,.password-toggle` and the submit button), `:151-160`, `:53-54` (programmatic H1 focus), `web/presence.css:32-35`, `web/login.html:167,191,198-208`.
- **Problem:** verify success keeps the H1 "Verify your email" and the paragraph "Confirm this address… expire in 30 minutes" beside two buttons; reset success keeps "Choose a new password", "Your devices will be signed out…" and the orphan hint "Required only if two-step verification is enabled on your account." above the success line with no field; arriving from the email draws a 3px orange box around the H1 that reads as an error highlight.
- **Fix:** on success set `form.querySelector("h1").textContent = which === "verify" ? "Email verified" : "Password changed"`, hide every `.meta` paragraph and `[data-signin]`, keep one primary "Sign in"; add `h1[tabindex="-1"]:focus{outline:none}`.

### A-N7. The public header leaves out Privacy and "how it works", has no current-page state, and the footer repeats it under different names

- **Pass:** Designer
- **Where:** `web/public/layout.html:36-75`, `web/public.css:1-60,161-197`, `web/presence.css:1056-1081`, `public.go:23-33`.
- **Problem:** the header nav is Energy / Symptoms / Spoon Theory / Pricing & access; the footer is nine flat links, five of which repeat the header, with different names ("Energy" vs "Energy tracking"). No nav link carries `aria-current`. For a health log the two questions before signing up are "is it private?" and "how does it work?", and neither is in the header while a niche guide has equal rank with the two features.
- **Fix:** header nav **Energy · Symptoms · How it works (`/docs/getting-started`) · Privacy**; move Spoon Theory, Pricing and the other docs into a grouped footer (*Product* / *Guides* / *Trust*); add `aria-current="page"` and `.public-nav a[aria-current]{text-decoration:underline;text-underline-offset:6px}` using `.Path`; use the registry `Label` in header and footer; raise `.site-footer small` from 11px to 12px.

### A-N8. `public.css` specificity collisions make three components render at sizes nobody chose

- **Pass:** Designer
- **Where:** `web/public.css:77-84` (`.public-article p{font-size:18px;line-height:1.75;margin:16px 0}`) vs `web/presence.css:137-145` (`.eyebrow` 12px) and `:792-800` (`.choice-status` 10px), `web/public-base.css:77-80` (`section{display:grid;gap:18px}`).
- **Problem:** measured `.eyebrow` computes 18px (17px mobile) instead of 12px and the `.choice-status` pill 18px instead of 10px; inside `/pricing`'s `<section class="public-example">` each child is 50px from the previous (18px grid gap + two 16px margins) vs 16px in the `<div>` boxes on other pages, so the box is 453px tall at 1440 for four short lines; the closing aside is 920px wide against a 760px column. The eyebrow also repeats the breadcrumb and the H1 in three stacked lines ("Pricing & access / PRICING & ACCESS / Free to use.").
- **Fix:** scope the generic rule to `.public-article p:not(.eyebrow):not(.choice-status)`; add `.public-example{display:block}`; `.public-next{max-width:760px}`; delete the eyebrow on all eight pages or the breadcrumb's last item.

### A-N9. Dead ends on the utility URLs

- **Pass:** First-time user
- **Where:** `main.go:416-424` (catch-all `http.NotFound`), `public.go:173-205` (robots, sitemap), `web/robots.txt:1`, `web/public/layout.html:91`.
- **Problem:** `/nope`, `/docs`, `/features`, `/guides` return `404 text/plain` ("404 page not found", no title, no links, Times New Roman on white) although the URLs are hierarchical. `/sitemap.xml` lists all nine pages while every page is `noindex, follow` by default; `/robots.txt` advertises the sitemap although `web/robots.txt:1` says it does so "only on index-enabled deployments" (that file is shadowed by `public.robots`, `main.go:355-357`); with no `APP_PUBLIC_ORIGIN` the sitemap builds its URLs from the request's `Host` header instead of a configured origin (hardening, not a UX defect). The breadcrumb "Home" is the only absolute link.
- **Fix:** render the layout for 404s ("That page isn't here" + Energy, Symptoms, Getting started, Pricing, Log in; `X-Robots-Tag: noindex`) and 301 `/docs` → `/docs/getting-started`, `/features` → `/features/energy-tracking`, `/guides` → `/guides/spoon-theory`; emit the sitemap and the `Sitemap:` line only when `publicIndex` is true and derive the origin from `APP_PUBLIC_ORIGIN` or the admin public URL, never `Host`; delete `web/robots.txt`; make the breadcrumb Home a relative `/welcome`.

### A-N10. Install and PWA story is prose only

- **Pass:** Designer + First-time user
- **Where:** `web/public/layout.html:26-33` (no manifest link), `web/index.html:7,11`, `web/login.html:12,16`, `web/manifest.webmanifest:4,7,8`, `web/public/start.html:44-48`, `web/app.js:809-815` (service worker registered only after sign-in).
- **Problem:** Chrome reports `no-manifest` on every public page and `beforeinstallprompt` is handled nowhere; the only install path is a sentence in a guide. Three greens are in play (`#edf2e7`, `#2f6f62`, `#285c46`) and the manifest `background_color` `#f3f5f4` differs from the page `#f8f9f4`. For a daily-habit product the home-screen icon is the retention lever and nothing introduces it.
- **Fix:** add `<link rel="manifest" href="/manifest.webmanifest">` and the same `theme-color` to `layout.html`; manifest `"id":"/"`, `"scope":"/"`, `"background_color":"#f8f9f4"`. After the first completed check-in on a touch device that is not `display-mode: standalone`, show one dismissible inline Today card, once, remembered in `localStorage` (Android: a button using the captured `beforeinstallprompt`; iOS: "Tap Share, then Add to Home Screen."). One hint, not a nag; there is none today.

### A-N11. Signed-in people on the public pages are told to create an account, and the offline guide cannot be read offline

- **Pass:** First-time user
- **Where:** `public.go:94-117` (`data()` never calls `s.lookup`), `web/public/layout.html:46-57,103-107`, `web/help.js:30`; `web/sw.js:97-114`, `web/app.js:100-107`.
- **Problem:** signed in as a test user, `/guides/spoon-theory`, `/pricing` and `/welcome` still show "Log in" and "Create your free account", the latter silently landing on `/#today`; no link says "Open Jiggered". The page that explains offline use cannot be read offline (public pages bypass the service worker by design), and the signed-out offline page is one unstyled sentence with no logo or link.
- **Fix:** in `publicSite.data`: `if p.s.lookup(r) != nil { d.CTA, d.CTALabel, d.Availability = "/", "Open Jiggered", "You're signed in." }`, hide "Log in", point the wordmark to `/`; add `target="_blank" rel="noopener"` to `help.js:30`. Put a six-line "Offline quick guide" in the Help panel; style the offline stub with the app header and a "Try again" button.

### A-N12. Copy and consistency nits across the public pages

- **Pass:** Designer
- **Where:** `web/public/privacy.html:49`, `energy.html:21`, `symptoms.html:10`, `privacy.html:19,43`, `spoons.html:31`, `pricing.html:41`, `public.go:25-32`, `web/login.html:242`, `energy.html:45`, `spoons.html:10`, landing FAQ `<summary>`.
- **Problem:** "access and release status" links to `/pricing`, which has none; US spelling on public pages ("personalize", "behavior") against UK in the app ("colour", "Personalise"), with "licence" mixed in; title patterns disagree ("X | Jiggered" on six pages, "Jiggered X" on two); the auth footer's "Your privacy" goes to `/welcome#privacy` not `/privacy`; external essay links open in the same tab and could not be reached from the audit sandbox, so the Spoon Theory essay URL is unverified; landing FAQ rows are 35px tall and footer legal links 13px.
- **Fix:** change `privacy.html:49` to "pricing and access"; pick en-GB and sweep; one title pattern; point the auth footer at `/privacy`; `target="_blank" rel="noopener"` plus "(opens in a new tab)" on external links; `summary{min-height:44px}`.

### A-N13. On Today the dashed palette chips contradict the legend, the sync pill pluralises badly and covers the masthead, and wording differs between paths to the same result

- **Pass:** Designer + First-time user
- **Where:** `web/dashboard.css:2128-2145` (`.cal-chip`, `.cal-preset`, `border:1px dashed`), `web/today.js:458-459` (legend); `web/app.js:617-620`, `web/style.css:3105-3120` (`#sync{position:absolute;top:100%}`); `web/today.js:640-664,374,217-223,685-700,280-292,245-246`.
- **Problem:** the legend says "dashed = planned", but the 24 palette chips have the same dashed outline as planned blocks. Offline, one tile tap gives "1 changes queued on this device." and at 375 the pill is 335×46 at y=71, covering the "YOUR OWN RHYTHM" eyebrow. A tile tap shows no toast, the form says "Activity queued.", dragging says "Logged Quiet break at 11:15. Undo"; a stepper "−" and a pill "×" remove at once with Undo, while a block "×" or Delete first asks "Remove this activity?… You can undo this straight afterwards." On Plan the list's Remove is immediate but the timeline's × opens a modal that admits it is reversible.
- **Fix:** `.cal-preset{border-style:solid;border-color:var(--line);background:var(--surface)}`; `${n} ${n === 1 ? "change" : "changes"} queued…` at `app.js:617-620` and `#sync{max-width:calc(100% - 40px);font-size:.75rem}` on phones; after `logOne` toast `Logged ${x.a}. ${left} left.` with Undo; replace "queued" strings with `Logged ${name} at ${t}.` / `Updated ${name}.`; drop the single-block remove dialog (keep Undo) and keep `confirmDialog` for removing several things.

### A-N14. The shared-defaults notice is the only interrupt: 426px tall on a phone, above the page heading, on every tab

- **Pass:** First-time user
- **Where:** `web/index.html:74-80`, `web/defaults-notice.js:8-15,47-64`; every tab, 375 and 1440.
- **Problem:** measured by trimming a test account's list: 335×426px at y=69 on 375 (masthead pushed to y=495, first-run check-in to y=1,102), 219px at 1440. It is dismissible and silent after "Not now", so it is not nagware, but its primary action rewrites the person's lists, "Not now" is an underlined 70×44 link, dismissal is per device, and "3 activities, 2 symptoms" lacks "and".
- **Fix:** a one-line bar under the tab bar ("Your admin added 5 items. Review · Not now") that opens the existing Account review; "Not now" as a real secondary button; store the dismissal in `settings.profile` so it follows the account.

### A-N15. Plan: one plan is drawn in four to five places, and Plan's own Today column ignores what is already logged

- **Pass:** Designer
- **Where:** `web/planner.js:747-753` (strip), `:761-767` (tiles + outlook), `:768-773` (list), `:791-816` (board, plan rows only), `web/today.js:486-504`, `web/planner.js:291-299`.
- **Problem:** one untimed 3-point activity appears as a strip chip, a timeline header number plus an "Any time" chip, a list row with Edit/Remove, and five tiles plus a sentence. A seeded account has three activities logged today, but Plan's Today column has 0 blocks, so a person planning the rest of today cannot see what is already there. On Today, "Still to come today" sits at y 1,859 (1440) and 2,012 (375) and is 649–710px tall for four rows, duplicating the dashed blocks in the timeline.
- **Fix:** draw logged entries in the board's Today column as read-only solid ghosts (reuse the `kind:"logged"` mapping from `today.js:486-492` with `editable:false`); collapse the five tiles into the sentence (earlier H4); put `#plan-list` behind a "List" toggle for keyboard and screen-reader users; trim "Still to come today" to a count and one "Finish next" button.

### A-N16. Timeline touch targets, tiny type, and unlabeled day-header numbers

- **Pass:** Designer
- **Where:** `web/dashboard.css:2128-2141` (chips 32px), `:2244-2260` (× 20×20 on desktop), `:1794-1798,1858-1867,2016-2022` (11.2–11.52px text), `:1820-1834` (`.cal-day-head b`, `.is-warn b{color:var(--red)}`), `web/planner.js:798,801,824` (`h3.label` 10px), `web/calendar.js:25` (`MOVE_SLOP = 4`).
- **Problem:** the timeline added 24–40 targets under 44px and 17–27 labels under 12px to a tab that had none. A 6px nudge of a 09:10–09:30 block re-snapped it to 09:15–09:35 (the drag grid is 15 minutes though the form accepts 5). Day headers read "Tue 6 -4" with no unit, print a hyphen where `signed()` prints U+2212, and the red number means "work exceeds the allowance before recovery", so "Wed 7: 2" is red although positive; red `#b55f4b` is 4.43:1 on the unselected header and 3.92:1 on the selected one. Palette and day chips have no hover state.
- **Fix:** `.cal-rail span,.cal-corner,.cal-meta{font-size:.75rem}`; `.cal-chip{min-height:44px}` under `@media (pointer:coarse)`, 36px otherwise; `.cal-remove::before{content:"";position:absolute;inset:-12px}`; `MOVE_SLOP` 8 for touch and pen; hover states; a `minus()` helper using U+2212; `<small>left</small>` and an `aria-label` such as "Tue 6 Oct: 2 left after recovery, 1 over before recovery"; a "!" glyph on `.is-warn`; `#a14b38` for the text (5.82:1).

### A-N17. Plan's keyboard path: 47 Tab presses to the first block and 59 to "Add"

- **Pass:** Designer
- **Where:** `web/planner.js:821-826` (24 palette chips are buttons), `web/calendar.js:96,100-101` (every day header, chip and block is a tab stop), `web/index.html:603`.
- **Problem:** from the document start: 4 header controls, the tab, Look ahead, 7 strip chips, 24 palette chips, 7 day headers, 2 untimed chips, then blocks; `#plan-add` is the 59th stop, and with 200 blocks the board has 207 tab stops. Every refocus after Cancel, Save or Remove restarts at the top (A-H21).
- **Fix:** make the palette and the grid composite widgets with one tab stop each (roving `tabindex`; `role="listbox"` for the palette, grid semantics with arrow navigation for the board); add a "Skip to the timeline" link at the top of the panel.

### A-N18. Plan form details: validation, a 12-hour time field against a 24-hour board, and a form that never names the day

- **Pass:** First-time user
- **Where:** `web/index.html:625` (`maxlength="120"`), `:637,647-657`, `:667` (`class="error"`); `web/planner.js:414-426`, `:371-372`, `:369`; `web/today.js:511-516`; `web/dashboard.css:1663-1667`, `:78-81`.
- **Problem:** a 70-character name is accepted by the field and rejected on Save with "Use a name of 1–60 characters, a whole-number cost from −10 to 10 and a valid number of days." (three rules, none named) in plain body text, with no `aria-invalid`; the message stays after the name is fixed. No CSS rule matches `.error` (the app's is `.err`). "Add on consecutive days" has `max` 7 only with Look ahead at 7 and today selected, and nothing says why. The time field shows "06:15 PM" (browser locale) while the board is 24-hour; there is no `hour12` setting; the repeat field floats alone in the middle column; the 3px focus ring overlaps the label; the form title never states the day.
- **Fix:** `maxlength="60"` plus the counter from `today.js:511-516`; one message per field with `aria-invalid="true"` and focus on the first bad field; clear `#plan-form-error` on `input`; `class="msg err"`; move "Unfinished planning draft restored." into a `role="status"` line; show the repeat limit in the label; format times with `toLocaleTimeString(navigator.language,{hour:"2-digit",minute:"2-digit"})` or add a 12/24-hour setting; `#plan-length-hint{grid-column:1/-1}`; `outline-offset:2px` inside forms; title "Add to Tue 6 Oct".

### A-N19. After saving an episode there is one word of confirmation and the page stays scrolled to the bottom

- **Pass:** First-time user
- **Where:** `web/episodes.js:233-255`; `/#episode`, 375.
- **Problem:** measured: after a note-only and after a full episode the toast is "Saved." and `scrollY` stays at 2,159 / 1,983 of a 2,788px page; the form resets to a new "now / Still going" form and the new "Still going" panel is off-screen. Editing from History ends in "Edit episode" with a secondary "Back to new episode" and no way back to History except the tab. Nothing confirms what was recorded or where it went.
- **Fix:** on a saved new episode `window.scrollTo({top:0})`; toast `Saved: ${fmtWhen(value.when, locale)} · ${value.symptoms.join(", ") || "no symptoms"}` with links "View in History" and "Add another"; remember the origin tab in `edit()` and label the secondary button "Back to History" when it came from there.

### A-N20. The emergency number stays generic until the person finds the region setting

- **Pass:** First-time user
- **Where:** `web/region.js:17-20`, `web/index.html:452-455`, region select at `:961-973`.
- **Problem:** a new account's block reads "Call your local emergency number if…"; the only place to set a country is Account and nothing on Episode links there. Once set, the text switches correctly (GB "999 or 112", US "911", EU "112"). The block itself is well placed and calm, contrast 10.18:1, and does not push the form below the fold at 375×812.
- **Fix:** while `region === ""`, append inside the block "Set your country so this shows your number." as a `data-settings="profile-region"` link (the same jump "Edit lists" uses, `index.html:464`). Do not guess from locale; the comment in `region.js:1` is right.

### A-N21. Episode form polish: two question sizes, 37px chips, an onset that cannot be cleared, and a tab that never says "symptom"

- **Pass:** Designer
- **Where:** `web/style.css:521-528,1451-1453` (`.chip span`), `:1639-1643` (`.chip-status .x`), `web/dashboard.css:706-709`, `web/episodes.js:160`; `web/index.html:83,127-128`.
- **Problem:** single-answer questions are 14px/700 `label.legend`, multi-answer ones 16px/700 `legend`; 26 of 47 controls are under 44px (symptom and trigger chips 37px, onset 40px); tapping the ticked "Sudden" again leaves it ticked; the eyebrow is the global "YOUR OWN RHYTHM" and the H1 "A moment to notice." leaves 250px of hero before the form at 375.
- **Fix:** `#epform legend,#epform label.legend{font:700 1rem var(--body)}`; `@media (max-width:700px){.chip span{min-height:44px;display:inline-flex;align-items:center}}` and `.chip-status .x{min-height:44px}`; make onset a toggle or add "Not sure"; eyebrow "SYMPTOM EPISODE", H1 "Log a symptom episode.", drop the duplicate `h2` "Log an episode".

### A-N22. Draft expiry is explained only in Help, and the Discard dialog uses jargon; the whole Episode form locks while a save waits for the server

- **Pass:** First-time user
- **Where:** `web/device.js:267,296-300`, `web/index.html:456-459`, `web/episodes.js:316-321,395-402`, `:391-394` (`el.disabled = !!waiting`); `web/help.js:72`, `web/public/offline.html:22`.
- **Problem:** the Episode tab shows "Unfinished draft restored from this device." and a collapsed panel listing a timestamp; "seven days" appears only in Help and the public offline page, and Discard shows a native `confirm()` reading "Discard this unfinished draft? Queued changes are kept in recovery." Offline, after Save all 66 controls on the form are disabled and the toast says "Change queued on this device. Waiting to save on your server." while the same moment on Today queues two taps; it unlocks only on reconnect.
- **Fix:** add "Kept on this device for 7 days after your last change (until 12 Oct)." to the panel summary and the restore toast, and change the dialog to "Delete this draft? It hasn't been saved to your account." Reset the form as soon as the operation is durably queued and show a "1 episode waiting to sync" chip; disable only when editing the same id.

### A-N23. Chart axis text is 6px on a 375px phone

- **Pass:** Designer
- **Where:** `web/history-charts.js:4-9` (`W=640`), `web/style.css:1903-1906` (`.chart-axis{font:13px}`); History → Explore patterns.
- **Problem:** the SVG is 293px wide at scale 0.458, so tick numbers and the two date labels render at **6.0px** (11.4px at 1440); the chart is 293×101px. The data table and inspector are a good fallback.
- **Fix:** below 700px build the chart with `W = 320` and `H = 200` so the 13px label renders at about 13px, or set `.chart-axis{font-size:calc(13px * 640 / var(--svg-w))}` from JS via `svg.style.setProperty("--svg-w", width)`.

### A-N24. Two stylesheet colour bugs in the History detail and calendar

- **Pass:** Designer
- **Where:** `web/style.css:1179-1181` (`.recovery{border:2px solid var(--red)}`, intended for `section.panel.recovery`, `web/index.html:69`), `web/history-matrix.js:140` (`<b class="recovery">`), `web/style.css:2450-2452`, `:2565-2569` (`.matrix-cell.level-3`).
- **Problem:** every recovery value in the day detail ("+1", "+2") gets a 2px `rgb(181,95,75)` box (red is the Red-day colour); Today's `b.recovery` has the same computed border. In the "Activity points used" and "Net activity points" modes `level-3` cells have ink `var(--bg)` on a 70% accent mix at **3.48:1** for 10.9–16.8px text (levels 1/2/4 are 6.1–8.7:1).
- **Fix:** scope the panel rule to `.panel.recovery{border:2px solid var(--red)}`; for level 3 use `--tone-bg: color-mix(in srgb, var(--accent) 85%, var(--surface))` (≈5.0:1 by arithmetic, not run).

### A-N25. Pattern cards promote tiny samples to headlines

- **Pass:** Designer + First-time user
- **Where:** `web/history.js:554-558` (`enoughSleep`, `sampleWeekdays`), `:570-577`, `:331-332`, `web/history-model.js:42-47,176-177`, `web/model.js:583,715-716`.
- **Problem:** "67% after poor sleep" from 4 of 6 days against 9 of 17; "Sunday" is a card headline from "2 of 3 (67%)"; the summary lists "Most often noticed: Hot or flushed (2), Anxiety or panic (1), Balance off (1), Dizziness (1), Headache (1)", four items seen once and ordered alphabetically. The disclaimers are careful ("this doesn't establish a cause"), but the headline is set in the 24px display face; choosing the highest of seven weekdays from ≥3 check-ins each is guaranteed to produce a "pattern".
- **Fix:** the sleep card needs ≥5 per group and leads with the counts ("4 of 6 poor-sleep days were amber/red; 9 of 17 other days"); the weekday card appears only when every weekday has ≥4 check-ins and then shows all seven shares; "Most often" lists only items with count ≥2, otherwise the heading is "Recorded once:".

### A-N26. History still opens with an export, and "Share this day" is neither a share nor easy to undo

- **Pass:** Designer + First-time user
- **Where:** `web/index.html:691,730-735`; `web/history-matrix.js:143`, `web/history.js:84-103,201-208`. Earlier H8.
- **Problem:** measured on an empty account at 375: the first screen holds Period, a disabled primary "Prepare summary" (opacity .5, **2.33:1**, no reason given) and a collapsed "Filter and search — None"; the first calendar row starts at y≈700. On a populated account the only filled buttons are "Prepare summary" and "Share this day". "Share this day" has no `navigator.share` or link: it rewrites the page-wide period to that one day (Period → "Custom dates", filters, records and the prepare panel all open), lands the person at scrollY 2,567 while "Return to previous period" is at y 1,237.
- **Fix:** make "Prepare summary" a secondary button inside the Prepare panel header; in the day card make "Edit day" primary and rename "Share this day" → "Print or export this day"; show the disabled reason as text ("Nothing to summarise yet — log a check-in first"); render a copy of the Return button at the top of the Prepare panel whenever `previousSelection` is set.

### A-N27. History copy is wrong in two states (unfiltered "matching", failed load)

- **Pass:** First-time user
- **Where:** `web/history-matrix.js:41,138-139,149-154`, `web/history.js:535-540`.
- **Problem:** on an unfiltered empty account the day card says "No matching check-in", "No matching day log", and the legend ends "No matching record / unmarked". With a zero-result search the card offers primary "Log today" although today has a log (it is merely filtered out). With `/api/docs` returning 500 on a first load the pill says "Offline. Showing this device's copy." while the calendar says "Nothing logged yet…" and the range text reads "Mon, 5 Oct 2026 – Mon, 5 Oct 2026 · 1 calendar day" under Period "30 days".
- **Fix:** use "matching" only when `activeFilters().length`; unfiltered: "No check-in for this day" / "Nothing logged for this day"; with filters on, say "Hidden by your filters" with a "Clear filters" button instead of "Log today"; gate the first-run line and the calendar on `ctx.store.status().loaded` and otherwise show "Couldn't load your history. Try again."

### A-N28. The summary preview is a 416px window onto a 3,076px, 534px-wide document on a phone

- **Pass:** Designer + First-time user
- **Where:** `web/style.css:1205-1221` (`#summary-preview{max-height:26rem;overflow:auto}`), `web/history.js:213-218,316-347`, `web/index.html:761`; History → Prepare a summary, 375 and 320.
- **Problem:** the box is 293×416 with `scrollHeight` 3,076 and `scrollWidth` 534 (the episodes table is 510px) and no `tabindex` or `role`; it ends mid-heading, and "Print or save as PDF" sits below it at y 2,979. The preview is the privacy check before a health file leaves the phone, and on touch scroll chaining makes it fight the page.
- **Fix:** inside `@media (max-width:700px)` set `#summary-preview{max-height:none;overflow:visible}` and reflow the two tables as stacked cards (`tr{display:block}`, `td::before{content:attr(data-label)}`, `data-label` added in `history.js:334,342`); on desktop keep 26rem but add `tabindex="0" role="region" aria-label="Summary preview"`.

### A-N29. The opt-in weekly review is the last thing on Today and lands on an open date-range form

- **Pass:** First-time user
- **Where:** `web/index.html:448` (last child of the Today panel), `web/today.js:930-975`; `web/history.js:394-396` (a custom range counts as an active filter and opens `#history-filter-panel`), `:602-611`; Account copy `web/index.html:975`.
- **Problem:** with the review turned on, the card's top is at y 6,778 of a 7,322px Today at 375 (4,022 of 4,371 at 1440); it also needs ≥3 check-in days in the last 7 (`today.js:943`), which the toggle never says. "Review these seven days" opens History with Period "Custom dates" and Filter and search open, so `.matrix-overview` starts at y 1,237 (375) / 890 (1440) and the first screen is From, Through, Search, Status, Symptom.
- **Fix:** move `<section id="weekly-review">` above `#today-ongoing`; open the filter panel only when `activeFilters().length` (not for `rangeMode === "custom"`); after `openPeriod`, `$("history-matrix").scrollIntoView({block:"start"})`; add to the setting "Appears on Today once you have 3 check-ins in a week."

### A-N30. Fretboard colour: every new card is born red, the legend swatch disagrees with the card, and high-contrast mode erases the status

- **Pass:** Designer
- **Where:** `web/tools.css:94-101` (`--fb-todo: var(--red)`, `--fb-external: var(--muted)`), `:154-157` (swatch), `:419-430` (card uses `--red`), no `forced-colors` rule; `web/fretboard-model.js:11-16` (default `todo`).
- **Problem:** the "Not my problem" swatch border is grey (`rgb(82,101,90)`) while the card border is red (`rgb(181,95,75)`); with `forcedColors:active` "Not started card" and "In progress card" render identically; red vs green differ by ΔE 6.4 under simulated protanopia. The green/amber/red triad means "how I feel" on Today and "how far along" here, and the default status is the alarm colour, so ten new cards are ten red alerts, at odds with "Patterns, not pressure".
- **Fix:** `--fb-todo: var(--muted)` with a neutral tint, amber for doing, green for done, one colour for "Not my problem" on swatch and card; `@media (forced-colors:active){.fb-dot{forced-color-adjust:none}}` plus a shape per status (circle / half / check / dashed ring).

### A-N31. Fretboard with 200–400 cards is slow and has no zoom, pan or list

- **Pass:** Designer
- **Where:** `web/fretboard.js:864-895` (the marquee calls `renderItems()` per move), `:404-434` (`paintItem` → `keepInside` reads `offsetWidth` per item), `web/fretboard-model.js:8` (`ITEM_LIMIT = 400`).
- **Problem:** measured on a loaded 4-core box (absolute numbers inflated): 220 cards open in 663ms and drag at p95 83ms; a marquee over 20 steps made 40 long tasks (p95 133ms); at 400 cards a marquee over 40 steps took **12.8s** and a select-all nudge was one 833ms frame. At 400 the board is an unreadable pile.
- **Fix:** during a marquee toggle `is-selected` only on ids whose membership changed (no `renderItems()`); in `paintItem` skip `keepInside`/`place` unless x/y or canvas size changed; lower `ITEM_LIMIT` to 150 until zoom exists or add "Archive done cards" next to "Clear done cards".

### A-N32. Fretboard limits are silent: truncation at 240 characters has no counter, and Duplicate and typed entries at 400 items do nothing without saying so

- **Pass:** First-time user
- **Where:** `web/fretboard.js:131,540,583,1117` (`maxLength` only), `:287-305` (`duplicate` has no limit check), `:264-286` (`cardFor` returns `{id:null}` at 400), `web/fretboard-model.js:115-117`.
- **Problem:** pasting 564 characters keeps 240 with no message and ends mid-sentence. At 400 items "+ Card", double-click and the menu toast, but Ctrl+D leaves 400 nodes, clears the selection and leaves a no-op undo entry; a typed today's-three entry is added without a card and without a message.
- **Fix:** show "212/240" under the editor from 200 characters (`aria-live="polite"`); add the 400-item toast to `duplicate()` and the `cardFor` path; push no undo entry for a no-op.

### A-N33. Fretboard copy and logic slips

- **Pass:** First-time user
- **Where:** `web/fretboard.js:498,514,1064-1073,102-105,496-512,235,472`; `web/fretboard-model.js:127-132`.
- **Problem:** the empty-board summary reads "An empty board is a fine place to start.." (double period); with three entries all ticked, "Suggest from the board" says "Three is the point. Tick one off to make room." (ticked entries still count); renaming the right axis to "Controlled" leaves the captions, card `aria-label`s and summary unchanged; the summary mixes overlapping groups ("6 cards · 5 in your hands · 1 out of your hands · 1 done · 1 not yours"); a new card is committed before any text is typed, so losing the page while the editor is open leaves an "Untitled" ghost that the summary counts as "1 that matters most".
- **Fix:** drop the trailing "."; count only undone entries and say "Finish or remove one to make room."; build captions and `aria-label`s from `board.axes`; show disjoint groups; create new items locally and commit on `finishEdit`, or drop empty items on load.

### A-N34. Fretboard text is small, the caption layer is 3.42:1, and most targets are under 44px

- **Pass:** Designer
- **Where:** `web/tools.css:316-328` (`.fb-quad` .74rem + `opacity:.75`), `:618-628` (`.fb-chip` .68rem), `:629-639` (`.fb-three-remove`), `:121-133`, `:221-237`, `:666-732` (menu `kbd`); `web/index.html:849`.
- **Problem:** quadrant captions are 11.8px at **3.42:1** in light (5.65:1 dark); the eyebrow 10px; the "on board" chip 10.9px. At 375, 23 of 39 interactive items are under 44px ("×" remove 17×22, the three-list checkboxes 18×18, legend pills 30px, Undo/Redo 34px, axis labels 24px, cards 33–34px, menu rows ~36px); the phone card menu is 453px tall and still prints keyboard chips ("Ctrl+D", "]", "Del"). The dark-mode placeholder "One thing for today…" is 3.01:1 (app-wide; no `::placeholder` rule).
- **Fix:** `.fb-quad{font-size:.75rem;opacity:1}` (5.2:1); chip ≥ .75rem; 44px hit areas for "×" and the checkbox at ≤700px; legend pills `min-height:44px` on touch; under `@media (pointer:coarse)` hide `.fb-menu kbd` and make rows 44px; global `::placeholder{color:var(--muted)}`.

### A-N35. "Today's three" is an island, and its list column is 63px wide

- **Pass:** First-time user + Designer
- **Where:** `web/fretboard.js:118-141,459-494`, `web/tools.css:164-169` (tray 260px), `:562-572`; grep shows the board is referenced only by `fretboard*.js, tools.js, help.js, model.js, sw.js, tools.css`.
- **Problem:** "choose today's three" is the tool's hook, yet it exists only on a page the person must open; nothing on Today or Plan shows it, ticking logs nothing, and it is a second to-do list for the same day as Plan (which has costed activities). At 1440 a linked entry's text column is **63px**, so "Reply to the landlord" wraps to 3 lines.
- **Fix:** show the first three undone entries as a compact card on Today (read `normaliseBoard(ctx.store.view(BOARD_ID)).three`; tick with the same `boardPatch`) with an "Open Fretboard" link; add a menu item "Plan for today" that creates a planned activity for the card; put `.fb-chip` and `.fb-three-remove` on a second grid row (`grid-template-columns:auto auto minmax(0,1fr)`) so text gets ≥140px.

### A-N36. "Your data" leads with a disabled analytics-consent block

- **Pass:** Designer
- **Where:** `web/account.js:55-58`, `:59-73`, `web/index.html:1148-1160`.
- **Problem:** `#usage-consent-form` is **334px (1440) / 540px (375)** tall on every default install: an h3, a long privacy paragraph, a disabled checkbox, a disabled "Save usage preference" button and "Measurement is disabled by the instance administrator." It pushes "Download everything (JSON)" from y 4,864 to 5,258 (1440) and 6,399 at 375, so the two actions people come for sit under legal copy for a feature that is off, which reads like an analytics opt-in being pushed.
- **Fix:** in `loadConsent()` set `$("usage-consent-form").hidden = !r.data.available && !r.data.enabled`; when available put the paragraph in `<details><summary>About optional usage counts</summary>` and move the form below "Your privacy".

### A-N37. The Sign-in security panel looks unfinished and explains nothing when email is unavailable

- **Pass:** Designer
- **Where:** `web/security.js:2-14,33,53`; `security_accounts.go:415`.
- **Problem:** the panel is 936px (1440) / 968px (375); headings are followed by 47px of air; the email button is a 768px outline while "Set up authenticator" is a 193px filled button; "Your current password" appears twice here (four times with Change password and Delete); status refreshes only via a manual button. Recovery codes have no Copy button, touch the last row of codes, and "I've saved my codes" discards the only copy with no confirmation. On a default install without SMTP the whole email form is hidden while the intro still promises "a verified recovery email", and after sending a first address the message says "Your current address stays active until the new one is verified." although there is none.
- **Fix:** one shared password field at the top of the panel, kept for the setup window; equal button treatment; "Copy all" with `navigator.clipboard.writeText(codes.join("\n"))` plus a confirm guard on "I've saved my codes"; when `!email_available` show "Recovery email isn't available on this server. Ask the person who runs it to set up email."; return "A verification link is on its way to <address>. It expires in 30 minutes." from `security_accounts.go:415`.

### A-N38. Profile copy promises more than the product does (the answer to "collected but never used")

- **Pass:** First-time user
- **Where:** `web/index.html:929,943,975,1195`; `web/style.css:3277-3280`; `web/today.js:930-950`; `web/model.js:194-204`; `README.md:99`; `web/account.js:332`; `web/help.js:66`; `web/public/privacy.html:28-33`.
- **Problem:** no Account input is dead — budget, penalties, locale, theme, history range, region, weekly review, display name, focus, photo and energy language are each read somewhere — but several over-promise. **Display name** says "How you'd like to be greeted" yet nothing greets anyone; it shows only in the header chip (hidden at ≤700px, measured 0×0 at 375) and the Account hero. **"What I'd like to notice"** appears only in the Account hero and the History summary, never on Today. **"Dates shown as"** lists *languages* ("Deutsch", "Français"); choosing Deutsch makes the header date and History weekday row German over an all-English UI, and README step 4 says "preferred language", which does not exist. The restore preview says "Keep it so you can undo a restore later" while Help says it does not remove records a restore added. Delete says "removes … for good" while the privacy page says copies in operator backups are not erased.
- **Fix:** placeholder "Shown next to your avatar"; show `focus` in the Today header ("Noticing: …") or relabel it "Shown on your Account page and printed summaries"; relabel "Dates shown as" → "Date format" with example options ("5 Oct 2026 — English (UK)") and fix the README ("your energy language (points or spoons) and date format"); restore sentence "…so you can put replaced records back (records the restore added stay)."; Delete panel: append "Copies already in server backups are not erased."

### A-N39. Destructive confirmations are native dialogs, and deleting your account ends on a bare sign-in page

- **Pass:** Designer + First-time user
- **Where:** `web/account.js:194,236,413`; `web/admin.js:491,505,517,528 (prompt),550,759,788`; `web/app.js:499,782`; `web/profile.js:157`; `web/security.js:64,69`; `web/services.js:277`; `web/episodes.js:317`; accessible `confirmDialog` `web/util.js:208-255`, used only at `web/planner.js:241` and `web/today.js:285`; delete flow `web/account.js:410-419`.
- **Problem:** 17 native `confirm()`/`prompt()` call sites against 2 `confirmDialog` uses. "Delete your account and everything you've logged? This can't be undone." appears *before* the password is checked, so a mistyped password is rejected after the scary confirm. After a correct delete the browser lands on `/login` in ~450ms with no notice, so "deleted" looks like "signed out".
- **Fix:** `confirmDialog({title:"Delete your account?", body:"This removes your account and everything you've logged from this server. Copies in server backups are not erased.", confirmLabel:"Delete my account", cancelLabel:"Keep my account"})`, shown only once the password field is non-empty; on success `location.assign("/login?e=deleted")` with `deleted: "Your account and its data were deleted."` in `login.js` `msgs`; convert the other call sites the same way (the admin delete prompt becomes a dialog with a username input).

### A-N40. Export and restore messaging: the device copy is silent, and the file-error wall is jargon

- **Pass:** First-time user
- **Where:** `web/account.js:378-391` (device copy, no `say()`), `:392-407`, `:325-326`, `:332,365`; `validate.go:18`.
- **Problem:** "Download device recovery copy" produces a file and no message while the line above still reads "Server data downloaded." Choosing that same file in "Restore from a file" gives "Restore rejected. Nothing changed. Fix these records or use an earlier export." followed by eight lines such as "docs: unsupported record id or record too large", "drafts: …", "exportedAt: …", naming the file's top-level keys as "records". Counts read "1 new records" and "Restored 1 records". People who download the recovery copy are people in trouble.
- **Fix:** end `account.js:378-391` with `say($("export-msg"), "Device recovery copy downloaded. It can't be restored here; keep it for support.")`; before posting, if `data.format && data.docs` say "That is a device recovery file, not an account export. Choose a file named jiggered-YYYY-MM-DD.json."; collapse server `issues` to the first three plus "and N more"; pluralise correctly.

### A-N41. Operator commands are spelled three ways, and Admin never says setup is unfinished

- **Pass:** First-time user (operator)
- **Where:** `web/login.html:70-73` (Docker form) vs `:233-236` (bare `jiggered user reset-password NAME`); `web/admin.js:713` (bare `jiggered settings set secure_cookie true`); `README.md:70`; `docs/ADMINISTRATION.md:309,401-414,526`; `.env.example:16`; `main.go:204`; `cli.go:21-42,447-449`.
- **Problem:** on an empty private instance the sign-in page says `docker compose exec jiggered /jiggered user add NAME --admin`, while the folded "Need help signing in?" says `jiggered user reset-password NAME`, which is not on `PATH` in the documented Docker deployment and omits the restart-for-lockout caveat the command itself prints; the sole-admin lockout command `jiggered user reset-two-factor NAME` is in no in-app hint. `jiggered help` opens with the legacy `hash` command and lists `user add` twelfth; `settings list` is not a command although `user list` is. With a proxy header present and `trust_proxy` off (the default), only the Connection tab says so, although README step 3 sends operators there, leaving one shared lockout bucket for everyone behind the proxy.
- **Fix:** one string per command with the Docker form first: `docker compose exec jiggered /jiggered user reset-password NAME` plus "If someone was locked out by wrong guesses, also run `docker compose restart jiggered`." and the `reset-two-factor` form; the same prefix at `admin.js:713`. Put "Docker: prefix every command with `docker compose exec jiggered /jiggered`" at the top of `usage` (`cli.go:21`), start the list with `user add`, accept `settings list`. Add a setup strip at the top of Admin → People with chips "HTTPS cookies: off", "Proxy header seen but not trusted", "Email: off", each linking to its tab (the data is in `/api/admin/settings`).

### A-N42. Error and offline copy: a misleading fatal page, a silent 401, raw ids in Recovery, and an overlapping status pill

- **Pass:** First-time user
- **Where:** `web/app.js:93-107` (fatal), `web/util.js:141-144` and `web/app.js:150-173` (401), `:604-626` (status text), `:629-633` (recovery panel), `web/style.css:3105-3122` (`#sync`).
- **Problem:** with `/api/me` aborted or answering 500 the whole page becomes one line, "Can't reach the server, and nobody has signed in on this device yet. Connect once to get started.", with no button or link, and it is false for a signed-in person on a server error. When the session is revoked from another device the next action lands on `/login` with no notice and the unsent tap is discarded. With every save answered 500 the header says "Will retry when connected" for 11+ seconds although the browser is online. After a 422 the recovery panel lists the raw document id ("settings: not accepted", twice), pushes the page down 532px (686px at 375), and the floating `#sync` pill overlaps its top 46px. On Today a refused tile tap flashes green then reverts with no toast, and the pill and Recovery panel appear about 4,000px away.
- **Fix:** fatal: "The server isn't answering (HTTP 500). Your data isn't lost. [Try again]" with `location.reload()` and a different sentence for a network error; 401: `location.href = "/login?e=expired"` with `msgs.expired = "You were signed out (your session ended or was revoked). Changes that had not been sent were not kept."`; "Server problem (500). Retrying…" when the last failure had a status; map `f.id` to labels at `app.js:632` (`settings` → "Your settings", `d-2026-10-03` → "Check-in for 3 Oct"); `#recovery:not([hidden]){margin-top:48px}`; on the first failure `ctx.toast("Couldn't save that. See Recovery at the top.", {label:"Show", fn:()=>scrollTo({top:0})})`.

### A-N43. The phone tab bar: six labels overflow at 320px, the admin's seven collide, and Admin's own tables do not fit

- **Pass:** Designer
- **Where:** `web/dashboard.css:820-833` (`#tabs`, `button{padding:8px 2px;font-size:12px}`), `web/admin.js:104,853` (usage table), `:420-437` (row); cf. the earlier N2.
- **Problem:** measured: at 320 each of the six buttons is 41×48 and "Episode", "History" and "Account" overflow their own text ("Episode History" reads as one label); at 375 they are 50px and fit. For an admin the seven-tab bar has 4px gaps at 375, 2px at 360 and **overlapping** labels at 320 ("EpisodeHistoryTools", "AccountAdmin"). The usage report is a 428px table in a 293px container ("Completions" cut, the fifth column invisible, no scroll cue); People rows are 241px (1440) / 265px (375) with no pagination, and the fixed bar covers the last row's actions.
- **Fix:** `@media (max-width:340px){.app-shell #tabs{gap:2px;padding:6px 4px}.app-shell #tabs button{font-size:11px;padding:8px 0;flex:1 1 44px;min-width:0}}`; below 700px move "Admin" into the avatar menu (or let `#tabs` scroll horizontally with `scroll-snap-type:x proximity`) and remove Tools from the bar (A-H40); wrap the usage table in `<div class="table-scroll" tabindex="0" role="region" aria-label="Usage report">`; make People rows one 56px line with the meta lines in the disclosure, paged at 20.

## Appendix A: Pages and surfaces covered

| Surface | Route or entry point | Findings |
| --- | --- | --- |
| Landing | `/welcome`, `/` signed out | A-H8, A-H9, A-H10, A-H11, A-H13, A-N1–A-N4 |
| Register, sign-in, verify, forgot, reset, two-step | `/register`, `/login` | A-C2, A-H2–A-H5, A-H7, A-N5, A-N6 |
| Transactional email (verify, reset, recovery) | inbox | A-H6 |
| Eight public articles | `/features/*`, `/guides/spoon-theory`, `/pricing`, `/docs/*`, `/privacy` | A-H10–A-H12, A-H14, A-N3, A-N7, A-N8, A-N12 |
| Utility URLs (404, sitemap, robots, llms, manifest, healthz) | | A-N9, A-N10 |
| Offline, service worker, install | | A-H15, A-N10, A-N11 |
| First sign-in (forced password change) | `/login` → app | A-H16, A-H43 |
| Today: shell, check-in, tiles, Day timeline, forms | `/#today` | A-C1, A-H17–A-H24, A-N13, A-N14 |
| Plan: strip, board, palette, forms | `/#plan` | A-C3, A-H25–A-H28, A-N15–A-N18 |
| Episode | `/#episode` | A-H29–A-H31, A-N19–A-N22 |
| History, exports, print | `/#history` | A-H32–A-H34, A-N23–A-N29 |
| Tools launcher and Fretboard | `/#tools` | A-C4, A-H35–A-H42, A-N30–A-N35 |
| Account (profile, lists, security, devices, data, delete) | `/#account` | A-H43, A-H44, A-H48, A-H49, A-N36–A-N40 |
| Help panel | header button | A-H24 |
| Admin (People, Email & signup, Backups, Shared defaults, Connection, Activity) | `/#admin` | A-H45, A-H46, A-N41, A-N43 |
| Operator CLI | `jiggered help`, `user`, `settings` | A-N41 |
| App shell: tab bar, avatar menu, toasts, sync pill, second tab | every tab | A-H21, A-H47, A-N13, A-N42, A-N43 |

## Appendix B: Statements in Part 2 that no longer match the code

Part 2 is retained unchanged. These are the places where it is stale or wrong against `6ee614a`, keyed by its own IDs. Line numbers of Part 2 shift when Part 1 is added, so they are not quoted.

- **C1:** the CSS line references moved (`dashboard.css:1672-1682, 1561-1565` is now `:1688-1700, 1567-1571`); the fix itself is verified (`scrollLeft` 0, 5px of room for the ring at 320 and 375, no clipping at 768 and 1440).
- **C2 status:** "blocks are moved by their grip so the page still scrolls" and "Not yet: editing a block's length from a phone other than through the form" are outdated. The resize handles also set `touch-action:none`, a swipe that starts on an edge resizes the block (measured 60 → 15 minutes), and a bottom-edge drag changes length on phones (A-H23). Appendix A4's "8px visible handle and ≥44px hit area", marked done, is not met: handles are 10px (mouse) and 24px (touch) and invisible until hover.
- **C3 status:** "Today's time is *now*" and H7's "Completing a plan item records `t = now`" are wrong. `web/planner.js:157-161` uses the planned time when it has already passed and `now` otherwise (measured at 14:29: a task planned for 09:00 logged `09:00`, one planned for 23:00 logged `14:29`); no planned time is stored, so H7 stays open. "Keyboard focus moves to the next planned item" is wrong for taps on the timeline (A-H19). "A mouse can also drag an activity tile onto the timeline": the code exists, but at 1440×900 the tiles (y ≥ 2,009) and the board (y 961–1,581) are never on screen together.
- **C4 (title, Problem and Status):** stale. Commit `dd201fc` removed the History week timeline (`web/history-week.js`, `web/week-model.js`, `test/week-model.test.mjs`); "Your week on a timeline", "See in the week view" and the week tests no longer exist. The calendar is no longer "a 168px heatmap … 25×25px cells": a 30-day period fills its card (88×58px at ≥768, 46×46 at 375, 40×40 at 320) and the `max-width: calc(24px + var(--weeks)*28px)` rule is gone. The time and episode-lane half of C4 is open again (A-H32).
- **C5:** the History half holds (first-run line, single "Log today"). The Plan half is true for phones only: above 700px there is no start card, and on a phone the card's button opens the plain form 2,396px down (A-H25). "Prepare summary" is still the first control on an empty History (A-N26).
- **H1 numbers:** Today is now 3,829px (fresh first run) / 4,162px (seeded) at 1440, 6,478 / 6,958px at 375, and 7,657 (fresh, after a check-in and one log) / 8,810px (seeded) at 320. The Day timeline added 1,058px (1440) and 1,349px (375). The "activity block" figures are still exact (1,941px at 1440, 2,669px at 375 on a seeded account).
- **H2, H5, H7, N1, N4, N5:** still open and re-verified (H2 tile 127px at 1440 and 137px for the first tile at 375; H5 is A-H28; N4 is still five check-in prompts on the first screen; N5 numerals still use two faces). **H3 and H4:** line references moved (`index.html:514-520` is `:564-570`, `planner.js:55,124-129,255` is `:306,387-392,739`, `planner.js:274-275` is `:761-767`); behaviour unchanged. **H6:** confirmed fixed.
- **H8:** the accordions are now "Filter and search / Prepare a summary / Browse records / Explore patterns" (`index.html:694,730,777,802`), not "Filters, Summary, Records and Patterns"; the rest of H8 still holds (A-N26).
- **H9 and Appendix C counts:** History's default (collapsed) view now has 43 interactive controls and **0** under 44px at 375, 768 and 1440 (30 at 320, from the 40px cells); with every section open there are 122 controls, 39 under 44px at 375; text under 12px is 44 of 93 at 375 (mostly the 10.9px calendar marks) and 35 of 121 at 1440; chart axis text at 6.0px at 375 was in no earlier count. Seeded Today is 37 (1440) / 34 (375) under 44px and 58 of 352 text nodes under 12px.
- **N2:** "a sixth 'Admin' tab" is wrong: Tools is the sixth tab for everyone and Admin the seventh (A-N43). **N3 (slashed zeros)** is only partly fixed: toasts ("Logged Deep focus (2 hours) at 15:Ø0."), the plan card ("Ø9:ØØ–Ø9:3Ø"), the pills and the date line ("2Ø26") still use the slashed face. **N6** is worse: the header Help, two "?" tooltips, "How it works", the "How points work" disclosure with three links inside, an always-on timeline paragraph, and an `sr-only` help block, with a wrong Help topic (A-H24).
- **Appendix A (A3, A8):** the History row "Week/Day grid + Month heatmap … done" is stale for the same reason as C4.
- **Appendix B (first-time walkthrough):** "Sign-in → forced password change: Code only, not run … Good, friendly" is wrong at `6ee614a` (A-H16). "First activity tap: Tile turns green with ×1 and a stepper; Undo toast" is wrong: a tile tap shows no toast (`web/today.js:217-223`), and Undo exists only on the stepper's removal. "History, new account … 'Share this day'" describes the state before the C5 fix.
- **Appendix C:** `#plan-add` "sits at 748px (1440 / 900 viewport) and 870–882px (320–375px phones)" is now 1,544 (1440), 1,676 (768), 2,067 (375) and 1,919px (320) on a new account (A-H25); Plan page heights are 2,113 / 2,766px (1440 / 375, new account); Plan targets under 44px are 24–40 and text under 12px is 17–27 labels, not 0 and 0; "the tab bar fits without clipping at 320px (294px usable)" is false for six tabs (three labels overflow) and for an admin's seven (labels overlap by 4px); "history calendar cells are 25×25px at every width" describes the pre-fix state.
- **Repository docs, not Part 2:** `README.md:153` calls Help a "tab" and promises in-app help for planning (it is a header button with no Plan topic); `web/robots.txt:1` is dead code behind `public.robots` and its comment is wrong; `web/public/export.html:24` and `web/public/privacy.html:49` are stale against the app.

## Appendix C: Measurements

Page height in px, then interactive elements under 44px, then text nodes under 12px (where the page was measured with those counters). "No overflow" means `scrollWidth ≤ innerWidth` at that width.

| Page and state | 1440 | 375 | Notes |
| --- | --- | --- | --- |
| Landing | 4,628 / 18 / 21 of 143 | 7,342 / 16 / 22 of 143 | no overflow at either; card-3 label wraps at 375, 414, 768 |
| `/register` | 1,182 | 1,475 / 8 / 0 | submit y 821–871 (1440), 1,112–1,162 (375) |
| Public articles (8) | 2,044–2,430 | 2,604–3,635 | 7–13 targets under 44px (mostly inline links), 4 footer nodes at 11px; header 104 / 188px |
| Today, fresh | 3,829 / 33 / 46 of 272 | 6,478 / 33 / 46 of 272 | 320: 7,657 after a check-in and one log |
| Today, seeded | 4,162 / 37 / 58 of 352 | 6,958 / 34 / 58 of 352 | 320: 8,810 |
| Plan, new account | 2,113 / 24 / 17 of 113 | 2,766 / 24 / 17 of 104 | `#plan-add` y 1,544 (1440), 2,067 (375) |
| Plan, seeded | 2,318 / 40 / 27 of 164 | 3,002 / 24 / 17 of 118 | |
| Episode | 2,029 / 26 / 0 of 67 | 2,788 / 26 / 0 of 67 | 320×568: first field below the fold |
| History, default (collapsed) | 1,607 / 0 / 35 of 121 | 2,453 / 0 / 44 of 93 | 320: 30 targets under 44px |
| History, all sections open | 7,383 / 54 | 12,493 / 39 | 122 controls |
| Tools launcher | 923 | 1,059 | |
| Fretboard, 9 cards | 1,500 / 29 | 1,902 / 23, +2px overflow | 320: 2,046, +38px overflow |
| Account | 6,305 / 7 / 5 | 7,651 / 7 / 8 | open Activities section 1,926 (1440), 5,857px (375) |
| Help | 2,094 | 2,245 | |
| Admin People, 75–76 accounts | 19,368 | 21,971 | "Add someone" y 705 (right column) / 21,505 |
| Forced password change | 1,908 | 2,047 | security panel 968px at 375 |

**First-run Today, document y (fresh account):**

| Element | 1440 | 375 |
| --- | --- | --- |
| Masthead bottom / tab bar bottom | 293 / 355 | 297 / fixed bottom nav 740–802 |
| Checklist (y + height) | 382 + 196 | 297 + 357 |
| Check-in panel top / Green button (y + h) | 600 / 798 + 135 | 676 / 866 + 135 |
| Ring panel (y) | 1,044 | 1,106 |
| Timeline panel (y + h) | 600 + 1,058 | 2,229 + 1,349 |
| First tile (y, h) | 2,009, 127 | 4,034, 137 |
| Shared-defaults notice, if present | 219px | 426px |

**Contrast (WCAG ratio):** muted text 5.89–6.18 (light) / 7.59–8.97 (dark); hero CTA 7.75; Episode and Account success text **4.26** (light, fails 4.5 for 16px bold) / 7.5 (dark); `.cal-meta` on a logged spend block **4.36** (light) / **3.87** (dark); Sand border 2.31 (below the 3:1 non-text minimum); History `level-3` cells **3.48**; disabled "Prepare summary" **2.33**; Fretboard quadrant captions **3.42** (light) / 5.65 (dark); red day number on the selected Plan header **3.92**; emergency block 10.18; check-in cells 4.73 / 4.97 / 5.31.

**Timing:** airplane-mode reload 316–445ms; hung connection (every API call stalled 20s) usable after ~26s in my run and 31s in the auditor's (41s for a 30s stall); registration mail 1.0s, reset mail 0.13s locally; History ready 0.37s seeded and 0.50s with 1,242 documents (1.4–2.1s at 4× CPU throttle); Plan with 200 blocks: keyboard repaint 260–363ms, drag frames median 17ms; Fretboard marquee over 400 cards: 12.8s.

## Appendix D: How to reproduce

Nothing here needs a special build. Start the server on a disposable database (`APP_DB=./.local/jiggered.db APP_SECURE_COOKIE=false go run .`), create accounts with `go run . user add NAME` (and `--admin`), and enable registration by pointing Admin → Email & signup at any local SMTP listener that writes mail to a file. Drive it with Playwright at 1440×900 and 375×812 (`isMobile` and `hasTouch` below 500px) and real mouse, keyboard and CDP touch events. For a populated account, `PUT /api/docs/<id>` day documents (`d-YYYY-MM-DD` with `status`, `statusPenalty`, `poorSleep` and `entries`), plan documents (`p-…`) and episodes (`e-<ms>`) with the headers `X-Requested-With: jiggered` and `If-None-Match: *`; a seeded day without `statusPenalty` reads as "full points". Use `page.route` to stall or fail `/api/**` and `context.setOffline` to separate a hung connection from airplane mode. Do not make more than a couple of wrong-password attempts: failed sign-ins and public auth calls are rate-limited per client IP, and shared test environments lock everyone out together.

## Appendix E: Every finding at a glance

96 findings: 4 Critical, 49 High impact, 43 Nice to have. The ID links to the full entry (Where, Evidence, Problem, Fix). The last column is the status after the fix batches described in [Appendix F](#appendix-f-what-the-fix-batches-changed): 48 fixed, 45 partly fixed, 2 decided, 1 open.

| ID | Finding | Pass | Status |
| --- | --- | --- | --- |
| [A-C1](#a-c1-first-run-today-buries-the-check-in-and-logging-something-shows-no-result-on-the-screen-where-you-tapped-phone) | First-run Today buries the check-in, and logging something shows no result on the screen where you tapped (phone) | First-time user + Designer | Partly fixed |
| [A-C2](#a-c2-registration-silently-does-nothing-when-the-username-or-email-is-already-taken-and-every-recovery-path-loops-back-into-it) | Registration silently does nothing when the username or email is already taken, and every recovery path loops back into it | First-time user | Partly fixed |
| [A-C3](#a-c3-starting-points-for-this-day-is-discarded-on-any-day-with-nothing-planned-and-files-a-false-conflict-in-recovery) | "Starting points for this day" is discarded on any day with nothing planned, and files a false conflict in Recovery | First-time user | Fixed |
| [A-C4](#a-c4-the-empty-fretboards-start-with-an-example-button-does-nothing-when-clicked-with-a-mouse-and-enter-on-it-adds-a-blank-card) | The empty Fretboard's "Start with an example" button does nothing when clicked with a mouse, and Enter on it adds a blank card | Designer + First-time user | Fixed |
| [A-H1](#a-h1-choosing-a-colour-for-a-logged-timeline-block-changes-only-its-border-the-fill-never-changes-requested) | Choosing a colour for a logged timeline block changes only its border; the fill never changes (requested) | Designer + First-time user | Fixed |
| [A-H2](#a-h2-register-leads-with-a-pitch-the-submit-button-is-350px-below-the-fold-on-a-phone-there-are-two-h1s-and-the-form-is-four-fields-plus-two-reveal-rows) | `/register` leads with a pitch: the submit button is 350px below the fold on a phone, there are two H1s, and the form is four fields plus two reveal rows | First-time user + Designer | Fixed |
| [A-H3](#a-h3-after-the-email-link-the-new-person-is-still-signed-out-eleven-taps-and-a-welcome-back-with-empty-fields) | After the email link the new person is still signed out: eleven taps and a "Welcome back" with empty fields | First-time user | Partly fixed |
| [A-H4](#a-h4-the-check-your-email-moment-has-no-success-state) | The "check your email" moment has no success state | First-time user + Designer | Fixed |
| [A-H5](#a-h5-a-failed-sign-in-wipes-the-username-and-reloads-the-page) | A failed sign-in wipes the username and reloads the page | First-time user | Partly fixed |
| [A-H6](#a-h6-the-verification-reset-and-recovery-emails-waste-the-inbox-preview-two-of-three-never-say-ignore-this-if-it-wasnt-you-and-nobody-is-named) | The verification, reset and recovery emails waste the inbox preview, two of three never say "ignore this if it wasn't you", and nobody is named | Designer + First-time user | Partly fixed |
| [A-H7](#a-h7-the-recovery-email-link-silently-does-nothing-when-opened-in-the-browser-you-are-signed-in-to) | The recovery-email link silently does nothing when opened in the browser you are signed in to | First-time user (account safety) | Fixed |
| [A-H8](#a-h8-the-only-picture-of-the-product-is-a-mock-with-its-example-label-hidden-and-its-rows-covered-and-the-eight-public-pages-have-no-product-image-at-all) | The only picture of the product is a mock with its "Example" label hidden and its rows covered, and the eight public pages have no product image at all | Designer + First-time user | Partly fixed |
| [A-H9](#a-h9-landing-and-public-pages-have-phone-width-layout-defects-and-a-header-that-costs-20-of-the-first-screen) | Landing and public pages have phone-width layout defects and a header that costs 20% of the first screen | Designer | Fixed |
| [A-H10](#a-h10-every-public-pages-only-sign-up-prompt-is-1737-screens-down-and-its-only-supporting-line-is-the-requirement) | Every public page's only sign-up prompt is 1.7–3.7 screens down and its only supporting line is the requirement | First-time user + Designer | Fixed |
| [A-H11](#a-h11-nothing-says-who-runs-this-server-and-on-a-default-install-every-public-page-sells-an-account-the-visitor-cannot-get) | Nothing says who runs this server, and on a default install every public page sells an account the visitor cannot get | First-time user | Fixed |
| [A-H12](#a-h12-the-public-privacy-page-is-softer-and-less-complete-than-what-the-product-tells-you-after-sign-up) | The public privacy page is softer and less complete than what the product tells you after sign-up | First-time user | Fixed |
| [A-H13](#a-h13-the-landing-sells-spoons-the-product-starts-in-points-and-never-asks) | The landing sells spoons; the product starts in "points" and never asks | First-time user | Partly fixed |
| [A-H14](#a-h14-the-public-docs-describe-the-app-in-words-the-app-does-not-use-and-the-export-steps-cannot-be-followed) | The public docs describe the app in words the app does not use, and the export steps cannot be followed | First-time user | Fixed |
| [A-H15](#a-h15-works-offline-fails-on-a-hung-connection-the-signed-in-app-sits-in-connecting-for-2641-seconds) | "Works offline" fails on a hung connection: the signed-in app sits in "Connecting…" for 26–41 seconds | First-time user + Designer | Partly fixed |
| [A-H16](#a-h16-the-first-screen-of-every-admin-created-account-has-a-dead-sign-in-security--loading-panel-a-no-op-menu-and-an-invisible-error-and-the-promised-ten-second-check-in-is-below-the-fold) | The first screen of every admin-created account has a dead "Sign-in security — Loading" panel, a no-op menu and an invisible error, and the promised "ten-second check-in" is below the fold | First-time user + Designer | Fixed |
| [A-H17](#a-h17-dropping-placing-or-log-it-now-records-activities-as-already-done-at-future-times) | Dropping, placing or "Log it now" records activities as already done at future times | Designer + First-time user | Fixed |
| [A-H18](#a-h18-one-activity-three-signs-every-surface-shows-2-for-a-cost-of-2-except-the-field-you-type-into-and-more-points-1-lowers-recovery) | One activity, three signs: every surface shows "−2" for a cost of 2 except the field you type into, and "More points (+1)" lowers recovery | Designer + First-time user | Partly fixed |
| [A-H19](#a-h19-finishing-a-planned-block-from-the-timeline-throws-the-page-15001800px-away-from-it) | Finishing a planned block from the timeline throws the page 1,500–1,800px away from it | Designer + First-time user | Partly fixed |
| [A-H20](#a-h20-the-lower-half-of-todays-sticky-left-column-cannot-be-reached-until-the-bottom-of-the-page-at-1440900) | The lower half of Today's sticky left column cannot be reached until the bottom of the page at 1440×900 | Designer | Fixed |
| [A-H21](#a-h21-focus-is-dropped-to-body-after-almost-every-action-and-undo-cannot-be-reached-from-the-keyboard) | Focus is dropped to `<body>` after almost every action, and Undo cannot be reached from the keyboard | Designer + First-time user (accessibility on the main path) | Partly fixed |
| [A-H22](#a-h22-adding-or-editing-from-either-timeline-ejects-you-10003500px-down-the-page-to-a-form-that-does-not-name-the-day) | Adding or editing from either timeline ejects you 1,000–3,500px down the page to a form that does not name the day | Designer + First-time user | Partly fixed |
| [A-H23](#a-h23-on-a-phone-both-timelines-trap-swipes-hide-their-handles-and-a-scroll-that-starts-on-a-blocks-edge-resizes-it) | On a phone, both timelines trap swipes, hide their handles, and a scroll that starts on a block's edge resizes it | Designer + First-time user | Partly fixed |
| [A-H24](#a-h24-help-describes-a-today-that-no-longer-exists-other-help-and-readme-claims-are-wrong-and-neither-timeline-is-documented-anywhere) | Help describes a Today that no longer exists, other Help and README claims are wrong, and neither timeline is documented anywhere | First-time user | Partly fixed |
| [A-H25](#a-h25-plans-first-screen-has-no-call-to-action-above-700px-and-the-timeline-starts-a-screen-or-three-below-the-fold) | Plan's first screen has no call to action above 700px, and the timeline starts a screen or three below the fold | First-time user | Partly fixed |
| [A-H26](#a-h26-plans-board-is-hard-to-read-the-any-time-row-eats-the-hours-and-seven-narrow-columns-cut-titles-to-412-characters) | Plan's board is hard to read: the "Any time" row eats the hours, and seven narrow columns cut titles to 4–12 characters | Designer | Partly fixed |
| [A-H27](#a-h27-work-versus-recovery-and-the-cost-itself-are-carried-by-colour-alone-on-short-blocks-blocks-without-a-length-any-time-chips-and-any-coloured-block) | Work versus recovery, and the cost itself, are carried by colour alone on short blocks, blocks without a length, "Any time" chips and any coloured block | Designer | Fixed |
| [A-H28](#a-h28-planning-ahead-still-assumes-a-green-day-earlier-h5-re-verified-and-now-repeated-in-the-timeline) | Planning ahead still assumes a Green day (earlier H5, re-verified and now repeated in the timeline) | First-time user | Fixed |
| [A-H29](#a-h29-the-episode-forms-how-long-it-lasted-error-is-drawn-in-the-success-colour-at-4261-goes-stale-and-the-start-time-field-silently-blanks-the-duration) | The Episode form's "how long it lasted" error is drawn in the success colour at 4.26:1, goes stale, and the start-time field silently blanks the duration | Designer + First-time user | Fixed |
| [A-H30](#a-h30-episode-save-does-nothing-on-an-untouched-form-and-a-note-only-save-creates-a-symptom-less-still-going-episode-that-never-expires) | Episode "Save" does nothing on an untouched form, and a note-only save creates a symptom-less "Still going" episode that never expires | First-time user | Partly fixed |
| [A-H31](#a-h31-record-when-it-ended-opens-the-full-edit-form-and-asks-for-a-duration-bucket-the-end-time-is-hidden-until-a-select-changes) | "Record when it ended" opens the full edit form and asks for a duration bucket; the end time is hidden until a select changes | Designer + First-time user | Partly fixed |
| [A-H32](#a-h32-history-can-no-longer-show-an-episode-beside-a-check-in-or-an-activity-the-earlier-c4-fix-was-deleted-in-dd201fc-and-nothing-replaced-it) | History can no longer show an episode beside a check-in or an activity: the earlier C4 fix was deleted in `dd201fc` and nothing replaced it | Designer + First-time user | Partly fixed |
| [A-H33](#a-h33-the-exports-contradict-each-other-on-the-sign-of-a-cost-and-never-say-what-a-point-or-a-colour-is) | The exports contradict each other on the sign of a cost and never say what a "point" or a colour is | Designer + First-time user | Fixed |
| [A-H34](#a-h34-on-a-phone-the-history-calendar-is-tappable-for-30-days-only-90180365-days-are-1994px-cells-with-no-letters) | On a phone the History calendar is tappable for 30 days only: 90/180/365 days are 19/9/4px cells with no letters | Designer | Partly fixed |
| [A-H35](#a-h35-on-a-stale-device-moving-or-recolouring-a-fretboard-card-silently-reverts-the-other-devices-change-to-that-card) | On a stale device, moving or recolouring a Fretboard card silently reverts the other device's change to that card | Designer + First-time user (trust) | Fixed |
| [A-H36](#a-h36-fretboard-cards-paint-over-the-sticky-tab-bar-and-over-the-card-removed-undo-toast) | Fretboard cards paint over the sticky tab bar and over the "Card removed. Undo" toast | Designer | Fixed |
| [A-H37](#a-h37-phone-fretboard-the-board-sticks-out-of-its-card-and-widens-the-page-cards-are-102px-wide-the-canvas-swallows-swipes-and-double-tap-never-edits) | Phone Fretboard: the board sticks out of its card and widens the page, cards are 102px wide, the canvas swallows swipes, and double-tap never edits | Designer + First-time user | Fixed |
| [A-H38](#a-h38-fretboard-hides-its-save-offline-and-error-states-and-a-refused-save-removes-the-card-from-view) | Fretboard hides its save, offline and error states, and a refused save removes the card from view | First-time user | Partly fixed |
| [A-H39](#a-h39--card-and-typed-todays-three-entries-land-on-a-fixed-20-slot-cascade-so-a-brain-dump-piles-up-on-itself) | "+ Card" and typed today's-three entries land on a fixed 20-slot cascade, so a brain dump piles up on itself | Designer + First-time user | Partly fixed |
| [A-H40](#a-h40-a-sixth-top-level-tab-for-one-tool-a-launcher-that-does-not-say-what-the-tool-does-and-a-first-screen-that-is-mostly-header) | A sixth top-level tab for one tool, a launcher that does not say what the tool does, and a first screen that is mostly header | First-time user + Designer | Decided |
| [A-H41](#a-h41-fretboards-status-pills-look-like-a-palette-but-are-filters-and-recolouring-editing-and-deleting-hide-behind-right-click-number-keys-or-a-long-press) | Fretboard's status pills look like a palette but are filters, and recolouring, editing and deleting hide behind right-click, number keys or a long-press | First-time user | Fixed |
| [A-H42](#a-h42-fretboards-keyboard-and-screen-reader-path-has-five-holes) | Fretboard's keyboard and screen-reader path has five holes | First-time user (accessibility on the main path) | Partly fixed |
| [A-H43](#a-h43-save-confirmations-and-validation-messages-sit-under-the-button-and-out-of-sight-on-phones-and-the-success-green-fails-contrast-at-4261-app-wide) | Save confirmations and validation messages sit under the button and out of sight on phones, and the success green fails contrast at 4.26:1 app-wide | Designer + First-time user | Partly fixed |
| [A-H44](#a-h44-two-step-setup-asks-for-the-password-a-second-time-after-you-have-scanned-the-code-and-the-on-screen-steps-never-say-so) | Two-step setup asks for the password a second time after you have scanned the code, and the on-screen steps never say so | First-time user | Fixed |
| [A-H45](#a-h45-admin-row-actions-fail-silently-both-the-error-and-the-success-message-are-erased-by-the-list-refresh) | Admin row actions fail silently: both the error and the success message are erased by the list refresh | First-time user (operator) | Fixed |
| [A-H46](#a-h46-the-one-time-temporary-password-lands-out-of-sight-and-add-someone-is-the-last-thing-on-the-page) | The one-time temporary password lands out of sight, and "Add someone" is the last thing on the page | First-time user + Designer | Fixed |
| [A-H47](#a-h47-a-second-browser-tab-is-silently-dead-it-looks-editable-ignores-input-and-says-nothing) | A second browser tab is silently dead: it looks editable, ignores input, and says nothing | First-time user | Partly fixed |
| [A-H48](#a-h48-the-activity-and-list-editor-is-224px-per-row-on-a-phone-the-points-box-has-no-visible-label-and-validation-errors-are-out-of-sight) | The activity and list editor is 224px per row on a phone, the points box has no visible label, and validation errors are out of sight | Designer + First-time user | Partly fixed |
| [A-H49](#a-h49-account-is-ordered-by-what-was-cheap-to-build-and-the-energy-allowance-is-the-fifth-of-eight-panels) | Account is ordered by what was cheap to build, and the energy allowance is the fifth of eight panels | Designer + First-time user | Fixed |
| [A-N1](#a-n1-the-hero-headlines-tracking-collapses-the-word-spaces) | The hero headline's tracking collapses the word spaces | Designer | Fixed |
| [A-N2](#a-n2-the-button-system-is-fragmented-across-three-stylesheets-and--marks-buttons-that-do-not-leave-the-page) | The button system is fragmented across three stylesheets, and `↗` marks buttons that do not leave the page | Designer | Partly fixed |
| [A-N3](#a-n3-template-tells-and-vague-copy-on-the-landing-page-and-a-voice-that-turns-defensive-one-click-later) | Template tells and vague copy on the landing page, and a voice that turns defensive one click later | Designer + First-time user | Decided |
| [A-N4](#a-n4-public-pages-and-sign-in-force-light-mode-while-the-app-follows-the-os-and-there-are-no-print-styles) | Public pages and sign-in force light mode while the app follows the OS, and there are no print styles | Designer | Fixed |
| [A-N5](#a-n5-small-auth-details) | Small auth details | Designer | Partly fixed |
| [A-N6](#a-n6-verify-and-reset-result-screens-keep-stale-instructions-an-orphaned-hint-and-a-focus-box) | Verify and reset result screens keep stale instructions, an orphaned hint and a focus box | Designer | Fixed |
| [A-N7](#a-n7-the-public-header-leaves-out-privacy-and-how-it-works-has-no-current-page-state-and-the-footer-repeats-it-under-different-names) | The public header leaves out Privacy and "how it works", has no current-page state, and the footer repeats it under different names | Designer | Fixed |
| [A-N8](#a-n8-publiccss-specificity-collisions-make-three-components-render-at-sizes-nobody-chose) | `public.css` specificity collisions make three components render at sizes nobody chose | Designer | Fixed |
| [A-N9](#a-n9-dead-ends-on-the-utility-urls) | Dead ends on the utility URLs | First-time user | Partly fixed |
| [A-N10](#a-n10-install-and-pwa-story-is-prose-only) | Install and PWA story is prose only | Designer + First-time user | Partly fixed |
| [A-N11](#a-n11-signed-in-people-on-the-public-pages-are-told-to-create-an-account-and-the-offline-guide-cannot-be-read-offline) | Signed-in people on the public pages are told to create an account, and the offline guide cannot be read offline | First-time user | Partly fixed |
| [A-N12](#a-n12-copy-and-consistency-nits-across-the-public-pages) | Copy and consistency nits across the public pages | Designer | Partly fixed |
| [A-N13](#a-n13-on-today-the-dashed-palette-chips-contradict-the-legend-the-sync-pill-pluralises-badly-and-covers-the-masthead-and-wording-differs-between-paths-to-the-same-result) | On Today the dashed palette chips contradict the legend, the sync pill pluralises badly and covers the masthead, and wording differs between paths to the same result | Designer + First-time user | Partly fixed |
| [A-N14](#a-n14-the-shared-defaults-notice-is-the-only-interrupt-426px-tall-on-a-phone-above-the-page-heading-on-every-tab) | The shared-defaults notice is the only interrupt: 426px tall on a phone, above the page heading, on every tab | First-time user | Partly fixed |
| [A-N15](#a-n15-plan-one-plan-is-drawn-in-four-to-five-places-and-plans-own-today-column-ignores-what-is-already-logged) | Plan: one plan is drawn in four to five places, and Plan's own Today column ignores what is already logged | Designer | Open |
| [A-N16](#a-n16-timeline-touch-targets-tiny-type-and-unlabeled-day-header-numbers) | Timeline touch targets, tiny type, and unlabeled day-header numbers | Designer | Fixed |
| [A-N17](#a-n17-plans-keyboard-path-47-tab-presses-to-the-first-block-and-59-to-add) | Plan's keyboard path: 47 Tab presses to the first block and 59 to "Add" | Designer | Partly fixed |
| [A-N18](#a-n18-plan-form-details-validation-a-12-hour-time-field-against-a-24-hour-board-and-a-form-that-never-names-the-day) | Plan form details: validation, a 12-hour time field against a 24-hour board, and a form that never names the day | First-time user | Partly fixed |
| [A-N19](#a-n19-after-saving-an-episode-there-is-one-word-of-confirmation-and-the-page-stays-scrolled-to-the-bottom) | After saving an episode there is one word of confirmation and the page stays scrolled to the bottom | First-time user | Fixed |
| [A-N20](#a-n20-the-emergency-number-stays-generic-until-the-person-finds-the-region-setting) | The emergency number stays generic until the person finds the region setting | First-time user | Fixed |
| [A-N21](#a-n21-episode-form-polish-two-question-sizes-37px-chips-an-onset-that-cannot-be-cleared-and-a-tab-that-never-says-symptom) | Episode form polish: two question sizes, 37px chips, an onset that cannot be cleared, and a tab that never says "symptom" | Designer | Partly fixed |
| [A-N22](#a-n22-draft-expiry-is-explained-only-in-help-and-the-discard-dialog-uses-jargon-the-whole-episode-form-locks-while-a-save-waits-for-the-server) | Draft expiry is explained only in Help, and the Discard dialog uses jargon; the whole Episode form locks while a save waits for the server | First-time user | Partly fixed |
| [A-N23](#a-n23-chart-axis-text-is-6px-on-a-375px-phone) | Chart axis text is 6px on a 375px phone | Designer | Fixed |
| [A-N24](#a-n24-two-stylesheet-colour-bugs-in-the-history-detail-and-calendar) | Two stylesheet colour bugs in the History detail and calendar | Designer | Fixed |
| [A-N25](#a-n25-pattern-cards-promote-tiny-samples-to-headlines) | Pattern cards promote tiny samples to headlines | Designer + First-time user | Fixed |
| [A-N26](#a-n26-history-still-opens-with-an-export-and-share-this-day-is-neither-a-share-nor-easy-to-undo) | History still opens with an export, and "Share this day" is neither a share nor easy to undo | Designer + First-time user | Fixed |
| [A-N27](#a-n27-history-copy-is-wrong-in-two-states-unfiltered-matching-failed-load) | History copy is wrong in two states (unfiltered "matching", failed load) | First-time user | Partly fixed |
| [A-N28](#a-n28-the-summary-preview-is-a-416px-window-onto-a-3076px-534px-wide-document-on-a-phone) | The summary preview is a 416px window onto a 3,076px, 534px-wide document on a phone | Designer + First-time user | Fixed |
| [A-N29](#a-n29-the-opt-in-weekly-review-is-the-last-thing-on-today-and-lands-on-an-open-date-range-form) | The opt-in weekly review is the last thing on Today and lands on an open date-range form | First-time user | Fixed |
| [A-N30](#a-n30-fretboard-colour-every-new-card-is-born-red-the-legend-swatch-disagrees-with-the-card-and-high-contrast-mode-erases-the-status) | Fretboard colour: every new card is born red, the legend swatch disagrees with the card, and high-contrast mode erases the status | Designer | Fixed |
| [A-N31](#a-n31-fretboard-with-200400-cards-is-slow-and-has-no-zoom-pan-or-list) | Fretboard with 200–400 cards is slow and has no zoom, pan or list | Designer | Partly fixed |
| [A-N32](#a-n32-fretboard-limits-are-silent-truncation-at-240-characters-has-no-counter-and-duplicate-and-typed-entries-at-400-items-do-nothing-without-saying-so) | Fretboard limits are silent: truncation at 240 characters has no counter, and Duplicate and typed entries at 400 items do nothing without saying so | First-time user | Fixed |
| [A-N33](#a-n33-fretboard-copy-and-logic-slips) | Fretboard copy and logic slips | First-time user | Partly fixed |
| [A-N34](#a-n34-fretboard-text-is-small-the-caption-layer-is-3421-and-most-targets-are-under-44px) | Fretboard text is small, the caption layer is 3.42:1, and most targets are under 44px | Designer | Fixed |
| [A-N35](#a-n35-todays-three-is-an-island-and-its-list-column-is-63px-wide) | "Today's three" is an island, and its list column is 63px wide | First-time user + Designer | Partly fixed |
| [A-N36](#a-n36-your-data-leads-with-a-disabled-analytics-consent-block) | "Your data" leads with a disabled analytics-consent block | Designer | Fixed |
| [A-N37](#a-n37-the-sign-in-security-panel-looks-unfinished-and-explains-nothing-when-email-is-unavailable) | The Sign-in security panel looks unfinished and explains nothing when email is unavailable | Designer | Partly fixed |
| [A-N38](#a-n38-profile-copy-promises-more-than-the-product-does-the-answer-to-collected-but-never-used) | Profile copy promises more than the product does (the answer to "collected but never used") | First-time user | Fixed |
| [A-N39](#a-n39-destructive-confirmations-are-native-dialogs-and-deleting-your-account-ends-on-a-bare-sign-in-page) | Destructive confirmations are native dialogs, and deleting your account ends on a bare sign-in page | Designer + First-time user | Partly fixed |
| [A-N40](#a-n40-export-and-restore-messaging-the-device-copy-is-silent-and-the-file-error-wall-is-jargon) | Export and restore messaging: the device copy is silent, and the file-error wall is jargon | First-time user | Fixed |
| [A-N41](#a-n41-operator-commands-are-spelled-three-ways-and-admin-never-says-setup-is-unfinished) | Operator commands are spelled three ways, and Admin never says setup is unfinished | First-time user (operator) | Fixed |
| [A-N42](#a-n42-error-and-offline-copy-a-misleading-fatal-page-a-silent-401-raw-ids-in-recovery-and-an-overlapping-status-pill) | Error and offline copy: a misleading fatal page, a silent 401, raw ids in Recovery, and an overlapping status pill | First-time user | Fixed |
| [A-N43](#a-n43-the-phone-tab-bar-six-labels-overflow-at-320px-the-admins-seven-collide-and-admins-own-tables-do-not-fit) | The phone tab bar: six labels overflow at 320px, the admin's seven collide, and Admin's own tables do not fit | Designer | Partly fixed |

## Appendix F: What the fix batches changed

Part 1 describes revision `6ee614a`. Two pull requests have changed the code since: #88 (the first fixes, merged together with this document) and #89 (the seven decisions the maintainer made, and every other finding that could be fixed without one). Each status below was checked against the code after the last batch, not copied from a commit message, so a finding that is not marked **Fixed** is not done. The Status column of [Appendix E](#appendix-e-every-finding-at-a-glance) is the same data in one table.

### The seven decisions

Seven findings needed a product decision. They were put to the maintainer one at a time, with options, and built as answered.

| Finding | Answer | What was built |
| --- | --- | --- |
| [A-C2](#a-c2-registration-silently-does-nothing-when-the-username-or-email-is-already-taken-and-every-recovery-path-loops-back-into-it) | Say "username taken" | Registration answers "That username is taken. Try another." (409) and returns focus to the field. A taken *address* still looks like an unknown one, and there is no distinct "too many requests" answer, because either would tell a prober an address is new. `TestDuplicateRegistrationsSendNoMailAndLookTheSame` pins both halves. |
| [A-H34](#a-h34-on-a-phone-the-history-calendar-is-tappable-for-30-days-only-90180365-days-are-1994px-cells-with-no-letters) | Page five weeks at a time | On a phone the History calendar shows five weeks with Earlier and Later, so every day stays tappable at any range. |
| [A-H40](#a-h40-a-sixth-top-level-tab-for-one-tool-a-launcher-that-does-not-say-what-the-tool-does-and-a-first-screen-that-is-mostly-header) | Move it to the account menu | Built in #89: no sixth tab, and Fretboard opened from the account menu straight to its board. On 6 October the maintainer asked for the Tools tab back: it is a tab again with Fretboard in its launcher, and the account menu keeps a Fretboard shortcut that opens the board. |
| [A-H13](#a-h13-the-landing-sells-spoons-the-product-starts-in-points-and-never-asks) | Both | The Spoon Theory guide links to `/register?w=spoons` (kept across the email round trip in the same browser), and the first-run checklist has an optional points-or-spoons choice for everyone else. |
| [A-H28](#a-h28-planning-ahead-still-assumes-a-green-day-earlier-h5-re-verified-and-now-repeated-in-the-timeline) | Day-type chips per day | Plan days get Green, Amber, Red and poor-sleep choices that take the same amounts off the budget as a check-in; a number typed by hand still wins. |
| [A-H11](#a-h11-nothing-says-who-runs-this-server-and-on-a-default-install-every-public-page-sells-an-account-the-visitor-cannot-get) | Add operator settings | Two optional Admin settings, "Who runs this server" and "How to reach them" (plain text, 80 and 160 characters), shown on the landing, privacy and pricing pages; while registration is closed they say whom to ask. |
| [A-H8](#a-h8-the-only-picture-of-the-product-is-a-mock-with-its-example-label-hidden-and-its-rows-covered-and-the-eight-public-pages-have-no-product-image-at-all) | Capture real screenshots | The landing hero is a real capture of Today with example data, served from a public `/shots/` route that serves only that folder. Pictures for the other public pages were not made. |

### The batches in #89

| Batch | What it covered |
| --- | --- |
| A | The seven decisions above. |
| B | Timelines: editing opens a sheet over the page, phone swipes scroll the page, short blocks and "Any time" chips show their cost as text, the Plan start card at every width. |
| C | Account: the energy allowance first, Save buttons within reach on a phone, compact activity and list rows. |
| D | Exports with one sign convention; emails that open with the message and say what to do if it wasn't you; "Check your inbox"; one-tap episode end. |
| E | Small fixes: "Log it now", verified and reset screens, admin outcomes kept on screen, Fretboard colour and focus. |
| F | Public pages: dark mode, a real 404, header and footer, one-box sign-up. |
| G | Today, Plan, Episode and History: form wording, focus, Undo from the keyboard, readable charts and summaries. |
| H | Fretboard, Account and Admin: visible states, one-time secrets, paged people, plainer errors, one spelling for operator commands. |

Before each push the repository's own checks ran locally: formatting, lint and the Node tests (`npm --prefix test run check`), `go vet` and `go test`, the browser scenarios (`npm --prefix test run browser`) and the public-page check (`node test/browser-public.cjs`). Behaviour changes came with new or updated tests. Layout was re-checked in Chromium at 1440 and 375 pixels; real devices, screen readers, Firefox and Safari were not run, as in the original audit.

### Fixed (48)

| ID | What changed |
| --- | --- |
| [A-C3](#a-c3-starting-points-for-this-day-is-discarded-on-any-day-with-nothing-planned-and-files-a-false-conflict-in-recovery) | planner.js passes `before` only when the plan document exists (planFields), so an empty day saves the allowance with no false "deleted record" conflict. Leftover: out-of-range numbers (0, 31, 6.5) still snap back with no message. |
| [A-C4](#a-c4-the-empty-fretboards-start-with-an-example-button-does-nothing-when-clicked-with-a-mouse-and-enter-on-it-adds-a-blank-card) | fretboard.js canvas pointerdown and keydown return early for button/input/textarea; test/browser-tools.cjs now clicks `[data-fb="example"]` with a real mouse. |
| [A-H1](#a-h1-choosing-a-colour-for-a-logged-timeline-block-changes-only-its-border-the-fill-never-changes-requested) | dashboard.css: `.cal-block.cal-logged.cal-tone` sets the 38% tint fill after the cost tints, and swatches preview the real result. Polish still open: Sand/Sage colours unchanged, `.is-done` opacity .72, "Automatic" swatch stripes, no tone test. |
| [A-H2](#a-h2-register-leads-with-a-pitch-the-submit-button-is-350px-below-the-fold-on-a-phone-there-are-two-h1s-and-the-form-is-four-fields-plus-two-reveal-rows) | login.html/presence.css (&lt;=760px): pitch hidden on phones, aside title is a `<p>` (one h1), confirm-password removed, Show toggle inside the field at 44px, enterkeyhint set. |
| [A-H4](#a-h4-the-check-your-email-moment-has-no-success-state) | login.html/login.js: after sending, a "Check your inbox" box names the masked address and takes focus, the hedge text is cleared, the button counts down 30s, and the fields stay editable for typos. Minor: no "opens on this device" hint. |
| [A-H7](#a-h7-the-recovery-email-link-silently-does-nothing-when-opened-in-the-browser-you-are-signed-in-to) | app.js boot handles #verify= and #reset= while signed in (verifies and toasts, opens Account; reset link says sign out first); security.js reloads on visibilitychange; server answers "Recovery email verified." No test covers the signed-in case. |
| [A-H9](#a-h9-landing-and-public-pages-have-phone-width-layout-defects-and-a-header-that-costs-20-of-the-first-screen) | presence.css/public.css: mini-chart/budget are blocks, `.p-button` is nowrap, header breakpoint 900px with "Join free" on the logo row; browser-public.cjs asserts the phone header is &lt;=130px. Two rows, not the one the audit proposed. |
| [A-H10](#a-h10-every-public-pages-only-sign-up-prompt-is-1737-screens-down-and-its-only-supporting-line-is-the-requirement) | public.go open-state line promises an outcome; energy, symptoms, spoons and start pages have a `.public-cta` button under the lead; aside reads "Start with one check-in."; /pricing box has a button; "Next:" lines are single links. |
| [A-H11](#a-h11-nothing-says-who-runs-this-server-and-on-a-default-install-every-public-page-sells-an-account-the-visitor-cannot-get) | Operator name/contact settings (remote_services.go, services.js Admin form) show on landing, privacy and pricing; closed state reads "This Jiggered is invite-only" and names whom to ask. Minor: the three-row box sits in the landing privacy section, not under the hero CTA. |
| [A-H12](#a-h12-the-public-privacy-page-is-softer-and-less-complete-than-what-the-product-tells-you-after-sign-up) | privacy.html has a five-row "Who can see what" list (admins can sign in with a temporary password, 180-day audit trail after deletion, stored email), the usage-counts sentence, and "See pricing and access before getting started". |
| [A-H14](#a-h14-the-public-docs-describe-the-app-in-words-the-app-does-not-use-and-the-export-steps-cannot-be-followed) | export.html, energy.html and start.html now use the real labels (Period, Prepare summary, Days/Episodes/Activities as CSV, Green/Amber/Red). Trivial leftover: dead `#sum-range` hint still at tooltips.js:38. |
| [A-H16](#a-h16-the-first-screen-of-every-admin-created-account-has-a-dead-sign-in-security--loading-panel-a-no-op-menu-and-an-invisible-error-and-the-promised-ten-second-check-in-is-below-the-fold) | app.js forced-password screen: Sign-in security panel hidden after accountView.init, "Temporary password (the one you were given)" label, shorter hint, new banner, Help and account-menu items hidden. Leftover: no show-password toggles there; onboarding card still sits above the check-in. |
| [A-H17](#a-h17-dropping-placing-or-log-it-now-records-activities-as-already-done-at-future-times) | today.js logAt plans a drop or placement at a later time today (plan document, toast "Planned X for T. Tap it when it's done." with Undo); "Log it now" now calls logOne, the same record as a tile tap. |
| [A-H20](#a-h20-the-lower-half-of-todays-sticky-left-column-cannot-be-reached-until-the-bottom-of-the-page-at-1440900) | style.css (>=960px): sticky `.today-side` now has max-height calc(100vh - 92px), overflow-y:auto and overscroll containment (the audit's minimum change); the poor-sleep switch was not moved. |
| [A-H27](#a-h27-work-versus-recovery-and-the-cost-itself-are-carried-by-colour-alone-on-short-blocks-blocks-without-a-length-any-time-chips-and-any-coloured-block) | Signed cost is now text: .cal-cost-badge on blocks of 30 min or less (including no-length ones) and .cal-chip-cost on Any-time chips (calendar.js, dashboard.css); longer blocks show it in the meta line. No hatch cue added; 31-44 min desktop blocks may clip the meta line (unmeasured). |
| [A-H28](#a-h28-planning-ahead-still-assumes-a-green-day-earlier-h5-re-verified-and-now-repeated-in-the-timeline) | Decision applied: Plan day has Green/Amber/Red chips plus Poor sleep toggle (index.html #plan-daytype, planner.js setDayType) storing allowance/status/poorSleep with check-in amounts; hint reworded; browser-planner test covers it. Green shows pressed until a type is set; no "assumes Green" tooltip. |
| [A-H29](#a-h29-the-episode-forms-how-long-it-lasted-error-is-drawn-in-the-success-colour-at-4261-goes-stale-and-the-start-time-field-silently-blanks-the-duration) | Errors are red (5.1:1) and success is green #26774a (5.5:1); the form is `novalidate` with plain time sentences; a blanked duration gets an inline hint with `aria-invalid` and a "(required)" label; a complaint clears when the form is corrected instead of turning green; phone pages keep the focused field clear of the fixed bars. |
| [A-H33](#a-h33-the-exports-contradict-each-other-on-the-sign-of-a-cost-and-never-say-what-a-point-or-a-colour-is) | Days CSV writes "spent 2"/"recovered 1" with points_spent and points_recovered columns; print table says "Used 2 points"/"Recovered 1 point"; small print defines green/amber/red and points; on-screen note reworded. Not done: Days table still prints "used of allowance" without "over"; no "Include my name" tick. |
| [A-H35](#a-h35-on-a-stale-device-moving-or-recolouring-a-fretboard-card-silently-reverts-the-other-devices-change-to-that-card) | Card changes now travel as field-level "fields" patches (fretboard.js fieldPatch, fretboard-model.js applyBoardPatch); a patch for a deleted card is dropped; model test: a move then a status both survive, and a late edit to a deleted card is dropped. |
| [A-H36](#a-h36-fretboard-cards-paint-over-the-sticky-tab-bar-and-over-the-card-removed-undo-toast) | isolation: isolate on .fb-canvas (tools.css) keeps card z-indexes below the tab bar, toast and menu. |
| [A-H37](#a-h37-phone-fretboard-the-board-sticks-out-of-its-card-and-widens-the-page-cards-are-102px-wide-the-canvas-swallows-swipes-and-double-tap-never-edits) | Board track minmax(0,1fr), no min sizes, axis margin/arrows/labels shrink, cards max 62% and clamped to 3 lines, canvas touch-action pan-y, no touch marquee, tap on selected card edits (tools.css, fretboard.js). Example board positions unchanged, so its cards may still touch on a phone. |
| [A-H41](#a-h41-fretboards-status-pills-look-like-a-palette-but-are-filters-and-recolouring-editing-and-deleting-hide-behind-right-click-number-keys-or-a-long-press) | Floating action bar for the selection (status buttons, Edit text, Add to today's three, Delete), legend labelled "Show:", new cards switch their status filter on (fretboard.js, tools.css). Not done: empty state omits right-click/press-and-hold; typed three-things do not clear a hidden Not-started filter. |
| [A-H44](#a-h44-two-step-setup-asks-for-the-password-a-second-time-after-you-have-scanned-the-code-and-the-on-screen-steps-never-say-so) | Password stays in the field through setup and clears only after enable/cancel/disable/regenerate succeed; key shown in groups of four with a Copy key button (security.js). Not done: code box still labelled "Authenticator or unused recovery code"; a wrong code clears the code field. |
| [A-H45](#a-h45-admin-row-actions-fail-silently-both-the-error-and-the-success-message-are-erased-by-the-list-refresh) | Row actions check the confirm-password field first (message, scroll, focus) before any dialog, and outcome or error is set after loadUsers() so it survives the refresh (admin.js). Not done: shared password panel remains; the five admin password fields are not unified. |
| [A-H46](#a-h46-the-one-time-temporary-password-lands-out-of-sight-and-add-someone-is-the-last-thing-on-the-page) | Temporary password opens in a modal dialog with Copy focused (admin.js reveal); People order is Add someone then list; list paged twenty at a time with "Show more". Not done: password stays in a pre-wrap block rather than a nowrap kbd. |
| [A-H49](#a-h49-account-is-ordered-by-what-was-cheap-to-build-and-the-energy-allowance-is-the-fifth-of-eight-panels) | Order is now Energy & lists, Profile, Password, Sign-in security, Devices, Your data, Privacy, Delete; chips follow it and focus the section heading; zero totals hidden on new accounts; Devices has Sign out. Not done: Profile not split; hero still repeats the name. |
| [A-N1](#a-n1-the-hero-headlines-tracking-collapses-the-word-spaces) | presence.css `.hero h1` is now `letter-spacing:-0.045em; word-spacing:0.12em`, the audit's exact fix. |
| [A-N4](#a-n4-public-pages-and-sign-in-force-light-mode-while-the-app-follows-the-os-and-there-are-no-print-styles) | presence.css: hard-coded light theme removed, dark-scheme token set added (buttons invert via --accent/--on-accent); public.css `@media print` hides header, CTA, `.public-next`, footer nav; dark theme-color metas. browser-public.cjs covers dark and print. |
| [A-N6](#a-n6-verify-and-reset-result-screens-keep-stale-instructions-an-orphaned-hint-and-a-focus-box) | login.js success branch retitles the H1 ("Email verified"/"Password changed"), hides `.meta` text, labels and `[data-signin]`, leaves one primary "Sign in"; presence.css sets `h1[tabindex="-1"]:focus-visible{outline:none}`. |
| [A-N7](#a-n7-the-public-header-leaves-out-privacy-and-how-it-works-has-no-current-page-state-and-the-footer-repeats-it-under-different-names) | public.go `Nav` header (Energy, Symptoms, How it works, Privacy), grouped footer (Product/Guides/Trust/Account), `aria-current` plus underline CSS, footer small 12px. Residual: header uses short labels, footer full ones (Energy vs Energy tracking). |
| [A-N8](#a-n8-publiccss-specificity-collisions-make-three-components-render-at-sizes-nobody-chose) | public.css has `.public-article p:not(.eyebrow):not(.choice-status)`, `.public-example{display:block}`, `.public-next{max-width:760px}`; eyebrows removed from every web/public/*.html. |
| [A-N16](#a-n16-timeline-touch-targets-tiny-type-and-unlabeled-day-header-numbers) | dashboard.css: 12px rail/corner/meta, `.cal-chip` 44px on coarse plus hover, larger remove target, `TOUCH_SLOP=8` (calendar.js), headers read "−4 left" (`minus()`, aria-label, "!" mark), `--red-text:#a14b38`. Residual: no day-header hover; cost badges 11-11.5px. |
| [A-N19](#a-n19-after-saving-an-episode-there-is-one-word-of-confirmation-and-the-page-stays-scrolled-to-the-bottom) | episodes.js: a new episode scrolls to top and says "Saved. {when} · {symptoms}."; edits remember their origin tab, button reads "Back to History/Today" and returns there. Not done: "View in History" / "Add another" links. |
| [A-N20](#a-n20-the-emergency-number-stays-generic-until-the-person-finds-the-region-setting) | index.html `data-region-hint` line "Set your country in Account so this shows your number." shows while region is empty (region.js `applyRegion`). |
| [A-N23](#a-n23-chart-axis-text-is-6px-on-a-375px-phone) | history-charts.js draws a 320x220 chart at 700px and below (history.js `narrowCharts` redraws on rotate). Labels render about 12px; browser-history.cjs asserts the 320 viewBox and at least 10px. Nothing remains. |
| [A-N24](#a-n24-two-stylesheet-colour-bugs-in-the-history-detail-and-calendar) | style.css now scopes `.panel.recovery{border:2px solid var(--red)}`, so the day-detail "+1" boxes are gone. `.matrix-cell.level-3` uses the 85% accent mix with `--bg` ink (about 5.0:1). Nothing remains. |
| [A-N25](#a-n25-pattern-cards-promote-tiny-samples-to-headlines) | history.js `renderPatterns`: the sleep card needs at least 5 days per group and leads with counts ("4 of 6..."). The weekday card appears only when all seven weekdays have at least 4 check-ins, and shows all seven. "Most often" lists keep count >= 2, else "Recorded once" / "Each noticed once". |
| [A-N26](#a-n26-history-still-opens-with-an-export-and-share-this-day-is-neither-a-share-nor-easy-to-undo) | "Prepare summary" is now `secondary` with a visible reason (`#history-prepare-why`). The day card has primary "Edit day" and "Print or export this day". history.js puts a Return-to-previous-period copy inside the Prepare panel. Remains: the button still sits in the Period bar, not the panel header. |
| [A-N28](#a-n28-the-summary-preview-is-a-416px-window-onto-a-3076px-534px-wide-document-on-a-phone) | style.css at 700px and below: `#summary-preview` is unbounded and its tables reflow as stacked cards via `data-label` (history.js). Desktop keeps 26rem and gains tabindex=0, role=region and aria-label (index.html). browser-history.cjs checks card rows at 320 and 390. |
| [A-N29](#a-n29-the-opt-in-weekly-review-is-the-last-thing-on-today-and-lands-on-an-open-date-range-form) | `#weekly-review` now sits right after `#today-ongoing`, above the check-in (index.html). history.js opens the filter panel only when `activeFilters().length`, and `openPeriod` scrolls to `#history-matrix`. Account copy states the three-check-in condition. |
| [A-N30](#a-n30-fretboard-colour-every-new-card-is-born-red-the-legend-swatch-disagrees-with-the-card-and-high-contrast-mode-erases-the-status) | tools.css: `--fb-todo` is a neutral tint (new cards not red); swatch and card both use the dashed `--fb-external`; a `forced-colors` rule keeps dot and swatch colours. Not done: a distinct shape per status (only "not mine" is a hollow ring). |
| [A-N32](#a-n32-fretboard-limits-are-silent-truncation-at-240-characters-has-no-counter-and-duplicate-and-typed-entries-at-400-items-do-nothing-without-saying-so) | fretboard.js: the card editor shows "212 / 240" from 200 characters (aria-live). `duplicate()` toasts at 400 items and returns before committing (no undo entry). A typed today's-three entry toasts "...without a card". The three-list input itself still has no counter. |
| [A-N34](#a-n34-fretboard-text-is-small-the-caption-layer-is-3421-and-most-targets-are-under-44px) | tools.css: `.fb-quad` is .75rem with opacity removed; `.fb-chip` .75rem. Under `pointer:coarse` the x, checkbox, legend pills, Undo/Redo, axis labels and menu rows are 44px and menu `kbd` is hidden. Global `::placeholder` in style.css. Leftovers: cards get no 44px rule; the 10px `.help-eyebrow` is untouched. |
| [A-N36](#a-n36-your-data-leads-with-a-disabled-analytics-consent-block) | account.js injects the usage-consent form below "Your privacy". It is hidden unless the operator offers it or it is already enabled, and the long paragraph sits in `<details>About optional usage counts`. |
| [A-N38](#a-n38-profile-copy-promises-more-than-the-product-does-the-answer-to-collected-but-never-used) | All five items: display-name placeholder "Shown next to your avatar"; focus hint says where it shows; "Date format" with example dates (editor.js) and README:99; restore preview says replaced records can be put back; Delete adds "Copies already in the server's backups are not erased". |
| [A-N40](#a-n40-export-and-restore-messaging-the-device-copy-is-silent-and-the-file-error-wall-is-jargon) | account.js: the device copy says "Device recovery copy downloaded... can't be restored on this page". Restore detects `jiggered-device-recovery-v1` files and explains. The issue list is cut to three plus "...and N more", and counts use `plural()`. |
| [A-N41](#a-n41-operator-commands-are-spelled-three-ways-and-admin-never-says-setup-is-unfinished) | login.html and admin.js use `docker compose exec jiggered /jiggered ...` (with the restart caveat and `reset-two-factor`). cli.go usage opens with the Docker note and `user add`, and accepts `settings list`. admin.js has a "Finish setting up" strip atop People (cookies, untrusted proxy). Left out on purpose: an "Email: off" note (off is the normal state of a private instance) and per-tab chips. |
| [A-N42](#a-n42-error-and-offline-copy-a-misleading-fatal-page-a-silent-401-raw-ids-in-recovery-and-an-overlapping-status-pill) | app.js: the fatal page names the HTTP status with "Try again"; 401 goes to `/login?e=expired` with a message; the status reads "Server problem (500)... Retrying"; `recordName()` labels Recovery items; `#recovery` has margin-top 44px; a "Show" toast appears on a new refusal. |

### Partly fixed (45)

| ID | What changed, and what is still open |
| --- | --- |
| [A-C1](#a-c1-first-run-today-buries-the-check-in-and-logging-something-shows-no-result-on-the-screen-where-you-tapped-phone) | Fixed: Today hides brand copy and shrinks the h1 on phones (dashboard.css); timeline starts closed and opens once something is logged (today.js); tile taps toast "Logged X." with Undo. Open: no sticky balance pill, palette still lists every activity, ring panel still precedes the tiles. |
| [A-C2](#a-c2-registration-silently-does-nothing-when-the-username-or-email-is-already-taken-and-every-recovery-path-loops-back-into-it) | Taken username returns 409 "That username is taken" and refocuses the field; "Check your inbox" box shows the masked address with a 30s resend hold (security_accounts.go, login.js). Taken email and rate limit stay generic by decision. Open: no "you already have an account" mail; a dead verify link still offers the dark Verify button, not Sign in. |
| [A-H3](#a-h3-after-the-email-link-the-new-person-is-still-signed-out-eleven-taps-and-a-welcome-back-with-empty-fields) | Server returns the username; after verifying, the card reads "Email verified" with one Sign in button, and /login has the username filled and cursor in password (login.js). Open: still signed out (no same-device auto sign-in); sign-in page still says "Welcome back". |
| [A-H5](#a-h5-a-failed-sign-in-wipes-the-username-and-reloads-the-page) | login.js keeps the typed username in sessionStorage, restores it and focuses the password after ?e=bad/busy. Open: the page still reloads, and "After ten wrong tries an account is paused for 15 minutes" still shows on the first failure. |
| [A-H6](#a-h6-the-verification-reset-and-recovery-emails-waste-the-inbox-preview-two-of-three-never-say-ignore-this-if-it-wasnt-you-and-nobody-is-named) | branded_email.go: hidden preheader from the message's first lines, one footer line (eyebrow and slogans gone), Message-ID and Auto-Submitted added; all three bodies say "Didn't ask for this? Ignore this email". Open: none names the username or host; H1 still repeats the subject. |
| [A-H8](#a-h8-the-only-picture-of-the-product-is-a-mock-with-its-example-label-hidden-and-its-rows-covered-and-the-eight-public-pages-have-no-product-image-at-all) | Landing hero mock replaced by a real Today screenshot (web/shots/today.webp, /shots/ route, alt text, "Example data" caption). Open: the eight public pages still have no figure, and no trust list sits under `.public-lead`. |
| [A-H13](#a-h13-the-landing-sells-spoons-the-product-starts-in-points-and-never-asks) | Decided parts done: spoon guide CTA is /register?w=spoons (applied once on first Today, today.js) and the first-run checklist has Points/Spoons buttons. Open: still literal "points" in spoons mode: block-menu heading (planner.js), timeline help, calendar.js announcements, remove dialog, Today form error. |
| [A-H15](#a-h15-works-offline-fails-on-a-hung-connection-the-signed-in-app-sits-in-connecting-for-2641-seconds) | app.js races store.load against 3s so first paint no longer waits on a hung API; "1 change queued" is pluralised. Open: sw.js still network-first with a 5s abort (no stale-while-revalidate), /api/me waits 6s, no "device's copy" pill, offline.html lacks the slow-connection line. |
| [A-H18](#a-h18-one-activity-three-signs-every-surface-shows-2-for-a-cost-of-2-except-the-field-you-type-into-and-more-points-1-lowers-recovery) | Menu says "Costs 1 more (-1 left)", screen readers hear "uses 2/recovers 1", tooltip and Help explain the sign, and Today/Plan forms show "Uses 2 points. Shown as -2." Open: the cost fields still take the opposite sign ("Points it costs"); kept on purpose, and the form now explains the sign. |
| [A-H19](#a-h19-finishing-a-planned-block-from-the-timeline-throws-the-page-15001800px-away-from-it) | completePlanned takes {focus:false} and today.js passes it on block click, so the page no longer jumps. Open: menu "Mark as done" still focuses the Done list (scrolls); no focusBlock for keyboard users; planned blocks of 30 min or less still hide the "tap to finish" cue. |
| [A-H21](#a-h21-focus-is-dropped-to-body-after-almost-every-action-and-undo-cannot-be-reached-from-the-keyboard) | Focus follows a logged tile, filter pill and the check-in; toasts with Undo last 12s and pause on hover/focus; Ctrl/Cmd+Z undoes the toast (app.js); keyboard help is printed under the grid. Open: Cancel/Save in the forms and Plan Remove still drop focus to body; arrow moves still toast and announce twice. |
| [A-H22](#a-h22-adding-or-editing-from-either-timeline-ejects-you-10003500px-down-the-page-to-a-form-that-does-not-name-the-day) | Timeline add/edit forms open as a floating sheet (util.js sheetMode: backdrop, Escape, Tab trap) so the page no longer jumps; Plan's title names the day; toasts say "Logged/Updated/Plan saved". Open: new adds have no Undo; focus is not returned to the block. |
| [A-H23](#a-h23-on-a-phone-both-timelines-trap-swipes-hide-their-handles-and-a-scroll-that-starts-on-a-blocks-edge-resizes-it) | calendar.js: a touch swipe on a block edge now scrolls; resize needs a 300ms hold; `.cal-resize` is touch-action:auto with a faint edge bar. Open: nested `.cal-scroll` (52vh/420px max) still traps swipes; overlap lanes unreadable; remove/grip not hidden for lanes; placing banner not sticky. |
| [A-H24](#a-h24-help-describes-a-today-that-no-longer-exists-other-help-and-readme-claims-are-wrong-and-neither-timeline-is-documented-anywhere) | help.js: `activities` topic rewritten for the real timeline, `plan` topic added, "Edit day" and ← → fixed, admin tab names and 30-minute memory fixed, setup button moved to `start`. Open: topic order, search ranking, #help/&lt;topic>, Back (replaceState), README "Help tab"; help cites a "⋯ menu" that does not exist. |
| [A-H25](#a-h25-plans-first-screen-has-no-call-to-action-above-700px-and-the-timeline-starts-a-screen-or-three-below-the-fold) | The "Plan your day" start card now shows at every width while nothing is planned and opens the floating form (planner.js, dashboard.css). Open: board still sits below the strip panel; "Add activity or recovery" stays in the last panel; the bottom empty-state card still renders as well. |
| [A-H26](#a-h26-plans-board-is-hard-to-read-the-any-time-row-eats-the-hours-and-seven-narrow-columns-cut-titles-to-412-characters) | Tray capped at 76px and scrolls; chips use 16px radius plus overflow-wrap (dashboard.css). Open: always seven columns at 701px and up (deliberate), titles stay one-line ellipsis, no "+N more" chip, no lane merge for 3+ overlaps, layout ignores the 22/44px minimum drawn height. |
| [A-H30](#a-h30-episode-save-does-nothing-on-an-untouched-form-and-a-note-only-save-creates-a-symptom-less-still-going-episode-that-never-expires) | Untouched Save now says "Nothing to save yet", and a touched but empty form says tick a symptom or write a note (episodes.js). Open: note-only saves still default to "Still going" (not gated on a ticked symptom) and ongoing episodes never expire. |
| [A-H31](#a-h31-record-when-it-ended-opens-the-full-edit-form-and-asks-for-a-duration-bucket-the-end-time-is-hidden-until-a-select-changes) | Banner prints the formatted start and offers "Ended just now" (one tap, Undo, stays on Today) plus "Ended earlier...". Open: "Ended earlier..." still opens the full form, end time hidden; no 72-hour prompt; History filter still "Ongoing"; Help still says "Record when it ended". |
| [A-H32](#a-h32-history-can-no-longer-show-an-episode-beside-a-check-in-or-an-activity-the-earlier-c4-fix-was-deleted-in-dd201fc-and-nothing-replaced-it) | Every calendar cell now shows an episode dot in any colour mode, with an "Episode recorded" legend item (history-matrix.js, style.css; hidden only in dense heatmaps). Open: no Episodes row in the combined chart; first-run hint still mentions only check-ins and activities. |
| [A-H34](#a-h34-on-a-phone-the-history-calendar-is-tappable-for-30-days-only-90180365-days-are-1994px-cells-with-no-letters) | Decision applied: on a phone the calendar pages 35 days at a time (history-matrix.js limit, browser-history test), so letters and tap targets stay. Open: desktop heatmaps over 16 weeks (180/365 days) still hide the G/A/R letter with no hatch; share-panel toggles not 44px. |
| [A-H38](#a-h38-fretboard-hides-its-save-offline-and-error-states-and-a-refused-save-removes-the-card-from-view) | Added #fb-status line under the board (unsent, offline, refused) and a refusal toast with Show (fretboard.js, app.js). Open: a refused card still vanishes from the board; Recovery calls it "A tool's board" and offers no "Edit a recovered copy" for tool boards. |
| [A-H39](#a-h39--card-and-typed-todays-three-entries-land-on-a-fixed-20-slot-cascade-so-a-brain-dump-piles-up-on-itself) | "+ Card", "+ Note" and typed three-things use a free-space scan with fewest-overlap fallback (fretboard.js freeSpot), so they no longer stack. Open: the scan starts in the "in my hands, matters now" quadrant (top right), not the midline, so new cards are still pre-judged. |
| [A-H42](#a-h42-fretboards-keyboard-and-screen-reader-path-has-five-holes) | Done: axis rows not aria-hidden and labelled, Three list keeps focus, focus lands on tool title, skip-board button, "Mark done:" label, dimmed cards leave tab order, "Move to" menu. Open (deliberate): every card still tabindex 0 (no roving tabindex); no Q/W/A/S keys; nudge stays 1%. |
| [A-H43](#a-h43-save-confirmations-and-validation-messages-sit-under-the-button-and-out-of-sight-on-phones-and-the-success-green-fails-contrast-at-4261-app-wide) | Done: --green-text #26774a (5.5:1) for .msg/.toast; account.js say() scrolls messages into view on phones; Save buttons sticky above the tab bar. Open: profile.js and settings messages (saveFeedback, editor.validate) still set text only, no scroll or toast; #pw-msg still below its button. |
| [A-H47](#a-h47-a-second-browser-tab-is-silently-dead-it-looks-editable-ignores-input-and-says-nothing) | Blocked click/submit/change in a read-only tab now toasts "This tab is read-only because another Jiggered tab is editing..." (app.js). Open: no visual disabled state; notice not sticky and sentence still repeated in #sync; Plan/Fretboard help and palette unchanged; [data-cal-day] and #fb-legend not allow-listed. |
| [A-H48](#a-h48-the-activity-and-list-editor-is-224px-per-row-on-a-phone-the-points-box-has-no-visible-label-and-validation-errors-are-out-of-sight) | Phone rows are now a grid: name, then points and group, then move buttons (167px instead of 224px). Open: no visible points label or header row; whole list marked invalid, focus on row 1; message under the buttons; "activities names" grammar; form not novalidate. |
| [A-N2](#a-n2-the-button-system-is-fragmented-across-three-stylesheets-and--marks-buttons-that-do-not-leave-the-page) | Done: "Use this allowance" is now "Save" (index.html); in-site CTAs use an SVG right arrow, the up-right arrow remains only on the GitHub link, with a new-tab note. Open (deliberate): no shared `.btn`; `.p-button` (56/44px, 8px), auth `.primary` (50px, 7px) and app `.primary` (10px) stay separate. |
| [A-N5](#a-n5-small-auth-details) | Done: code inputs have autocapitalize/spellcheck/enterkeyhint=done; hint says "Use 8 to 72 characters"; "Take a look" hidden at 761px and up (public.css); landing and login theme-color match. Open: reset form still always shows the authenticator-code field; no 2FA lookup first. |
| [A-N9](#a-n9-dead-ends-on-the-utility-urls) | Done: noindex 404 page (public.go `notFound`, notfound.html), 301s for /docs, /features, /guides, web/robots.txt deleted. Open: sitemap and "Sitemap:" still emitted without publicIndex and can fall back to Host (public_test.go asserts the automatic sitemap on purpose); breadcrumb Home still absolute when an origin is set. |
| [A-N10](#a-n10-install-and-pwa-story-is-prose-only) | Done: public layout.html links the manifest and sets theme-color; manifest has id, scope, background #f8f9f4. Open (deliberate): no Today install card, no beforeinstallprompt handling; app theme-color still #2f6f62 vs public #f8f9f4. |
| [A-N11](#a-n11-signed-in-people-on-the-public-pages-are-told-to-create-an-account-and-the-offline-guide-cannot-be-read-offline) | Done: public.go `data()` calls `lookup` ("Open Jiggered", no Log in, wordmark to `/`); app.js `fatal()` offline stub gets "Try again". Open: help.js Spoon guide link still same-tab; no new Offline quick guide (only the old Help topic); stub has no header or logo; /docs/offline-use unreadable offline. |
| [A-N12](#a-n12-copy-and-consistency-nits-across-the-public-pages) | Done: privacy.html "pricing and access"; UK spellings (personalise, behaviour, customise); login footer links /privacy; essay and GitHub links open a new tab with sr-only note; FAQ summary min-height 44px. Open: titles still mix "X \| Jiggered" and "Jiggered X" (public.go titles unchanged). |
| [A-N13](#a-n13-on-today-the-dashed-palette-chips-contradict-the-legend-the-sync-pill-pluralises-badly-and-covers-the-masthead-and-wording-differs-between-paths-to-the-same-result) | Done: `.cal-chip.cal-preset` solid; "1 change" pluralised (app.js); tile tap toasts "Logged X." with Undo; forms toast "Logged/Updated X", not "queued". Open: `#sync` has no phone sizing; no "N left"; block x still asks (Today "Remove this activity?", Plan "Remove from your plan?") while Plan list Remove is instant. |
| [A-N14](#a-n14-the-shared-defaults-notice-is-the-only-interrupt-426px-tall-on-a-phone-above-the-page-heading-on-every-tab) | Done: "A, B and C" wording; "Not now" is a 44px secondary button; notice trimmed to one paragraph plus three buttons, heading removed (defaults-notice.js). Open: still a full-width panel above the page heading on every tab, not a one-line bar; dismissal still per-device localStorage. |
| [A-N17](#a-n17-plans-keyboard-path-47-tab-presses-to-the-first-block-and-59-to-add) | Added "Skip the activity list, go to the timeline" (`#plan-skip-palette`, covered in browser-planner.cjs). Open (deliberate): palette chips, day headers and blocks remain individual tab stops; no roving tabindex, listbox or grid semantics. |
| [A-N18](#a-n18-plan-form-details-validation-a-12-hour-time-field-against-a-24-hour-board-and-a-form-that-never-names-the-day) | Done: name maxlength 60; one message per field with aria-invalid and focus; error clears on input; `class="msg err"`; repeat limit in label; hints span the row; focus offset 2px; title names the day. Open: time input stays browser-locale (no 12/24 option); draft-restored notice still in the red alert line; no counter. |
| [A-N21](#a-n21-episode-form-polish-two-question-sizes-37px-chips-an-onset-that-cannot-be-cleared-and-a-tab-that-never-says-symptom) | Done: one question size (`#epform legend`), `.chip span` 44px at 700px and below, onset untickable (episodes.js), H1 "Log a symptom episode.", duplicate h2 hidden unless editing. Open: eyebrow still global "YOUR OWN RHYTHM"; `.chip-status .x` still 36px; Episode hero not shortened on phones. |
| [A-N22](#a-n22-draft-expiry-is-explained-only-in-help-and-the-discard-dialog-uses-jargon-the-whole-episode-form-locks-while-a-save-waits-for-the-server) | Done (episodes.js): restore message and draft list say "kept until {date}, seven days after your last change"; confirm reads "Delete this draft? It has not been saved to your account yet." Open (deliberate): fields still `disabled` while a save is pending; same "Change queued..." toast. |
| [A-N27](#a-n27-history-copy-is-wrong-in-two-states-unfiltered-matching-failed-load) | Fixed in history-matrix.js: "matching" only when filters are on; legend says "Nothing logged / unmarked"; a filtered empty day offers "Clear filters", not "Log today"; first-run line says history "has not loaded". Open: a failed first load still shows a 1-day range under Period "30 days", and there is no "Couldn't load... Try again" line. |
| [A-N31](#a-n31-fretboard-with-200400-cards-is-slow-and-has-no-zoom-pan-or-list) | fretboard.js: a marquee repaints only changed selections with rects measured once, and `paintItem` skips `keepInside`/`place` unless position, text or canvas size changed. Open: no zoom, pan or list view; `ITEM_LIMIT` still 400; no "Archive done cards" (only "Clear done cards"). |
| [A-N33](#a-n33-fretboard-copy-and-logic-slips) | Fixed: double full stop; Suggest counts only undone entries ("Finish or remove one to make room"); captions and card aria-labels follow renamed axes; `summarise()` skips empty cards; status is shown as "of all of them". Open: the summary still hard-codes "in/out of your hands"; a new card is still saved empty before typing, so an "Untitled" ghost can persist. |
| [A-N35](#a-n35-todays-three-is-an-island-and-its-list-column-is-63px-wide) | tools.css: the three-list grid is now 4 columns with the chip and remove on row 2, so text is about 130px, not 63px. Open: Today and Plan never read the board (no card, no link); no "Plan for today" item in the card menu. |
| [A-N37](#a-n37-the-sign-in-security-panel-looks-unfinished-and-explains-nothing-when-email-is-unavailable) | Fixed: "Recovery email isn't available..." message; server text "A verification link is on its way to the address you typed… 30 minutes" (replace-line only if an address exists); Copy all and Copy key; confirm on "I've saved my codes"; reload on tab focus. Open: still two password fields, secondary vs primary buttons, no spacing change, and the intro still promises a recovery email. |
| [A-N39](#a-n39-destructive-confirmations-are-native-dialogs-and-deleting-your-account-ends-on-a-bare-sign-in-page) | Fixed: delete requires a filled password before the confirm, its text mentions backups, and it ends on `/login?e=deleted` with a notice (account.js, login.js). Open: still native `confirm()`. 18 native confirm/prompt sites remain (7 in admin.js, incl. the delete `prompt`) against 2 `confirmDialog` users (planner.js, today.js). |
| [A-N43](#a-n43-the-phone-tab-bar-six-labels-overflow-at-320px-the-admins-seven-collide-and-admins-own-tables-do-not-fit) | Fixed: on a phone each tab is as wide as its label, so six tabs, or an admin's seven, show every label at 320-390px (the bar scrolls sideways if it ever has to); a 340px-and-below rule (10.5px, no padding); the usage report in a focusable `.table-scroll`; People paged by 20. Open: Admin is still a tab (not in the menu), and People rows are not one 56px line. |

### Decided (2)

| ID | The decision |
| --- | --- |
| [A-H40](#a-h40-a-sixth-top-level-tab-for-one-tool-a-launcher-that-does-not-say-what-the-tool-does-and-a-first-screen-that-is-mostly-header) | Decided twice. On 5 Oct the maintainer chose to move Fretboard into the account menu (built in #89: no tab and no launcher while it was the only tool); on 6 Oct they asked for the Tools tab back. Now the Tools tab and its launcher, with Fretboard in it, are back, and the account menu keeps a "Fretboard" shortcut that opens the board directly. Still open from the finding: the masthead and the tool's own header sit above the toolbar and board, and nothing scrolls to the canvas. |
| [A-N3](#a-n3-template-tells-and-vague-copy-on-the-landing-page-and-a-voice-that-turns-defensive-one-click-later) | Not done on purpose: the landing headline and introduction were set by the SEO review (`docs/audits/SEO_AUDIT.md`, H1) to name the product category, and the rewrite proposed here would undo that. Unchanged: the hero headline and sub-line, "Your rhythm. Your choice.", the landing eyebrows, four uses of "a little", the per-page disclaimers and the support-time paragraph on pricing. Gone: the hero mock and its two taglines (a real screenshot replaced them). |

### Open (1)

| ID | What remains |
| --- | --- |
| [A-N15](#a-n15-plan-one-plan-is-drawn-in-four-to-five-places-and-plans-own-today-column-ignores-what-is-already-logged) | Not started: the board still draws plan rows only (no logged ghosts); the strip, the five tiles with the outlook, `#plan-list` and Today's "Still to come today" card all remain, and there is no List toggle. |


---

> **Part 2 begins here.** Everything below this rule is the earlier audit of Today, Plan and History, exactly as it was committed: its own IDs (`C1`–`C5`, `H1`–`H9`, `N1`–`N6`, Appendices A–C) are separate from Part 1's `A-` IDs. Where its statements no longer match the code, [Appendix B of Part 1](#appendix-b-statements-in-part-2-that-no-longer-match-the-code) says so.

---

# UI audit: Today, Plan, History and the visual planning calendar

Scope: the **Today**, **Plan** and **History** tabs, plus what a drag-and-drop planning
calendar needs from each. Landing page, sign-up and Account/Admin are out of scope here.
Nothing in this document has been implemented.

## How this was done, and what to discount

- Read the source for all three views, the sync/validation layer and the CSS they use.
- Ran the real `web/` files in headless Chromium with an in-memory API (the same
  technique as `test/browser-planner.cjs`), at **1440, 375, 360 and 320 px**, with a
  new account and with a synthetic 60-day account. Light theme, "points" wording only.
- Used the phone screenshot you sent (Android, Brave; about 415 CSS px wide, inferred
  from the chip size) as real-device evidence for C1, and reproduced it at 375 px.
- **Not done:** a real server + sign-in run, screen-reader testing, real touch dragging,
  dark theme, the "spoons" wording on every screen, large-account performance. Where a
  finding comes from reading code rather than running it, it says so.

### The brief's "free trial" framing does not apply

There is **no paywall, trial, upgrade modal or upsell anywhere in this product**. The
landing page says "Free to use", `public/pricing.html` says "Free to use.", the
structured data says `price: 0`, and the source is MIT. So I did not invent conversion
problems. I substituted the nearest honest equivalents:

| Brief says                | Audited as                                                                        |
| ------------------------- | --------------------------------------------------------------------------------- |
| Start a free trial        | **Activation**: first check-in → first logged activity → first plan → coming back |
| Paywall before value      | N/A. Checked instead: does the first screen show value before it asks for effort? |
| Stacked upsells / nagware | Competing prompts on one screen (checklist, banners, repeated instructions)       |
| Onboarding answers unused | Settings the user gave the app that planning ignores (see H5)                     |

### What is already good (keep it)

- Undo on destructive actions; queued-save status that never lies about "saved".
- Check-in buttons state their consequence ("Full points / −3 / −6"), and the choice
  really does set the day's allowance. The onboarding budget really is applied.
- Calm, non-judgemental copy. Tabs have roles and arrow-key navigation.
- No page-level horizontal overflow at 320–1440 px. Sampled muted text is 5.9–6.2:1
  contrast, so there is **no contrast finding** here.

---

## 1. Critical

### C1. Plan day strip clips the selected day on phones (reported, reproduced)

- **Pass:** Designer
- **Where:** `web/dashboard.css:1672-1682` (mobile `.plan-days` / `.plan-day`),
  `web/dashboard.css:1561-1565` (`[aria-pressed="true"]` outline). Route `/#plan`,
  ≤700 px. Reproduced at 375 px; matches your Android screenshot.
- **Problem:** On phones `.plan-days` becomes a scroller with `padding: 4px`,
  `scroll-snap-type: x proximity` and `scroll-snap-align: start` on each chip, but no
  `scroll-padding`. On load the browser snaps the first chip flush to the scrollport
  edge, so the 4 px padding is scrolled away. Measured: `scrollLeft = 4`, chip left
  edge = container left edge. The selected chip's ring is `outline: 2px` +
  `outline-offset: 1px`, which sits 3 px outside the border box, and the scroller
  clips it. Result: the left border of "Today" is cut off, on the one control that
  chooses which day you are planning. The same strip also cuts the fourth chip
  mid-letter ("Th", "No") with a thin always-visible scrollbar, so it reads as broken
  rather than scrollable. Each chip is 100 px tall to say three things.
- **Status: fixed** in `web/dashboard.css` (the same block, edited in place), with a
  regression assertion in `test/browser-planner.cjs`.
- **Fix (verified in the browser):**

  ```css
  @media (max-width: 700px) {
    .plan-days {
      display: flex;
      overflow-x: auto;
      margin-inline: -8px;        /* cancels the padding, so days stay aligned with the text above */
      padding: 6px 8px;           /* was 4px: room for the 3px ring */
      scroll-padding-inline: 8px; /* snap leaves the padding visible */
      scroll-snap-type: x proximity;
    }
  }
  ```

  Measured after: `scrollLeft 4 → 0`, clipped ring `3 px → 0`, full border visible, and no
  page overflow at 320, 360, 375, 414 or 700 px. The negative margin was added after
  checking the first version: padding alone left the days 8 px to the right of the heading
  and text above them (chip at x=49, text at x=41); with it they line up (41 = 41 at 375 px).
  The regression test fails without the fix (`scrollLeft` is 4, not 0) and passes with it.
  Optional, not done: an end-edge fade (`mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent)`)
  so the cut-off fourth chip reads as "more this way".

- **Tested and rejected:** turning the strip into a 7-column grid _inside the current
  card padding_. The container is 293 px, so chips are 37 px: "Today" overflows its chip
  and touches its neighbour, and 37 px is under a 44 px touch target. Do not ship that.
- **Longer term:** replace the strip with the calendar's week header (Appendix A). If a
  7-up strip is kept, let it bleed to the card edge (335 px ÷ 7 ≈ 47.8 px, which clears
  44 px; arithmetic, not tested) and show weekday initial + date number + a status dot,
  marking today with a dot rather than the word "Today".

### C2. There is no visual, time-based planning at all

- **Pass:** Designer and First-time user
- **Where:** `web/planner.js:25-34` (`rowsMarkup`), `web/planner-model.js:4` (`planRows`),
  `web/index.html:554-596` (plan form), `validate.go:91-99` (plan row validation).
  `/#plan`, all viewports.
- **Problem:** A day's plan is a vertical list of rows: name, "Planned · 15:00", a cost
  and three buttons. The shape of the day is invisible. Specifically:
  - A planned entry is `{id, a, c, t}`: **no duration**. You cannot say "two hours".
    The shipped defaults smuggle duration into names: "Deep focus (2 hours)",
    "Screen-heavy work (1 hour)", "Driving (30 min or more)" (`web/defaults.json`).
  - Time is an optional free `<input type="time">`, and rows are **not sorted by time**
    (`planRows` returns insertion order). Add 15:00 then 09:00 and they list in that order.
  - The server validates only `id` on plan rows (`validate.go:96`), so nothing stops
    garbage in a future `dur` field either.
  - You plan seven days by tapping a chip, then a list, then a form. Nothing lets you
    see Tuesday's heavy afternoon next to Wednesday's empty one, which is the whole
    reason to plan ahead.
- **Status: Plan timeline shipped; Today and History views not yet.**
  - **`dur`:** optional length in whole minutes (5-1440), validated on the server for plan rows
    and logged entries, and it must finish by midnight. Duration inputs on the Plan form and
    Today's activity form; ranges such as `09:30–11:00` in the plan list, Today's logged
    activities and History's day detail; plan rows sorted by start time with untimed ones last;
    a length suggested from a saved activity's name ("Deep focus (2 hours)" gives 120) without
    replacing one that was typed. Logging a planned activity places it at its planned start if
    that has passed (otherwise now) and carries its length.
  - **Plan timeline** (`web/calendar.js`, with the rules in `web/calendar-model.js`): day
    columns on an hour rail with a "now" line, overlapping blocks side by side, an "Any time"
    row for untimed items, and a palette of saved activities. Drag a block to move it (including
    to another day), drag its top or bottom edge to change its length, drop a saved activity from
    the palette, click an empty space to add. With the keyboard, arrows move a focused block,
    Shift+Up/Down changes its length and Left/Right changes day; each move has one Undo (a run
    of arrow presses undoes as one). Escape cancels a drag. A phone shows one day, and blocks
    are moved by their grip so the page still scrolls. A cross-day move adds to the new day
    before removing from the old one, so a failure shows a copy rather than losing it.
  - Tests: `test/calendar-model.test.mjs`, Go tests for `dur`, and `test/browser-calendar.cjs`
    (real mouse, keyboard and touch). Assertions were checked by breaking the behaviour and
    watching them fail.
  - **Not yet:** the Today day timeline and History grid (below), editing a block's length from
    a phone other than through the form, and `dur` in the CSV and print exports (a public
    format change, left for a decision).
- **Fix:** build the calendar described in **Appendix A**. First slice that ships value
  on its own: add optional `dur` (minutes), sort rows by `(t, id)` with untimed rows
  under "Anytime", and render a Week board in a new `web/calendar.js`. Keep the current
  list as a "List" toggle so nothing is removed and keyboard/screen-reader users keep a
  linear view.

### C3. Today has no timeline, and "Done" throws you out of the tab

- **Pass:** First-time user and Designer
- **Where:** `web/today.js:575-577`, `web/planner.js:36-44, 244-253, 68`,
  `web/index.html:302` (`#today-plan`), `web/today.js:200, 517`. `/#today`, all viewports.
- **Problem:** Planned items ("Still to come today"), logged activities (pills + a
  separate "Edit logged activities" list) and the current time are three unrelated
  lists, and the plan card sits under the ring, four stat tiles, the cell bar, the
  legend and a disclosure. Then the interaction that matters most is the worst one.
  **Verified in the browser:** pressing **Done** on a planned item on Today switches the
  tab to Plan, opens a form (name, points, time) titled "Log what actually happened",
  and pre-fills the time with _now_ (06:38) instead of the planned 15:00. You wanted one
  tap; you got a context switch and a form. On a day you are tired, that is where the
  habit dies. The plan's start time is also overwritten, so plan-vs-actual drift is
  thrown away (see H7).
  Backfilling is no better: the time field exists only on past days
  (`today.js:517`), and a tile tap today always stamps _now_ (`today.js:200`), so you
  cannot say "the call was at 09:30" without the "Other activity" form.
- **Status: fixed (Done in place, Day timeline, backfilling). Plan-vs-actual drift (H7) is not.**
  - **Shipped:** Done on Today now logs the planned activity in place (its planned name and
    cost), with no tab change and no form. Today's time is _now_, as with an activity tile; on
    a past day it keeps the planned time, or none, since "now" would be wrong. The toast offers
    Undo, keyboard focus moves to the next planned item, and the logged activity can be
    corrected by tapping it among the day's logged activities. Plan's own Done is unchanged and
    still opens the form, so the actual cost or time can be set there.
  - **Differs from the proposal below:** the toast supports one action, so it is Undo, not
    "Undo / Adjust"; Adjust is tapping the logged activity.
  - **Shipped (Day timeline):** Today now has a one-day timeline above the activity tiles.
    Logged activities are solid, planned ones dashed with a "tap to finish" cue, and the header
    says how many are left. Tapping a planned block finishes it where it is (with Undo); tapping
    an empty space opens the Add form at that time (the quarter hour, one hour long), which is
    the backfilling; dragging a logged block moves it, dragging its edge sets how long it took,
    and arrow keys do the same. A mouse can also drag an activity tile onto the timeline to log it
    at that time, with the length from its name ("Deep focus (2 hours)" logs two hours). A touch
    screen uses the grip on a block and the tap-to-add form instead, since a finger drag scrolls.
    The timeline sits above the tiles in the right-hand column, because the left column is sticky
    and a tall block in it could not be reached.
  - **Revised after trying it as a user:** on a 900 px laptop the activity tiles were below the fold
    while the timeline was above it, so a drag from a tile to the timeline could not be done; on a
    phone the timeline started closed and had no way to place an activity. Today's timeline now has
    the activities in a list directly above it, so both are on screen together; a drag from that list
    shows what it is carrying and scrolls the page when it reaches the window edge; tapping an
    activity and then a time places it (also the way to do it with a finger, and an alternative to
    dragging for anyone who cannot); the timeline starts open on a phone with a shorter window; and
    the form for a time chosen on the timeline returns you to the timeline when you finish.
  - **Points follow the time slot:** stretching or shrinking a block, with the mouse, a finger or
    Shift with the arrow keys, rescales its points in proportion to its length (2 points for an
    hour is 4 for two hours), in whole points, never to zero and never past 10. The new value shows on
    the block while it is dragged, is said aloud, appears in the Undo message and is restored by
    Undo. A run of arrow-key presses is scaled from where it began so rounding does not add up. In
    the Duration field of the Add and Edit forms the points follow too, until they are typed over.
    An entry with no recorded length is scaled from the half hour it is drawn at. Plan's blocks
    behave the same way, and on a phone Plan has the same tap-an-activity-then-a-time placement.
  - **Not done:** carrying the planned time onto the log for plan-vs-actual (H7).
  - Test: `test/browser-planner.cjs` (stays on Today, Undo, correcting from the logged
    activity, Plan's form path, and a past day keeping `21:30`). It fails with the old flow at
    `Done stays on Today`.
- **Fix (original proposal):** replace the `#today-plan` list with a **Day timeline** (Appendix A3): a
  vertical hour rail with a now-line, logged activities solid, planned ones dashed.
  Tapping a planned block's check logs it **in place** with the planned values and shows
  the existing Undo toast ("Logged. Adjust"), where Adjust opens the edit form. Never
  `ctx.go("plan")` from Today. Keep the tile grid as quick-log. On the timeline, tapping
  an empty slot opens the add form pre-filled with that time, which fixes backfilling.

### C4. History cannot show time, the future, or plan vs actual, and its calendar is a 168 px heatmap

- **Pass:** Designer
- **Where:** `web/history-matrix.js:62-120`, `web/style.css:2437-2478`
  (`.matrix-calendar{max-width:calc(24px + var(--weeks)*28px)}`, `.matrix-cell{max-height:26px}`),
  `web/history-matrix.js:117` (plan vs actual), `web/index.html:599-653`. `/#history`.
- **Problem:** The "calendar" is a GitHub-style heatmap: weeks as columns, 25 × 25 px
  cells, six colour modes in a `<select>`. A 30-day period is six columns, so the grid
  is **168 px wide inside a 709 px panel at 1440 px (24%)**, and still 168 px at 375 px.
  Measured: wasted panel on desktop, 25 px cells everywhere. It shows one number per
  day, has no hour axis, never shows a future day, and "Plan and actual" is a sentence
  ("0 of 2 planned activities logged · 0 net points estimated…") plus a button. The
  thing you wanted from History, "what did my week actually look like", cannot be seen.
  Episodes have start and end times (`validate.go:49-77`: `when`, `endedAt`, "Still
  going") but are only counted per day, so you can't see a symptom sit next to the
  activity before it.
- **Fix:** make History's hero a **Week / Day time grid** (Appendix A3) that reuses the
  Plan calendar renderer read-only: solid blocks for logged activities, ghost blocks for
  what was planned, episodes as range bars in their own lane, ←/→ week navigation and a
  "Today" jump. Keep the heatmap as a full-width **Month** overview that drills into a
  week, with day cells ≥44 px at ≤700 px (replace the fixed `max-width`/`max-height`
  with a `min(100%, …)` and `aspect-ratio`). Keep the six colour modes, but behind a
  small "Colour by" menu on the Month view only.
- **Status: fixed, except that the plan is shown only where it was not done.**
  - **Shipped:** History opens with **Your week on a timeline**, the same grid as Plan, read-only:
    logged activities solid, planned activities that were not logged dashed ("planned, not logged"
    on a past day), and episodes as bars in a strip down the right of each day. An episode runs
    from its start to its recorded end; with no end time it is drawn at the middle of its length
    range and says it is approximate, and one that is still going runs to now. One that crosses
    midnight carries on in the next day's column. Previous/next week, a Today jump, and one day at
    a time on a phone. Selecting a block opens it where it can be changed (the day on Today, the
    plan, or the episode). The week reads the whole account, not the period and filters chosen
    above it.
  - The month overview stays below it. Selecting a day there offers "See in the week view", and
    its squares now fill the panel instead of staying 25 px: about 48 px for a 30-day period at
    375 px and on desktop.
  - **Not done:** a plan row that _was_ logged is not drawn as a ghost beside the log, so the
    plan-versus-actual drift (H7) is still only the sentence in the day's detail; the Month
    "Colour by" menu is unchanged.
  - Tests: `test/week-model.test.mjs` (week days, episode spans and midnight cuts, each broken
    to confirm a failure) and the History sections of `test/browser-calendar.cjs`.

### C5. A new user's Plan and History are dead ends

- **Pass:** First-time user
- **Where:** Plan `web/planner.js:274, 281`, `web/index.html:534-553`; History
  `web/history-matrix.js:114, 118`, `web/index.html:615`. 375 px, new account.
- **Problem:**
  - **Plan:** with nothing planned the page shows five stat tiles reading
    `10 / −0 / 10 / +0 / 10`, an allowance input, a hint, and only then the empty state
    ("A little breathing room starts here.") which has **no button**. The real action,
    "Add activity or recovery", is at y ≈ 870–882 px on 320–375 px phones, below the
    fold of a 700 px (and 812 px) viewport. A first-timer scrolls past a wall of zeros
    to find out how to start.
  - **History:** a 30-day grid of dashed "–" cells, "0 Check-ins / 0 Episodes /
    0 Poor-sleep days", a "No matching day log" card whose **primary green button is
    "Share this day"** (for a day with nothing in it), and a page-level primary
    "Prepare summary" that renders greyed out. Nothing says what History becomes after a
    week of use, or how to get there.
- **Status: mostly fixed.** What shipped, and where it differs from the original proposal
  below:
  - **Plan:** the totals tiles are not rendered when the selected day has no plan and no
    log (`planner.js`, `#plan-forecast`). On phones a "Nothing planned yet." card with a
    full-width "Plan your day" button leads the page whenever nothing is planned in the
    visible days (`#plan-start`, shown only at ≤700 px). It sits above the day strip, so it
    is above the fold on a clean first-run account (measured at y 392–439 px, 375 px wide).
    A "shared defaults updated" notice (426 px tall on a phone) can sit above the page and
    push it down; that notice is existing behaviour and was not changed.
  - **History:** the calendar stays (an existing test pins the empty-account layout). A
    first-time account now gets a line explaining what the calendar fills in, and a day with
    no records offers a single primary "Log today" / "Log this day" instead of "Share this
    day". Days with records are unchanged.
  - Tests: `test/browser-planner.cjs` and `test/browser-view-state.cjs`. Each new assertion
    was shown to fail with its half of the change reverted.
  - **Not done:** the example calendar sample, and demoting "Prepare summary" (it is already
    disabled when there is nothing to prepare; the hierarchy change belongs with H8).
- **Original proposal:**
  - Plan: when `f.rows.length === 0 && !f.logged`, render **only** the empty-state card,
    with the button inside it (`Plan your day`), and hide `#plan-forecast`. On phones add a
    sticky "Add" button above the tab bar. _Not built as written:_ plan rows' Done / Edit /
    Remove buttons are right-aligned on phones, exactly where a floating button would sit,
    and it would stack on the fixed tab bar. A card at the top of the page avoids both.
  - History: when there are no logged days, replace the grid with a one-card preview
    ("Your week will look like this once you've logged a few days") with a sample and a
    "Log today" button. Hide "Share this day" for days with no records and demote
    "Prepare summary" to a secondary button in a toolbar.

---

## 2. High impact

### H1. Today is a 5,756 px scroll (375 px), 7,495 px at 320 px, and draws one number four ways

- **Pass:** Designer
- **Where:** `web/index.html:244-332`, `web/today.js:552-596`, `web/energy-flow.js`.
  `/#today`. Measured page height: 2,938 px @1440, 5,756 @375, 5,591 @360, 7,495 @320.
- **Problem:** Remaining energy appears as the ring, the four stat tiles (Starting
  allowance / Used / Recovered / Remaining), the cell bar with its four-item legend, and
  the "How your energy changed" disclosure. "Frequent and recent" repeats activities
  (Housework, Shopping trip, Deep focus) that appear again in their groups below. At
  375 px the activity block alone is **2,669 px, 46% of the page** (1,941 px at 1440).
- **Fix:** keep the ring plus one caption line ("3 used · 2 recovered"); delete the four
  tiles or fold them into the disclosure; keep either the ring or the cell bar, not both.
  When "Frequent and recent" is shown, collapse the groups by default. Cap the tile grid
  at two rows with "Show all". Target ≤3,000 px at 375 px.

### H2. Activity tiles spend most of their area on nothing

- **Pass:** Designer
- **Where:** `actButton` / `selectedCard` in `web/today.js:419-423`. `/#today`.
- **Problem:** Each tile is **127 px tall** (measured at 1440 and at 375) and holds a
  14 px name, a 12 px cost pill and the word "Record" next to a circular "+", 24 times.
  The label and the icon say the same thing; the tile is mostly empty space; there is no
  visual difference between work and recovery beyond a tint.
- **Fix:** single-row chips (name · cost) in a wrapped flex layout with the whole chip as
  the tap target; drop the word "Record"; show a ×N badge once logged (keep the existing
  stepper in the expanded state). At ~48 px per row that more than doubles the activities
  per screen (arithmetic from the measured 127 px, not a prototype).

### H3. Plan "Look ahead" is a mode picker, not a calendar

- **Pass:** Designer
- **Where:** `web/index.html:514-520`, `web/planner.js:55, 124-129, 255`.
- **Problem:** A `<select>` of Today / 3 days / 7 days. You can't plan beyond **today + 6**
  (`planner.js:255` resets any later date), can't look at last week's plan, can't see a
  month. Changing the select **resets the selected day to today**
  (`planner.js:124-129`), discarding where you were.
- **Fix:** replace with a segmented control **Day | Week**, "‹ Prev / Today / Next ›",
  Monday-first weeks, and a plan horizon of at least 90 days (the per-repeat cap of 7
  can stay). Persist the selection in `view-state`, and don't reset the date when the
  mode changes.

### H4. Five stat tiles plus a paragraph say one thing

- **Pass:** Designer
- **Where:** `web/planner.js:274-275`, `web/index.html:551`. `/#plan`.
- **Problem:** "Available now 4 · Work still planned −3 · Uncommitted 1 · Planned
  recovery +2 · Projected balance 3", then "1 point left after planned workload, before
  recovery. Your recovery plan adds an estimated 2 points; it is included only in the
  projected balance." The reader must do the arithmetic the tiles exist to avoid, and
  "Uncommitted" is not a word anyone uses.
- **Fix:** one horizontal budget bar per day (allowance as the track, planned work as
  blocks, recovery as a returning segment) with a single sentence under it. Put the
  per-day projected number in each calendar day header.

### H5. Planning ignores what the user already told the app

- **Pass:** First-time user
- **Where:** `web/planner-model.js:18` (`plan.allowance ?? settings.budget`),
  `web/planner.js:269-271`. `/#plan`.
- **Problem:** The closest thing to "answers collected but never used". People set their
  Amber, Red and poor-sleep penalties in Account, and they are applied to _logged_ days.
  When planning a future day the allowance silently defaults to the full budget, so
  every future day assumes a Green day and the chips ("Wed 8") are optimistic. The hint
  promises "including expected sleep or check-in effects", but the user has to work
  that out and type it.
- **Fix:** under "Starting points for this day" add three chips, **Green / Amber / Red**
  (and a "Poor sleep" switch), that set the allowance from the existing
  `amberPenalty` / `redPenalty` / `sleepPenalty` using `capOf`. Default a future day to
  today's check-in if one exists. Show "assumes Green" on the day header when no
  expectation is set.

### H6. `−0` and `+0` on the first screens a new user sees

- **Pass:** Designer
- **Where:** `web/planner.js:274` (`−${f.committed}`, `+${f.recovery}`),
  `web/energy-flow.js:25` (`−${f.spent}`, `+${f.recovered}`). New account: Today
  "Used −0 / Recovered +0", Plan "Work still planned −0 / Planned recovery +0".
- **Problem:** A minus sign in front of zero reads as a defect on the first screen, in a
  tool whose entire premise is trust in the numbers.
- **Status: fixed.** One shared `signed()` now lives in `web/util.js` and is used by
  `planner.js`, `energy-flow.js` and `today.js` (which had its own identical `costLabel`).
  Zero now reads `0` on Today ("Used 0", "Recovered 0") and Plan ("Work still planned 0",
  "Planned recovery 0"). A unit test covers `signed(-0)`, and `test/browser-planner.cjs`
  asserts the empty-account text. Reverting the fix makes that test fail with
  `Used−0Recovered+0`. The same rule is still written inline in `history.js:346` and
  `history-matrix.js:115`; those were already correct and were left alone.
- **Original fix:** use the existing `signed()` helper (`planner.js:13`, which already returns
  `"0"` for zero) in both places; move it to `util.js` so both files share it.

### H7. Plan vs actual is a sentence, and the planned start time is destroyed

- **Pass:** Designer
- **Where:** `web/history-matrix.js:117`, `web/planner.js:68`,
  `web/planner-model.js:43-53`.
- **Problem:** Completing a plan item records `t = now`; the planned time survives only
  in the plan doc. The link (`planned:${date}:${id}`) exists, so the comparison could be
  drawn, but History shows only counts and a "Review this plan" button.
- **Fix:** on the calendar, draw the plan as a ghost block and the actual as a solid
  block in the same lane, with a small delta label ("+40 min later, −1 point"). When
  logging from a plan, keep the planned time on the log entry as `pt` (planned time) so
  drift can be shown and exported.

### H8. History's hierarchy leads with an export, not your data

- **Pass:** Designer and First-time user
- **Where:** `web/index.html:599-757`, `web/history-matrix.js:81, 86, 126-133`.
- **Problem:** The first thing on the page is Period, a date range, and a primary green
  **Prepare summary**. Filters, Summary, Records and Patterns are four collapsed
  accordions whose `<h2>` headings sit inside `<summary>` so they look like section
  titles but behave like toggles. There is a visible "Choose a day" `<select>` that
  duplicates the grid, and selection defaults to the latest logged day, or **today** (the
  emptiest day) when nothing is logged.
- **Fix:** put the calendar first. Move Period into a toolbar above it, make "Prepare
  summary" a secondary toolbar button, keep the day `<select>` as a visually-hidden
  accessible fallback, and default selection to the most recent day _with records_.

### H9. Touch targets and text are smaller than the audience can comfortably use

- **Pass:** Designer
- **Where:** `web/dashboard.css:429-452` (10 px readout label and caption);
  `web/style.css:2476-2478` (calendar cells); History checkboxes; `.help-tip`.
- **Problem (measured):**
  - History at 375 px: **52 of 98** interactive elements are under 44 px (57/98 at 360,
    46/98 at 320). Calendar cells are fixed at 25 × 25 px at every width.
  - Native checkboxes `#hist-ongoing`, `#sum-notes`, `#sum-activities` measure 13 × 13 px
    (their label may still give a larger hit area; I measured the input only).
  - `.help-tip` "?" buttons are 32 × 32 px; the small "Edit" buttons are 34 px wide.
  - 37 of 267 text nodes on Today (and 56 of 833 on History) are under 12 px, down to
    10 px, **at every width** (nothing scales up on mobile). This is an app whose own
    font choice (Atkinson Hyperlegible) argues for the opposite.
- **Fix:** minimum 12 px for any text; ring label/caption to 12 px with a larger ring;
  calendar day cells ≥44 px on touch (`@media (pointer: coarse)`); `.help-tip` to 44 px
  hit area via padding; wrap checkboxes so the whole label row is the target.

---

## 3. Nice to have

### N1. Header, hero and tab bar take 355 px before any tool (1440 px)

- **Pass:** Designer. **Where:** `web/index.html:80-93`, every tab. Measured: the tab bar
  ends at 355 px from the top at 1440 px.
- Eyebrow, a 52 px headline (36 px on phones), a description line and a decorative emblem
  sit above the tabs. A time grid needs vertical room. **Fix:** on Plan and History collapse the hero to
  a single line (headline + date range) and drop the emblem below 1100 px.

### N2. The floating bottom nav permanently covers ~10% of a phone

- **Pass:** Designer. **Where:** `web/dashboard.css:810-819`, `padding-bottom` at `:776`.
- `position: fixed`, 62 px tall plus 10 px gap, over the content: on your device it
  covers the Plan hint text, and it stacks with Brave's own bottom bar and Android's nav
  bar. For an admin it also carries a sixth "Admin" tab (294 px wide at 320 px).
  **Fix:** hide on scroll-down and show on scroll-up (`prefers-reduced-motion` aware),
  and move Admin into the account menu below 700 px.

### N3. Slashed zeros in times and dates ("15:ØØ", "2Ø26")

- **Pass:** Designer. **Where:** `web/style.css:2-43` (`@font-face`), any body text.
- Atkinson Hyperlegible draws a slashed zero **on purpose** to separate 0 from O, which is
  a sound accessibility choice for prose and numbers. In a time axis, `09:30` as `Ø9:3Ø`
  is noise. **Fix:** don't replace the font globally; use a plain-zero tabular face for
  clock labels only (`.cal-time { font-family: var(--display); font-variant-numeric: tabular-nums; }`).
  This becomes **High** the moment a time axis ships.

### N4. The check-in question is asked four times on the first screen

- **Pass:** First-time user. **Where:** `web/index.html:172-175, 214-241`.
- "Start where you are." heading, "How is your energy as this day starts?", the onboarding
  step "Pick green, amber or red…", and "How are you starting today? Pick one." plus a
  "?" tooltip. **Fix:** keep the heading and one line; the checklist step can just tick.

### N5. Mixed numeral faces

- **Pass:** Designer. **Where:** the ring number uses `.big` (`web/style.css:244-249`,
  Bricolage Grotesque); the stat tiles' `<dd>` (`web/energy-flow.js:25`) fall back to
  Atkinson Hyperlegible. Confirmed from computed styles at 375 and 1440 px.
- Same quantity, two typefaces, one of them with slashed zeros. **Fix:** one numeral face
  for balances.

### N6. Five different help affordances on Today

- **Pass:** Designer. **Where:** header "Help", two `?` tooltips, "How it works", "How
  points work". **Fix:** one `?` per card, one Help entry; fold "How points work" into the
  tooltip. Low priority.

---

## Appendix A. Calendar feature brief (drag, drop, expand)

### A1. Reuse, don't rebuild

- **Operations:** `editEntry` already patches one entry with per-field conflict
  detection (`web/model.js:490-494`, `operationConflicts` at `:380-389`). A drag-move is
  `editEntry {changes:{t}}`, a resize is `{changes:{dur}}`, and a new field is picked up
  for free because conflicts iterate `Object.keys(changes)`.
- **Plan docs** stay `p-YYYY-MM-DD` with an `entries` array (cap 200).
- **Numbers:** keep `forecast()` (`planner-model.js:14`) as the one source for balances.
- **Drag pattern:** `web/editor.js:149-190` (pointer events, ghost preview, Escape to
  cancel), `web/style.css:1100-1170`, tooltip copy at `tooltips.js:54`. The read-only
  tab guard already names `.drag-handle` (`web/app.js:227`), so use that class on handles
  and read-only tabs stay inert with no extra work.

### A2. Data model

- Add optional **`dur`**: whole minutes, 5–1440, to plan entries and day entries.
  `t` stays local `HH:MM`. v1: a block may not cross midnight (clamp `t + dur ≤ 24:00`).
  Decide separately whether overnight sleep needs splitting.
- Add optional **`dur`** to saved activity presets so "Deep focus" arrives as 120 min.
  Parse existing names once as a _suggestion_ only ("(2 hours)" → 120), never silently.
- **Server:** `validateDoc` ignores unknown fields by design (`validate.go:11-14`), so old
  data and old tabs keep working, and an old tab's `editEntry` preserves `dur`
  (`{...e, ...changes}`, `model.js:493`). Still add a check in the `p-` rows loop
  (`validate.go:91-99`) and the `d-` entries loop (`:121-158`): integer, 5–1440, and
  `t + dur ≤ 24:00` when both are present. Add cases to `validate_test.go`.
- **No migration** is needed (docs are opaque JSON). Check `defaults.go`/`settings.go`
  validation for the activity-preset field, and keep the README tables in step.

### A3. Views

| Page    | Default                               | Contents                                                                                     |
| ------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| Today   | Day timeline (replaces `#today-plan`) | Hour rail, now-line, logged = solid, planned = dashed ghost, "Anytime" tray for untimed      |
| Plan    | Week board (Day on phones)            | 7 day columns × 06:00–22:00 (range follows data), saved-activity palette, per-day budget bar |
| History | Week/Day grid + Month heatmap         | Same renderer, read-only: solid logged, ghost planned, episode range bars in their own lane  |

- Phone: Day view with a 7-day header strip (see C1), activity palette as a bottom
  sheet, and editing in a sheet. Desktop: palette in a side column; drag from it onto a
  slot.
- Past days are edited on Today (`today.open(date)`), so History stays read-only in v1
  and offers "Edit" as a deep link.
- Episodes: `when` → `endedAt`; "Still going" renders as an open-ended bar.
- Keep a **List** toggle on Plan and Today so there is always a linear view.

### A4. Interaction spec

- **Pointer Events**, not HTML5 drag-and-drop (it doesn't fire on touch). `touch-action: none`
  only on the grabbed block; on touch, a ~350 ms press-and-hold picks a block up so normal
  vertical scrolling still works.
- Snap to 15 min (minimum block 15 min). Resize from top/bottom edges, with an 8 px
  visible handle and a ≥44 px hit area. Auto-scroll near the viewport edge. Escape cancels.
  A live label while dragging: "14:00–15:30 · −2".
- Overlaps lay out in side-by-side lanes. Drop on another day column to move it.
- **Moving across days is two documents** (`p-A` remove, `p-B` add) and is **not
  atomic**. Always **add to the target first, then remove from the source**, so a failure
  duplicates (visible, fixable) rather than loses, and use one Undo toast that reverts
  both.
- **Dragging is never the only way** (WCAG 2.5.7): blocks are buttons; Enter/Space grab,
  ←/→ change day, ↑/↓ move 15 min, Shift+↑/↓ resize, Enter drop, Escape cancel, with an
  `aria-live` announcement ("Moved to Tuesday, 14:00 to 15:30"). Plus an "Edit time" form
  (start, end) on every block.

### A5. CSP-safe positioning

The CSP is `style-src 'self'` (`main.go:591`): **a `style="top:…"` attribute in an `html`
template is blocked.** Set geometry from JS after render with the CSSOM
(`el.style.setProperty("--start", n)`, `--span`), as `history-matrix.js` already does with
`--weeks`, and position with `grid-row: calc(var(--start) + 1) / span var(--span)` on a
5-minute row grid in a stylesheet.

### A6. Wiring checklist (from CLAUDE.md / CONTRIBUTING.md)

- New `web/calendar.js` and any new stylesheet: add to `versionedFiles` in `main.go` and
  to `SHELL` in `web/sw.js` (an asset test fails otherwise). Never cache `/api/`.
- Build markup only with the escaping `html` tag. Respect `writable(ctx)` and the
  single-editing-tab Web Lock. Persist view mode and week start through `view-state.js`.
- Update the CONTRIBUTING scenario table and keep `CLAUDE.md` under 200 lines.

### A7. Tests

- `test/calendar.test.mjs`: snap, clamp to day, overlap lanes, `t + dur`.
- Extend `test/planner.test.mjs` and `test/browser-planner.cjs`: mouse drag and touch
  press-and-hold at 1440 and 375, the keyboard path, the C1 clipping assertion, and a
  cross-day move that fails halfway (expect a duplicate, not a loss).
- `test/browser-history.cjs`: read-only overlay of plan vs actual and episode bars.
- `validate_test.go`: `dur` bounds on plan and day entries.

### A8. Suggested order

1. C1 CSS fix, H6 `−0` and C5 empty states (**done**; see each finding for what remains).
2. `dur` + validation + sorted rows + List/Calendar toggle.
3. Plan Week/Day board with drag, resize and keyboard (**done**).
4. Today Day timeline (C3; **done**).
5. History week grid with episode bars; Month heatmap resized (C4; **done**, plan-versus-actual drift not).

---

## Appendix B. First-time walkthrough (in-app only)

| Step                             | What I saw                                                                                                          | Hesitation / verdict                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Sign-in → forced password change | **Code only, not run.** `web/app.js:119-147` hides the tabs and shows "A space of your own."                        | Good, friendly. Cannot judge the form.                                                             |
| Today, first run (375)           | Onboarding card with an inline number input, then check-in, ring `10 of 10`, `−0` / `+0`, ~24 tiles; ~5,100 px tall | Value is near the top, but the check-in is asked four times (N4) and the page reads as a lot (H1). |
| First check-in                   | Green/Amber/Red state their cost; choice sets the allowance and the ring updates                                    | **Respects the choice.** Best moment in the app.                                                   |
| First activity tap               | Tile turns green with ×1 and a stepper; Undo toast                                                                  | Clear, reversible.                                                                                 |
| Plan                             | Wall of zeros, the Add button below the fold on a phone                                                             | C5, H4. Likely abandonment point.                                                                  |
| Plan, once something is added    | List rows, projected balance                                                                                        | Still can't see the day (C2); allowance assumes Green (H5).                                        |
| Done on Today                    | Teleports to Plan, full form, wrong time                                                                            | C3 (**fixed**: logs in place, with Undo).                                                          |
| History, new account             | Dashed grid, zeros, greyed "Prepare summary", "Share this day"                                                      | C5. Nothing says what it becomes.                                                                  |

## Appendix C. Measurements

Each row is the same synthetic 60-day account. "Under 44" counts visible interactive
elements in the active tab narrower or shorter than 44 px.

| Viewport / tab | Page height | Horizontal overflow | Interactive | Under 44 px | Text under 12 px |
| -------------- | ----------: | ------------------: | ----------: | ----------: | ---------------: |
| 1440 Today     |    2,938 px |                   0 |          69 |           8 |         37 / 267 |
| 1440 Plan      |    1,540 px |                   0 |          16 |           0 |           0 / 57 |
| 1440 History   |    1,975 px |                   0 |          98 |          67 |         56 / 833 |
| 375 Today      |    5,756 px |                   0 |          69 |           7 |         37 / 267 |
| 375 Plan       |    2,134 px |                   0 |          16 |           0 |           0 / 57 |
| 375 History    |    2,835 px |                   0 |          98 |          52 |         56 / 833 |
| 360 Today      |    5,591 px |                   0 |          69 |           7 |                – |
| 360 History    |    2,792 px |                   0 |          98 |          57 |                – |
| 320 Today      |    7,495 px |                   0 |          69 |           7 |                – |
| 320 History    |    2,915 px |                   0 |          98 |          46 |                – |

Other measured facts: Today activity tiles are 127 px tall at 1440 and 375, and the
activity block is 1,941 px (1440) / 2,669 px (375); the Plan chips are 88 × 100 px on
phones (3.3 visible at 375 px);
`#plan-add` sits at 748 px (1440 / 900 viewport) and 870–882 px (320–375 px phones);
history calendar cells are 25 × 25 px at every width; the tab bar fits without clipping at
320 px (294 px usable).
