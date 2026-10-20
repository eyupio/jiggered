# Plan 006: Remove fixed browser-scenario counts from the administration guide

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6ab9483..HEAD -- docs/ADMINISTRATION.md CONTRIBUTING.md`
> If either file changed since this plan was written, compare the excerpts below
> against the live files. On mismatch, stop and report.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `6ab9483`, 2026-10-20

## Why this matters

The Administration guide says the browser suite has eight scenarios, but the
current contributor guide lists 13 shared scenarios and a separate public-page
check. A fixed count becomes stale as coverage changes and misstates what the
documented browser command runs. Use stable descriptions of the suite instead
of repeating its current size.

## Current state

- `docs/ADMINISTRATION.md` points to the Contributor guide and says “all eight
  browser scenarios” at lines 583-587.
- Its example commands repeat “all eight scenarios” in the comment on
  `npm --prefix test run browser` at lines 589-596.
- `CONTRIBUTING.md:114-138` lists each shared browser scenario and separately
  documents `node test/browser-public.cjs`. This list is the maintained
  scenario inventory; leave it unchanged.
- `test/package.json:9` defines `browser` as `node support/run-browser.cjs`.
  The scenario runner is the source of which shared scenarios execute.

Current excerpt from `docs/ADMINISTRATION.md`:

```markdown
See [CONTRIBUTING.md](../CONTRIBUTING.md) for local setup, the code map, all eight
browser scenarios and change guidelines.
...
npm --prefix test run browser   # compiles once, runs all eight scenarios
```

Repository convention: `CONTRIBUTING.md` owns the current code map, check
commands and explicit scenario inventory. The Administration guide should
link to that inventory rather than maintain a separate count. Preserve its
existing setup commands and requirements.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Search for stale count | `! rg -n 'all eight|all [0-9]+ browser scenarios|all [0-9]+ scenarios' docs/ADMINISTRATION.md` | Exit 0 because no fixed scenario-count phrase remains. |
| Markdown formatting | `npm ci --prefix test && test/node_modules/.bin/prettier --check --ignore-path .prettierignore docs/ADMINISTRATION.md` | Install succeeds and Prettier reports the file formatted. |
| Standard project checks | `npm --prefix test run check` | Formatting, ESLint and frontend logic tests pass. |

## Scope

**In scope**:
- `docs/ADMINISTRATION.md`

**Out of scope**:
- `CONTRIBUTING.md` — its scenario list is intentionally the detailed
  inventory and must remain unchanged.
- `test/package.json`, browser scenario scripts and CI workflow behavior.
- Adding or removing scenarios; changing the browser runner or its commands.
- Other historical audit documents under `docs/audits/`; they describe past
  repository states and are not the current Administration guide.

## Git workflow

No branch or commit convention is prescribed. Keep this as a focused
documentation-only change; do not commit, push or open a PR unless asked.

## Steps

### Step 1: Replace the stale count with stable suite descriptions

In `docs/ADMINISTRATION.md`, change the sentence at lines 585-586 to refer to
“the browser scenarios” without a number. Change the comment after
`npm --prefix test run browser` at line 595 to say it compiles once and runs the
shared browser suite, also without a number. Keep the commands, Go/Node version
requirements, and separate public-page browser command documentation unchanged.

**Verify**: `! rg -n 'all eight|all [0-9]+ browser scenarios|all [0-9]+ scenarios' docs/ADMINISTRATION.md`
→ no fixed scenario-count wording remains in the Administration guide.

### Step 2: Check formatting and nearby docs

Run Prettier on `docs/ADMINISTRATION.md` and the standard frontend check. Do not
run the write-mode formatter; if Prettier reports a difference, make only the
formatting correction needed in the in-scope file.

**Verify**: `npm ci --prefix test && test/node_modules/.bin/prettier --check --ignore-path .prettierignore docs/ADMINISTRATION.md`
and `npm --prefix test run check` → both pass.

## Test plan

- No behavior test is required for this wording correction.
- The fixed-count search is the regression check. `CONTRIBUTING.md` remains the
  maintained scenario inventory and is not edited.
- Run targeted Prettier and `npm --prefix test run check`.

## Done criteria

- [ ] Both stale “eight scenarios” statements are replaced with wording that
  contains no fixed count.
- [ ] Browser command, Go/Node requirements and public-page check remain
  unchanged.
- [ ] `rg` fixed-count regression check returns no matches.
- [ ] Targeted Prettier check and `npm --prefix test run check` pass.
- [ ] Only `docs/ADMINISTRATION.md` is modified outside `plans/`.
- [ ] The status row for Plan 006 in `plans/README.md` is updated.

## STOP conditions

Stop and report instead of improvising if:

- The Administration guide no longer contains the two stale references shown
  above, or its browser command has changed since this plan was written.
- The current Contributor guide no longer owns the scenario inventory; do not
  guess a replacement count or update multiple files without a revised scope.
- Removing the count would make the command description inaccurate or imply
  that `npm --prefix test run browser` also runs the separate public-page check.
- The wording change requires modifying the scenario runner, tests, or any
  file outside `docs/ADMINISTRATION.md`.

## Maintenance notes

- Avoid putting a scenario count in this guide again. Link to the Contributor
  guide for the maintained list.
- When adding or removing browser scenarios, update the inventory in
  `CONTRIBUTING.md` and let this guide's generic wording remain accurate.
- Preserve the separate public-page check; it is not included in the shared
  browser runner command described here.
