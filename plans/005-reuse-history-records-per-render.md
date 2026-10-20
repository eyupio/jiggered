# Plan 005: Reuse History records during each render

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6ab9483..HEAD -- web/history.js web/history-model.js web/model.js test/history.test.mjs`
> If any listed file changed since this plan was written, compare the excerpts
> below against the live code. On mismatch, stop and report.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `6ab9483`, 2026-10-20

## Why this matters

One History render currently creates and sorts Day and Episode collections
repeatedly. `historyInsights` enumerates both collections to find the all-time
Period, then `selectHistory` enumerates them again for the selected and
previous Periods. The History view separately enumerates Episodes for symptom
options and re-enumerates both collections for its empty-state messages. The
server allows up to 10,000 records per Account, so one render can sort the same
records several times. Derive fresh sorted collections once per render and
reuse them without changing filtering, analytics or cross-render freshness.

## Current state

- `web/model.js:listDays` and `listEpisodes` each enumerate `docs`, make
  readable records, and sort a fresh array (`:568-580`). Readable document
  copies are cached in a `WeakMap`, but array enumeration/filter/map/sort still
  runs each time (`:554-565`).
- `web/model.js:selectHistory` calls both list functions and filters their
  arrays (`:811-831`). `summary` and other callers use this API, so keep its
  existing signature and behavior.
- `web/history-model.js:historyInsights` calls `historyRange(docs, today,
  "all")`, then `selectHistory` for the current and previous Periods
  (`:83-100`). `historyRange(..., "all")` also builds the lists
  (`:49-59`).
- `web/history.js:render` calls `listEpisodes` for symptom options, calls
  `historyInsights`, then calls `listEpisodes` and `listDays` again for empty
  states (`:380-410, 544-569`). Its `setRange` helper also calls `historyRange`
  when the person changes the Period or the date rolls over (`:113-120`).
- The History model test already creates 10,000 Days and 10,000 Episodes and
  checks counts, averages and the 60-bucket limit
  (`test/history.test.mjs:83-103`). The real-browser History scenario seeds
  600 Days and 900 Episodes and exercises search/filter behavior
  (`test/browser-history.cjs:1-9, 24-35`).

Representative current History render:

```js
options = [...new Set([...S.symptoms, ...listEpisodes(docs).flatMap(([, e]) => e.symptoms)])];
const data = historyInsights(docs, S, today, filters());
...
$("noeps").textContent = listEpisodes(docs).length ? ... : ...;
$("nodays").textContent = listDays(docs).length ? ... : ...;
```

(`web/history.js:400-410, 564-569`.)

Repository conventions: pure analytics live in `web/history-model.js` and
`web/model.js`; tests use Node's built-in test runner in `test/*.test.mjs`.
Changes should preserve the current public function signatures where practical,
avoid mutating the opaque `docs` object, and match the existing readable-record
cache pattern. Domain language in `GLOSSARY.md` uses **Day**, **Episode**,
**History** and **Period**; keep those terms in comments and UI copy.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused History logic | `node --test test/history.test.mjs` | All History model tests pass, including the new single-enumeration/reuse regression. |
| Frontend format, lint and unit suite | `npm ci --prefix test && npm --prefix test run check` | Prettier, ESLint and all Node logic tests pass. |
| Browser History scenario | `npm ci --prefix test && npm --prefix test run browser:install && node test/browser-history.cjs` | Dependencies and Chromium install; the large-account History scenario passes. |
| Full browser suite | `npm --prefix test run browser` | All shared browser scenarios pass. |

The targeted browser scenario builds a temporary Go fixture and database; it
requires the locked Playwright dependency and an available Chromium install.

## Scope

**In scope**:
- `web/history.js`
- `web/history-model.js`
- `web/model.js`
- `test/history.test.mjs`

**Out of scope**:
- `web/today.js` — its `historyInsights` call should retain the default
  behavior, which will also benefit from deriving collections once internally.
- `test/browser-history.cjs` — use this existing end-to-end scenario; add no
  browser-only timing assertion.
- Server document limits, database schema, record shapes, caches shared across
  renders, and all other views.
- Introducing wall-clock performance thresholds that make CI timing-dependent.

## Git workflow

No branch or commit convention is prescribed. Keep this optimization and its
logic regression test in one change; do not commit, push or open a PR unless
asked.

## Steps

### Step 1: Separate selection over prepared collections

In `web/model.js`, extract the filtering body of `selectHistory` into a helper
that accepts already-sorted `days`, `episodes` and `filters`. Keep
`selectHistory(docs, filters)` as a compatibility wrapper that calls
`listDays(docs)` and `listEpisodes(docs)` once each, then delegates. The helper
must only filter the supplied arrays; do not sort them, mutate them or alter
search/filter semantics.

**Verify**: `node --test test/history.test.mjs` → existing History and model
selection tests pass with no changed results.

### Step 2: Let History analytics reuse prepared collections

In `web/history-model.js`, let `historyRange` and `historyInsights` accept an
optional prepared record bundle `{ days, episodes }`. When absent, derive the
two sorted lists once inside `historyInsights`; when present, use those exact
arrays for all-time date discovery and both current/previous selections. Keep
existing four-argument `historyInsights(docs, settings, today, filters)` calls
valid, including the caller in `web/today.js`. Keep existing `historyRange`
callers valid. Do not mutate the prepared arrays; filtering must create the
result arrays as it does now.

Add a test in `test/history.test.mjs` that wraps a document map in a `Proxy`
counting `ownKeys`. A default `historyInsights` call should enumerate the
document map once for Days and once for Episodes (two enumerations total), not
once per internal calculation. A second call supplied with prepared arrays
must produce deeply equal analytics without enumerating its `docs` argument.

**Verify**: `node --test test/history.test.mjs` → the new enumeration/reuse
assertions pass, as do the 10,000-Day/10,000-Episode aggregation checks.

### Step 3: Derive and reuse records in `History.render`

In `web/history.js`, derive `records.days = listDays(docs)` and
`records.episodes = listEpisodes(docs)` once near the start of `render`, before
profile initialization or date-rollover handling. Allow the internal
`setRange` helper to receive these optional records and pass them to
`historyRange`; event-handler calls without records should continue to work.
Pass the same bundle into `historyInsights`. Use `records.episodes` for symptom
options and the no-Episodes message, and `records.days` for the no-Days
message. Do not keep the bundle across renders: fresh arrays must reflect any
document changes in the current store snapshot.

**Verify**: `node --test test/history.test.mjs` and
`npm ci --prefix test && npm --prefix test run browser:install && node test/browser-history.cjs`
→ all logic assertions and the large-account real-browser History scenario
pass.

### Step 4: Run the frontend checks

Run formatting, lint, the complete Node test suite and all shared browser
scenarios.

**Verify**: `npm ci --prefix test && npm --prefix test run check`, then
`npm --prefix test run browser` → all checks pass.

## Test plan

- Extend `test/history.test.mjs`, following its current fixtures and the
  `large histories have at most 60 buckets and preserve counts and averages`
  test.
- Assert `historyInsights` derives Day and Episode collections once each when
  called with its existing API, and does not enumerate `docs` when prepared
  records are supplied.
- Compare all analytics outputs for default and prepared-record calls; verify
  input `docs` and prepared arrays are not mutated.
- Keep the existing `model.selectHistory` tests passing to protect callers that
  do not provide prepared lists.
- Run `node --test test/history.test.mjs`, `npm --prefix test run check`, and
  the existing large-account browser History scenario. Run the full browser
  suite before completion.

## Done criteria

- [ ] History rendering derives sorted Day and Episode lists once each and
  shares those arrays with range calculation, analytics, symptom options and
  empty-state checks.
- [ ] `historyInsights` derives lists once each when no bundle is provided and
  reuses supplied lists without enumerating `docs`.
- [ ] `selectHistory(docs, filters)` remains supported and returns identical
  filtered records for existing callers.
- [ ] Analytics and rendering do not mutate the input documents or prepared
  lists; lists are refreshed on every render.
- [ ] Focused History tests, `npm --prefix test run check`, the History browser
  scenario and the full browser suite pass.
- [ ] Only the four in-scope files are modified outside `plans/`.
- [ ] The status row for Plan 005 in `plans/README.md` is updated.

## STOP conditions

Stop and report instead of improvising if:

- Existing `historyInsights`, `historyRange` or `selectHistory` call sites
  differ from the current usage described here.
- Passing prepared lists changes selected record order, prior-Period metrics,
  invalid-date behavior, filtering, or empty states.
- The proposed reusable helper requires mutating the arrays, caching the arrays
  across renders, or changing a document's stored shape.
- The new enumeration test cannot distinguish a single derivation from repeated
  scans without adding a runtime-only instrumentation mechanism.
- A test would need a wall-clock performance threshold to pass.

## Maintenance notes

- Keep `listDays` and `listEpisodes` as the canonical readable/sorted record
  constructors; do not duplicate their validation or sorting logic in History.
- The per-render bundle is intentionally ephemeral. Cross-render memoization
  would need invalidation when a document is replaced and is not part of this
  plan.
- Revisit the 10,000-record History test if the account document limit changes;
  use deterministic scan-count tests rather than CI time thresholds.
