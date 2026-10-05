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
