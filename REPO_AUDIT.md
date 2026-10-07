# Repository audit

Audited 2026-10-07 on branch `claude/repo-audit-cleanup-vmag9b`, which matches `main` at `8e44de9`. Nothing was changed apart from adding this file.

**Name clash:** `docs/audits/REPO_AUDIT.md` already exists. It is an archived audit of 2026-10-02, from when the repository was `jnnngs/jiggered`. This file is a fresh audit of the current tree. Before merging, pick one of two options:

- Move this file to `docs/audits/REPO_AUDIT-2026-10-07.md` and add it to `docs/audits/README.md`.
- Replace the older file.

## Summary

| Measure | Result |
| --- | --- |
| Size | 225 tracked files. Pack is about 2 MiB, `.git` 2.4 MiB. 80 files sit in the repository root, 61 of them `.go`. |
| Stack | Go 1.27.1 standard-library HTTP server, pure-Go SQLite, embedded vanilla ES-module frontend (about 13.6k JS lines, 7 CSS files), Docker distroless image on GHCR. |
| Code size | 17.2k Go lines (24 production files, 37 test files, 1 `internal/` package). 13.6k JS lines. CSS: `style.css` 3.8k lines, `dashboard.css` 2.5k lines. |
| Dependencies | Go: 2 direct, 9 indirect. npm (dev only, `test/`): eslint, globals, playwright, prettier, all exact-pinned. The Zoomies tool has its own lockfile. |
| Checks run here | `gofmt -l` is clean. `go vet ./...` and `CGO_ENABLED=0 go build ./...` pass. `go test ./...` passes. `npm ci` found 0 vulnerabilities. `npm --prefix test run check` (Prettier, ESLint and 151 logic tests) passes with 0 skipped. I did not run the Chromium browser suite. CI is reported to run it. |
| Not checkable | `staticcheck`, `deadcode` and `golangci-lint` cannot analyse Go 1.27 code in this container. The installed linter is built with Go 1.25. Unused Go functions were checked with a reference-count script: none found. |
| Dead code | No unreferenced web file or Go function found. 11 JS `export`s have no importer outside their own file (Nice to have). |
| TODO/FIXME/HACK | None in source. |
| Git | 162 commits, 1 tag (`v1.0`), 1 branch besides `main`, no large binaries in history. The largest blob is `UI_AUDIT.md` at 295 KB. |

**Verdict:** this is a healthy repository. It has pinned actions and base images, CI on pull requests, a real migration test, and contributor and architecture docs that match the code. Nothing breaks setup, builds or CI. The weak points are archaeology and process artefacts rather than live code:

- About 490 KB of historical audit prose lives in the tree and in the AI-context pack. One of those files sits at the repository root.
- The Go package is flat with 80 files at the root, and several test and source files are named after the review that created them, not the subject they test.
- The agent-instruction files are split inconsistently.
- Tooling stops at `go vet` for Go and has no hooks.

Contributor docs are good. A few drifted details are listed below.

## 1. Critical

**No findings.** I tried to clone, install, run and test, and everything works as documented. The closest candidate is "High 1" (`./...` picks up `test/node_modules`). It is harmless today but is a trap.

## 2. High impact

### H1. Two UI audit files, one of them 295 KB at the repository root

- **Pass:** Maintainer review
- **Where:** `UI_AUDIT.md` (1,785 lines, the largest file in the repository and in history) and `docs/audits/UI_AUDIT.md` (319 lines).
- **Problem:**
  - The root file contains two audits, "Part 1" and "Part 2".
  - It lists "open" findings against revision `6ee614a`, while `docs/audits/README.md` says audits in that folder are archived and may be stale.
  - Anyone, human or agent, grepping the repository gets UI findings from two eras with overlapping IDs.
  - The Zoomies source pack (`zoomies-ai-context.config.json`) excludes only secrets and `node_modules`, so this file is ingested into every AI-context snapshot. It is roughly 70k tokens of the snapshot.
  - Its own text says it supersedes `docs/audits/UI_AUDIT.md`, yet the two sit in different places.
- **Fix:**
  1. `git mv UI_AUDIT.md docs/audits/UI_AUDIT_2026-10.md`.
  2. Rename the older file to `UI_AUDIT_2026-10-01.md`, or leave it as is.
  3. Update the two links in `docs/audits/README.md` and the `UI_AUDIT.md` references in `docs/audits/REPO_AUDIT.md` (lines 35 and 148).
  4. In the root file, change the self-reference to `docs/audits/UI_AUDIT.md`.
- **Risk:** Mechanical. Only `docs/audits/README.md`, `docs/audits/REPO_AUDIT.md` and the file itself reference `UI_AUDIT.md`, checked with a repository-wide grep. The one external code reference is the "Where" text inside the file. Needs confirmation that no wiki or issue links to the root path.

### H2. Historical audits ride along in the AI-context pack and agent context

- **Pass:** Maintainer review
- **Where:** `zoomies-ai-context.config.json`, `.github/workflows/zoomies-ai-context.yml` (`EXPECTED_CONFIG`, `CONFIG_HASH`), `docs/audits/*`, `docs/marketing/*`.
- **Problem:**
  - After H1, about 490 KB of audit text and the 80-line marketing tracker would still be packed into the source snapshot that `CLAUDE.md` tells agents to read first.
  - That is noise and cost, and stale findings can mislead agents. The README of the audit folder itself warns that they are stale.
- **Fix:** Add `docs/audits/**`, `docs/marketing/**` and `**/package-lock.json` to the `exclude` list.
- **Risk:** Needs care. The workflow embeds the config and a hash (`CONFIG_HASH`), and the header says it is "Managed by Zoomies". Regenerate it through the Zoomies setup flow, as `.prettierignore` already says, instead of hand-editing the workflow. Confirm the Zoomies UI supports custom excludes.

### H3. `AGENTS.md` carries only the generated Zoomies block, not the repository rules

- **Pass:** Maintainer review
- **Where:** `AGENTS.md` (24 lines) and `CLAUDE.md` (158 lines, the Zoomies block repeated at the bottom).
- **Problem:**
  - The rules that matter live only in `CLAUDE.md`: single SQLite connection, no cgo, versioned assets, `SHELL` list, escaping and so on.
  - Any non-Claude agent that follows the `AGENTS.md` convention sees none of them.
  - The Zoomies block is also duplicated word for word in two files.
- **Fix:** Move the body of `CLAUDE.md` into `AGENTS.md` (the stack-neutral file) and make `CLAUDE.md` a stub containing `@AGENTS.md`. Keep one copy of the Zoomies block. Keep both under the 200-line cap stated in `CLAUDE.md`.
- **Risk:** Needs care. The `<!-- zoomies-ai-context -->` markers are managed by a bot, so confirm it updates the block in whichever file now holds it. CONTRIBUTING and `.prettierrc` scripts reference `CLAUDE.md` by name (`test/package.json` `format` scripts).

### H4. `go ... ./...` enters `test/node_modules`

- **Pass:** New contributor walkthrough
- **Where:** `test/node_modules/flatted/golang/pkg/flatted` (matched by `go list ./...` after `npm ci --prefix test`); the check sequence in `CONTRIBUTING.md` ("Make and check a change").
- **Problem:**
  - Go does not skip `node_modules`.
  - The documented flow runs `npm ci` first and then `go vet ./...` and `go test -race ./...`, so every local run vets and builds a third-party Go file.
  - It passes today. It also appeared as a third package in `go test ./...` output, and it makes tools such as `deadcode` and `govulncheck` fail on unrelated code.
  - CI avoids the problem only by luck: the Go steps run before `npm ci`.
- **Fix:** Add an empty-module marker so Go treats `test/` as a separate module. For example, create `test/go.mod` containing `module jiggered-test-fixtures`, with `go 1.27.1` if wanted. Also add a line to `CONTRIBUTING.md` explaining why it exists.
- **Risk:** Safe. The marker excludes the whole `test/` subtree from `./...`. No Go code lives there. Confirm `.dockerignore` already excludes `test/`; it does.

### H5. Test and source files are named after process, not subject

- **Pass:** Maintainer review
- **Where:**
  - `audit_test.go`, `audit_regression_test.go`, `security_fix_test.go`, `docs_robust_test.go`.
  - `product_improvements.go` and `product_improvements_test.go` (the first contains the `migrateProductImprovements` schema migration and usage-measurement code).
- **Problem:**
  - Names such as "audit regression", "security fix" and "robust" describe why a test was written, not what it covers.
  - A contributor adding an `audit_log` test cannot tell which of three files to use.
  - `audit_test.go` holds audit-log tests, but `audit_regression_test.go` holds something different.
  - `CONTRIBUTING.md`'s "Find the right file" table has no row for them.
- **Fix:**
  - Move each test into the file for the code it exercises, for example `audit_log` tests into `admin_test.go`, and docs tests into `docs_test.go`.
  - Rename `product_improvements.go` to `usage.go` plus a migration in `db.go`, or at least to `usage_measurement.go`.
  - Do this as pure moves with no edits to test bodies.
  - Delete empty files and run `go test -race ./...` before and after, comparing the `-v` test list.
- **Risk:** Mechanical but large in diff. Check for helper functions and package-level fixtures shared between those files (`helpers_test.go`). Do not combine with behavioural changes.

### H6. Flat package with 61 Go files at the repository root

- **Pass:** Maintainer review
- **Where:** repository root (`*.go`, 24 production and 37 test files).
- **Problem:**
  - `CLAUDE.md` states the single package is deliberate, and a Go package of 17k lines is not itself wrong.
  - The cost is the root directory: 80 files, plus 61 Go files, plus config, plus docs. A new contributor's first view is a wall of files.
  - `CONTRIBUTING.md` needs a 17-row lookup table to compensate.
  - The `cmd/`-free layout also means the binary cannot be built from a subfolder.
- **Fix:** Do not split packages now. That is a large change with an unclear payoff, as `CONTRIBUTING` itself says. Instead make two cheap moves:
  1. Move the web-facing static assets listing (`assets/brand`, `zoomies-ai-context.config.json`) out of the root where possible. The config must stay if Zoomies requires the path.
  2. Add a short "Layout" paragraph at the top of the root `README`/CONTRIBUTING pointing at the lookup table, and keep the table current (see H7).
- **Risk:** Low if only documentation changes. Splitting into packages: Needs confirmation and a separate design decision (ADR). Not recommended unless a file group has a stable boundary, such as `remote_*.go` plus `backup*.go`.

### H7. Contributor docs have small drifts

- **Pass:** New contributor walkthrough
- **Where:**
  - `.github/workflows/image.yml:53` says "nine Chromium scenarios". `CONTRIBUTING.md` lists 13, plus `browser-public.cjs`.
  - The "Find the right file" table omits `defaults.go`'s `web/defaults.json`, `web/tools.js`/`fretboard*.js`, `web/planner*.js`, `web/calendar*.js`, `web/history-*.js`, `product_improvements.go`, `public.go` and `web/public/*`.
  - `README.md:108` carries a one-off migration note about "the former `jnnngs` image".
  - `docs/PUBLIC_RELEASE.md` says to "review and merge the release preparation PR", which has been merged.
  - `SECURITY.md` says the maintainer must enable private reporting "before the public launch".
  - `docs/audits/REPO_AUDIT.md` still names `jnnngs/jiggered`.
- **Problem:** Each is small. Together they tell a newcomer the project is mid-launch when the docs read as finished. It is unclear whether the repository is public and whether the Protect main ruleset is active.
- **Fix:**
  1. Change the CI comment to "all Chromium scenarios".
  2. Add the missing rows to the table.
  3. Move the `jnnngs` upgrade note to `docs/ADMINISTRATION.md` or delete it once the old image is gone.
  4. Tick off or delete the completed items in `PUBLIC_RELEASE.md`, and drop the pre-launch sentence from `SECURITY.md` once private reporting is on.
- **Risk:** Needs confirmation of the current GitHub settings (public visibility, private reporting, ruleset). Those cannot be seen from the working tree.

### H8. CI runs the Go suite twice and has no stricter Go lint

- **Pass:** Maintainer review
- **Where:** `.github/workflows/image.yml`, job `test`.
- **Problem:**
  - `go test -race ./...` runs, then "Coverage summary" runs `go test -count=1 -coverprofile` over the same suite. That is a second run of the whole suite (about 16 s locally, longer under `-race`).
  - Go linting stops at `go vet`. No `staticcheck` or `golangci-lint` is configured, and `govulncheck@v1.8.0` is installed with `go install` on every run, uncached.
  - The `image` job builds a two-platform image on pull requests too, although it never pushes.
- **Fix:**
  - Combine into one step: `go test -race -coverprofile=cover.out ./...`.
  - Add `staticcheck ./...`, or a minimal `.golangci.yml` with `unused`, `staticcheck`, `ineffassign` and `errcheck`. Pin the version, and make sure the linter is built with Go 1.27, which is the problem I hit locally.
  - Optionally limit the PR image build to `linux/amd64`.
- **Risk:** Linter may produce a backlog on first run. Start with `unused` and `staticcheck` and fix or suppress with a reason. Needs confirmation that coverage output under `-race` is acceptable, since the race detector slows tests.

## 3. Nice to have

### N1. No `.mailmap`, and mixed commit identity

- **Pass:** Maintainer review
- **Where:** `git log`: authors `Jnnngs` (68), `jnnngs` (18), `Claude` (56), `Copilot` (2), bots.
- **Problem:** The same person appears as two authors.
- **Fix:** Add `.mailmap` mapping both spellings to one name. Add a "Git" line in `CONTRIBUTING.md` (short imperative sentence, as `CLAUDE.md` already describes).
- **Risk:** Safe. It does not rewrite history.

### N2. Missing standard community files

- **Pass:** New contributor walkthrough
- **Where:** repository root and `.github/`.
- **Problem:**
  - Present: `LICENSE` (MIT), `CONTRIBUTING.md`, `SECURITY.md`, a PR template, Dependabot.
  - Missing: `CODEOWNERS`, a `CHANGELOG`, bug and feature issue forms (`.github/ISSUE_TEMPLATE/` only has `config.yml`, with blank issues enabled), and `CODE_OF_CONDUCT.md`.
  - The project has one tag (`v1.0`) and no visible release notes.
- **Fix:**
  - Add `.github/CODEOWNERS`, with a single owner for a solo project.
  - Add `bug_report.yml`, with a synthetic-data warning matching the PR template.
  - For the changelog, use GitHub Releases generated notes and say so in CONTRIBUTING, rather than a hand-kept file.
  - Skip the code of conduct unless wanted.
- **Risk:** Safe. CODEOWNERS only matters if review is required by a ruleset.

### N3. Eleven JS exports are used only inside their own module

- **Pass:** Maintainer review
- **Where:** `web/model.js:emptyDay`, `web/planner-model.js:planRows`, `web/profile.js:applyAppearance`, `web/episodes.js:defaultDuration`, `web/calendar-model.js:MIN_DUR,DEFAULT_DUR,MAX_COST`, `web/fretboard-model.js:KINDS,normaliseItem,normaliseThree`, `web/planner.js:effectWords`.
- **Problem:** Nothing under `web/` or `test/` imports them. The extra `export` widens the public surface of a module that has no external consumers.
- **Fix:** Drop `export` from each. Do not delete the code. It is used locally, which I checked by name in the same file.
- **Risk:** Needs confirmation. A string-based or dynamic `import()` lookup could use them, and I found none. Run `npm --prefix test run check` and the browser suite afterwards.

### N4. Tooling is not discoverable from one entry point

- **Pass:** New contributor walkthrough
- **Where:** `test/package.json`, `CONTRIBUTING.md`.
- **Problem:**
  - A contributor runs eight commands by hand (`gofmt`, `npm ... format`, `check`, `go vet`, `go build`, `go test -race`, `browser`).
  - There is no `Makefile`, `.nvmrc`/`.node-version`, pre-commit hook or editor settings beyond `.editorconfig`.
  - `npm run lint` hardcodes `test/node_modules/.bin/eslint`.
  - The documented Node range is 22.13+ or 24+, while CI uses 22 for tests and 24 for the Zoomies workflow.
- **Fix:**
  - Add a small `Makefile` with `check` (gofmt, vet, build, test, npm check) and `browser` targets. This mirrors CI so the two cannot drift.
  - Add `.node-version` containing `22`.
  - Optionally add `make hooks` for a `pre-commit` that runs the fast checks.
- **Risk:** Safe, additive. Keep CONTRIBUTING.md as the single source and have it reference the targets.

### N5. Large files and long functions

- **Pass:** Maintainer review
- **Where:**
  - CSS: `web/style.css` (3.8k lines), `web/dashboard.css` (2.5k), `web/presence.css` (1.1k).
  - JS: `web/fretboard.js` (1.5k), `web/today.js` (1.1k).
  - Go: `validateDoc` (161 lines), `twoFactorAction` (141), `runUserCommand` (134), `routes` (125), `adminServiceAction` (124), `runRemoteBackup` (121).
- **Problem:** These are the places where review diffs are hardest to read. None is broken.
- **Fix:** Do not reorganise preemptively. Split only when a change touches them: for example, one function per two-factor action, or per-view CSS files grouped under `versionedFiles`. Keep the versioning rule in `CLAUDE.md` in step.
- **Risk:** CSS splits need care. New top-level stylesheets must be added to `versionedFiles` in `main.go`.

### N6. Import grouping and minor Go style

- **Pass:** Maintainer review
- **Where:** `security_fix_test.go` (the import list mixes `golang.org/x/crypto/bcrypt` into the standard-library group; gofmt accepts it).
- **Problem:** Inconsistent with the rest of the package.
- **Fix:** Run `goimports -local github.com/eyupio/jiggered` once, or enforce it via the linter in H8.
- **Risk:** Safe.

### N7. Dependabot does not cover the Zoomies tool lockfile

- **Pass:** Maintainer review
- **Where:** `.github/dependabot.yml`, `.github/zoomies-ai-context/package-lock.json`.
- **Problem:** The generator is intentionally pinned and managed upstream, so this may be by design. Dependabot covers `/test` but not that folder.
- **Fix:** Leave as is, and say so in a comment in `dependabot.yml`.
- **Risk:** Needs confirmation with the Zoomies setup, which says upgrades go through a PR.

## 4. Pass 2 — new contributor walkthrough

| Step | Result |
| --- | --- |
| Clone and install | `npm ci --prefix test` worked. Go 1.27.1 downloaded automatically through the toolchain line in `go.mod`. A Go older than 1.21 would fail with an unhelpful message, and CONTRIBUTING does not mention the automatic toolchain download. |
| Configure | No `.env` is needed. `.env.example` matches `loadConfig` (`APP_DB`, `APP_ADDR`, `APP_PUBLIC_ORIGIN`, `APP_PUBLIC_INDEXING`, seeds). One oddity: the `APP_USERNAME` seed defaults to `"paul"` in `main.go:239`. That is a personal name baked in as a default for the legacy seed path. Confirm it is intended. |
| Run | `go run .` plus `user add developer --admin` is documented clearly, with the two-terminal and same-database-path warning. This is the best part of the docs. |
| Test | All checks pass. The race detector needs a C compiler, which CONTRIBUTING says. Running `go test ./...` also lists the `flatted` package (see H4). |
| Make a small change | CONTRIBUTING suggests editing a sentence in `web/help.js`. Good. A newcomer touching tests cannot tell which of several overlapping test files to use (H5). |
| Ask a maintainer | Is the repository public yet, and is private vulnerability reporting enabled (H7)? Which audit, if any, is authoritative (H1)? Is a single flat Go package a hard rule or a preference (H6)? |
| Community files | `LICENSE` is accurate (MIT, 2026 Paul Jennings). `CONTRIBUTING`, `SECURITY` and a PR template exist and are accurate. `CHANGELOG`, `CODEOWNERS` and issue forms are missing (N2). |

## 5. Verified clean (no action)

- **Dependencies:** the Go module is tidy with 2 direct dependencies, and the image uses `CGO_ENABLED=0`. npm packages are exact-pinned and the lockfile is committed. Actions and base images are pinned by digest.
- **Frontend:** every file under `web/` is either listed in `sw.js` `SHELL`, served by the public registry, or served from `versionedFiles`. No orphan JS module. No `console.log`. `!important` is rare (18 uses).
- **Browser tests:** every `test/browser*.cjs` is referenced by the runner and by CONTRIBUTING.
- **Ignore files and secrets:** `.gitignore` and `.dockerignore` cover databases, backups, `.env*`, archives and service keys. `test/node_modules` is ignored. No committed secrets were found by path pattern.
- **Repository history:** no stale branches, no backup-style filenames, no large binaries.
- **Release scripts:** `.github/scripts/ghcr-*.sh` are used by `cleanup-packages.yml`.

## 6. Ordered cleanup plan

Each step is its own PR, safest first. Items marked † need a maintainer decision or a GitHub-settings check before starting.

1. **Docs drift (H7, partial).** Fix the CI comment "nine", extend the code-map table, delete completed `PUBLIC_RELEASE.md` items, and drop the `jnnngs` migration note (†confirm the old image is retired). Docs and comments only.
2. **Move the root `UI_AUDIT.md` into `docs/audits/` (H1).** One `git mv` plus link fixes.
3. **Add `test/go.mod` (H4).** Verify with `go list ./...` before and after (3 packages become 2) and run CI.
4. **Housekeeping files (N1, N2, N4).** `.mailmap`, `CODEOWNERS`, a bug-report issue form, `.node-version` and a `Makefile` that mirrors CI.
5. **Merge the two instruction files (H3).** `AGENTS.md` becomes the canonical body and `CLAUDE.md` imports it. †Confirm the Zoomies bot handles the block's new location.
6. **Trim the AI-context pack (H2).** Update the excludes through the Zoomies setup flow. †Depends on step 2 and Zoomies support.
7. **CI tightening (H8).** Merge the duplicate test run into one coverage run, cache `govulncheck`, and add `staticcheck` with `-checks` limited at first. Fix the first batch of findings in the same PR or suppress each with a reason.
8. **Test and source file renames (H5).** Pure moves, with the `-v` test list diffed before and after. Do not mix in other changes.
9. **Drop unneeded JS exports (N3), import grouping (N6).** Run `npm --prefix test run check` and the browser suite.
10. **Opportunistic, with feature work only:** split long Go functions and large CSS files (N5), and revisit package layout (H6) only if a stable boundary emerges. If that happens, record it as an ADR.
