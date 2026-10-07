# Jiggered

A self-hosted tracker where each Account records daily energy, plans activities and keeps a history of symptom Episodes. It describes a person's own records; it never establishes medical causes.

## Language

### Accounts

**Account**:
A login together with everything it owns. Each Account's records are private to it.
_Avoid_: User, person, profile

**Admin**:
An Account with the role to manage other Accounts. An Admin sees Account metadata only, never another Account's Days, Plans or Episodes.
_Avoid_: Superuser, owner

### Energy

**Day**:
The record for one date: its check-in, whether sleep was poor, and its Entries.
_Avoid_: Log, check-in (for the whole record)

**Check-in**:
Choosing green, amber or red for a Day. Amber and red lower that Day's Allowance.
_Avoid_: Status, mood

**Poor sleep**:
A flag on a Day, separate from the Check-in, that lowers that Day's Allowance.
_Avoid_: Sleep penalty (that is the amount, not the flag)

**Energy unit**:
The unit costs and balances are counted in, shown as points or as spoons. Which one is only a display preference; the stored numbers are identical.
_Avoid_: Currency, credits

**Budget**:
Your standing daily energy setting, the starting point for each new Day. A Day keeps the Budget it was made under, so changing it never rewrites history.
_Avoid_: Cap, limit

**Allowance**:
What a particular Day actually has to spend: its Budget less the Poor-sleep and Check-in reductions.
_Avoid_: Cap, quota

**Remaining**:
A Day's Allowance less its net spending, where Recoveries add energy back.
_Avoid_: Balance left, available

### Activities

**Activity**:
A reusable item in your own list, with a name, a cost and a group.
_Avoid_: Item, task

**Entry**:
One occurrence of an Activity logged on a Day.
_Avoid_: Activity (for a single occurrence), row, log line

**Recovery**:
An Activity with a negative cost, so logging it gives energy back. It is not a separate kind of thing.
_Avoid_: Rest activity, negative activity

### Symptoms

**Episode**:
One continuous occurrence of symptoms, with an onset and optionally an end.
_Avoid_: Incident, flare, attack

**Symptom**:
A named item recorded inside an Episode; never recorded on its own.
_Avoid_: Condition

**Ongoing**:
An Episode that has not ended.
_Avoid_: Active, open

**Trigger**:
A possible cause you note on an Episode. It is your own observation, never presented as a medical cause.
_Avoid_: Cause, reason

### Planning

**Plan**:
The reservations for one date. It stays separate from Days so unlogged days never appear in history.
_Avoid_: Schedule, forecast (for the record itself)

**Planned entry**:
One reservation on a Plan. It holds energy without counting as spending until it is Done.
_Avoid_: Planned activity, plan item, plan row

**Done**:
Marking a Planned entry complete: it logs one Entry and releases the reservation. A Planned entry never marked Done stays a plan and is never logged as skipped.
_Avoid_: Completed, checked off

**Committed**:
The cost of a date's pending Planned entries.
_Avoid_: Reserved total

**Projected**:
A date's Remaining after its pending Planned entries and pending Recoveries.
_Avoid_: Forecast balance

**Shortfall**:
The amount by which pending Planned entries exceed what a date has left, before planned Recoveries.
_Avoid_: Gap, deficit

### Defaults and lists

**Your lists**:
Your own Activities, Symptoms and Triggers, which only you change.
_Avoid_: Presets, custom lists

**Shared defaults**:
The starter lists an Admin sets for the instance, offered to every Account.
_Avoid_: Product defaults, global defaults

**Offer**:
The notice that new Shared defaults can be appended to the end of Your lists. Accepting never changes your existing items, order or costs.
_Avoid_: Sync, merge

### Saving and sync

**Change**:
One edit you make, such as adding an Entry, that is saved on this device and then sent to the server.
_Avoid_: Operation, mutation, update

**Queued**:
A Change saved on this device but not yet accepted by the server.
_Avoid_: Pending, unsynced

**Saved**:
A Change the server has accepted.
_Avoid_: Synced, committed

**Conflict**:
The server's copy changed under a queued Change, so the Change is replayed on the newer copy.
_Avoid_: Merge failure

**Refused change**:
A Change that cannot be applied, such as a same-field edit or an edit to a deleted record. It is kept as a Held change, never shown as saved.
_Avoid_: Rejected, failed

**Held changes**:
Refused changes kept on the device until you resolve them, by keeping the server copy or using your change.
_Avoid_: Recovery (reserved for energy), outbox

**Draft**:
Unsent text in a form, kept for seven days.
_Avoid_: Autosave

### Tools

**Tool**:
A self-contained module in the Tools tab that keeps its own record.
_Avoid_: Widget, app, plugin

**Fretboard**:
A Tool: a board of Cards you arrange by what is in your hands and what matters now.
_Avoid_: Kanban, task board

**Board**:
The Fretboard canvas.
_Avoid_: Canvas, grid

**Card**:
One item on a Board.
_Avoid_: Note, sticky

**Today's three**:
The three Cards you pick to do today.
_Avoid_: Top three, priorities

### Instance and data

**Backup**:
A copy of the whole instance's database, made by an Admin or on a schedule and optionally encrypted. It is the one exception to Admins never seeing personal records.
_Avoid_: Export (for the whole instance), snapshot, dump

**Export**:
A copy of one Account's own data, either everything or as CSV. Only that Account can make it.
_Avoid_: Backup (for one Account), download

**Summary**:
A printable report of an Account's own records over a period.
_Avoid_: Report, printout

**Restore**:
Putting data back from an Export (for an Account) or a Backup (for the instance). Restoring an Account's data always previews first and keeps existing records by default.
_Avoid_: Import, recover

**Bring back**:
Undeleting a record on purpose. A deleted record wins over a queued Change, so bringing it back is deliberate.
_Avoid_: Restore (reserved for Exports and Backups), undelete

**Undo**:
Reversing the last correction or removal.
_Avoid_: Revert

### Registration and public pages

**Registration**:
The setting that lets people create their own Accounts with a verified email. It is closed by default.
_Avoid_: Signup, sign-up

**Public pages**:
The signed-out pages: the landing page, the feature pages and help. Personal records are never on them.
_Avoid_: Marketing site

**Public application URL**:
The canonical origin of the instance, set by an Admin. Public pages are indexed once it is set, unless indexing is opted out.
_Avoid_: Base URL, domain

**Indexing**:
Whether search engines are asked to list the Public pages. Sign-in, registration, API and personal pages are never indexed.
_Avoid_: SEO, crawling

### Account states

**Disabled**:
An Account that cannot sign in, set by an Admin. Its records are kept.
_Avoid_: Suspended, banned, deactivated

**Temporary password**:
A password an Admin or the command line gives a new Account, which must be changed before anything else works.
_Avoid_: Initial password, default password

**Account recovery**:
Regaining access when you cannot sign in, through a verified recovery email or recovery codes.
_Avoid_: Password recovery, password reset

**Recovery codes**:
One-time codes issued with two-step verification, usable in place of the authenticator.
_Avoid_: Backup codes

**Last Admin**:
The only active Admin. It cannot be demoted, disabled or deleted, by anyone, including itself.
_Avoid_: Root, owner

### History

**Period**:
The span of dates a History view or Summary covers.
_Avoid_: Range, window

**Net**:
A Day's spending less its Recoveries.
_Avoid_: Balance, total

**Average net**:
Net averaged over Days with at least one Entry. A Day holding only a Check-in does not count.
_Avoid_: Average spend

**Unlogged day**:
A date with no Day. It is unknown, never a day of zero spending, and charts leave it blank.
_Avoid_: Empty day, zero day, gap

### Security and administration

**Signed-in device**:
A place an Account is currently signed in, which the Account can sign out.
_Avoid_: Session

**Audit log**:
The Admin-visible record of who did what to Accounts and settings. It never holds personal records.
_Avoid_: Activity log, history

## Flagged ambiguities

- The Summary offers 30, 90 and 365 days or everything (`web/model.js` `RANGES`), while History offers 7, 30, 90, 180, 365 days or all time (`web/history-model.js` `HISTORY_RANGES`). Decide whether **Period** should be one list.

- The UI offers **Restore my record** in Held changes (`web/app.js`), which is bringing a deleted record back, not a Restore. Rename it to "Bring back".

- The code and UI still say "recovery" for Held changes (`web/sync.js`, "Recovery is full", the `jiggered-device-recovery-v1` export). In this glossary **Recovery** always means a negative-cost Activity. Rename the UI and code later.
- "Gap" is used in code for the shared-defaults difference (`defaultsGap`) and for an unaffordable plan (`forecast().gap`). Neither is a glossary term.
