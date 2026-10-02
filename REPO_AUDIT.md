# Repository audit

Audited **2026-10-02**, repository `jnnngs/jiggered`, `main` at **`af2c086ee753c02a870d5970f577fb1e5ef79de7`**. The findings below describe the original pre-cleanup snapshot. At audit time no application, configuration, dependency or test files were changed; the subsequent authorized implementation is recorded separately below.

## Summary

| Measure | Result |
| --- | --- |
| Size | 132 tracked files; 1,581,786 bytes (1.51 MiB); 25,999 text lines; 63 files at the root |
| Stack | Go 1.27.1, standard-library HTTP server, pure-Go SQLite, embedded vanilla JavaScript ES modules, HTML/CSS, Docker/GHCR |
| Source/test footprint | 53 Go files (23 production, 30 tests); 24 frontend JavaScript modules; 3 stylesheets; 7 Node logic-test files and 7 browser scripts |
| Dependencies | 2 direct Go modules, 9 declared indirect modules; Playwright 1.56.1 installed separately for tests; no application npm dependencies |
| Formatting/lint/type checks | `gofmt`, `go vet`, Go compilation pass locally and in CI. No JavaScript/CSS formatter or linter; no JavaScript static type checking |
| Tests | Both Go packages pass `go test -race ./...`; 100 frontend assertions pass. Six original browser scripts pass locally; History fails during fixture seeding, then passes in an external diagnostic copy that consumes response bodies |
| Dependency integrity | `go mod verify` passes; `go mod tidy -diff` produces no changes. Both direct Go versions are current according to `go list -m -u` |
| CI | Audited commit's [run 36999447553](https://github.com/jnnngs/jiggered/actions/runs/36999447553) passes all three jobs, including all seven original browser scripts and multi-platform image publishing |
| History | 115 commits across fetched refs; 1.14 MiB Git pack; one release/tag (`v1.0`); largest historical blob 76,888 bytes |

**Verdict:** The deployment architecture is compact, the dependencies are restrained, and the tests cover meaningful data-loss and account scenarios. The maintenance bottlenecks are compressed frontend code, repeated browser infrastructure, and documentation that has fallen behind two days of very rapid development. Fix the backup ignore gap first, then make existing behavior easier to read and verify. Keep the current Go/embedded-frontend architecture.

## Implementation status — 2026-10-02

The ten selected priorities are implemented in the working tree:

| Priority | Change |
| --- | --- |
| Backup hygiene | Git/Docker exclude private archives, local configuration and temporary output. README writes backups outside the checkout. |
| History fixture stability | Every seeded response body is consumed; unsuccessful seed requests identify their document and status. |
| API error contract | Fetch and response-body failures return the same transport-error shape; regression tests cover interrupted bodies and server errors. |
| Frontend readability | Prettier formats frontend and test sources; embedded template text is preserved. ESLint checks undefined/unused names. CI enforces both. |
| Browser lifecycle | All eight scenarios use one shared readiness/cleanup harness; the suite and CI compile once. Failure logs/screenshots are retained by CI. |
| Contributor setup | CONTRIBUTING.md covers prerequisites, first account creation, code map, checks, all scenarios and asset/migration rules. README and CLAUDE.md point to it. |
| Service database failures | Background persistence failures log run/operation context without SQL arguments; scheduler reads and the admin history query check errors. |
| Schema authority | Startup no longer duplicates the table DDL; the shipped migration remains unchanged. Regression test proves initialization does not create schema. |
| Documentation accuracy | UI_AUDIT.md has a historical banner and disposition table; S3 and account-privacy comments describe the current code. |
| Reproducible tooling | Test-only npm dependencies and their transitive tree are locked; local scripts, npm caching and Dependabot use the manifest. |

Validated locally: clean locked npm installation; frontend formatting and ESLint;
**108 passing Node tests** (including readiness/failure-cleanup regression tests);
`gofmt`, `go vet`, **`go test -race ./...`**, and a pure-Go application build;
**all eight browser scenarios**, including History's 600 days/900 episodes.
An AST comparison confirms all other production JavaScript changes are formatting
only, apart from the API fix and confirmed-unused import/binding cleanup.
The new workflow has not yet executed on GitHub; image publishing and external
S3/SMTP integration were not part of this local implementation verification.
The branch also incorporates the subsequently merged Today activity pills and
optional spoon theory theme, including its in-memory browser fixture.
The original findings and proposed PR boundaries below remain audit evidence.

## Scope and verification

Reviewed the complete tracked inventory, source and test modules, HTML/CSS, assets and font licensing, manifests/checksums, dotfiles, Compose/Docker configuration, the only workflow, Dependabot configuration, documentation, all fetched branches, tags, releases and recent history. Used tracked-text searches, import/reference checks, an ES-module import graph, file/function-size inspection, `git log`, `git blame`, `git branch -a`, merged-branch checks and historical blob sizes. No JavaScript import cycle was found; Go has only the root application package and `internal/qr`.

The workspace initially had no checkout. Clone and npm installation first failed under the executor's network sandbox; enabling network access for those commands resolved that. The preinstalled command named `go` was not the Go compiler. Installed the repository's Go 1.27.1 toolchain and test-only Playwright/Chromium under `/tmp`, with module/build/npm/browser caches there. These initial failures are environment limitations, **not repository defects**. The resulting checkout matches the audited SHA.

Executed:

```sh
gofmt -l .
go vet ./...
CGO_ENABLED=0 go build -o /tmp/jiggered-audit-app .
go test -race ./...
go mod verify
go mod tidy -diff
go list -m -u golang.org/x/crypto modernc.org/sqlite
node --test --test-isolation=none 'test/*.test.mjs'
```

The local Node version was 24.19.0; CI uses Node 22 and reports all 100 assertions passing. Local process-isolated execution reported seven file-level successes, so the assertions were also run with isolation disabled to verify all 100 explicitly. All seven browser scripts were exercised against the built application and disposable databases. History's original failure and its narrowly changed diagnostic copy are distinguished below. Docker build/Compose were inspected and their successful CI image build verified; a local container build/deployment was not performed. No claims about production hosting or external SMTP/S3 access are based on this audit.

### New contributor walkthrough

| Step | Observed result | Documentation gap / guess / maintainer question |
| --- | --- | --- |
| Acquire source | Cloned successfully; clean checkout at the audited commit | README assumes the checkout and `compose.yaml` already exist. Repository is private; public-source release is explicitly planned. A contributor needs access and a short clone/working-directory instruction |
| Install | Go modules and Playwright 1.56.1 install successfully; Chromium downloads successfully | Go 1.27.1, Node 22+ and a C compiler for race tests are documented. Browser commands are spread across README, `CLAUDE.md` and CI; no complete local check command or locked test dependency install |
| Configure | No mandatory `.env`; `APP_DB` selects a disposable DB; cookie/proxy settings are persisted in SQLite | `.env.example` accurately describes optional runtime variables and legacy seeds. Existing databases ignore seed changes; contributor guide should prominently explain this and consistently use the same `APP_DB` in every terminal |
| Start | Built server starts with no accounts and prints the first-admin command; `/healthz` and CLI `healthcheck` succeed | Start the server before `user add`: the CLI correctly refuses a nonexistent database. `CLAUDE.md` explains the two-terminal order; README's development section does not provide that complete fresh-account workflow |
| Create account | `user add newcomer --admin`, `settings set secure_cookie false`, and `user list` work after server start | Temporary password/change-on-first-login is accurate. Put this current workflow in the human contributor guide rather than relying on legacy password seeds |
| Run checks | Formatting, vet, build, race tests, module checks and 100 frontend assertions pass | README's browser section says six scripts, omits `browser-admin.cjs`, and its command block runs only four. History fails locally while seeding; see H2 |
| Exercise product | Today, mobile Account/History, account enrollment/recovery/2FA, admin navigation, and full offline/restore walkthroughs pass | Browser fixtures make changes only to disposable data. Real SMTP/S3 interoperability beyond local tests would need operator-provided staging endpoints |
| Locate a small change | Traced a Today copy change to `web/today.js`/`web/index.html`, styling to `style.css` plus `dashboard.css`, and behavior checks to `test/browser-today.cjs` | No product edit was made, honoring the audit-only instruction. New top-level assets also require `versionedFiles`, possibly `publicAssets`, and the service-worker shell. These rules live mostly in `CLAUDE.md`; a contributor needs a human-readable checklist |
| Submit/release | CI runs on PRs; `main` publishes `dev`; release tags publish `latest` | No CONTRIBUTING, PR/issue templates or CODEOWNERS. No checked-in CHANGELOG, but a real GitHub `v1.0` release has notes. License and public contribution policy remain owner decisions |

## 1. Critical

### C1. Documented backups are eligible for commit and Docker build upload

- **Pass:** Maintainer review / New contributor walkthrough
- **Where:** `.gitignore`, `.dockerignore`, `README.md:350`, `cli.go:153`, `backup_archive.go:31`.
- **Problem:** README's `backup - > jiggered-backup.zip` writes a full-account backup into the current checkout. Git ignores raw `.db` files and `/backups/`, but neither root `.zip` nor `.zip.enc` backups. Docker ignores neither these archives nor the `backups/` directory. `git check-ignore` confirms that `jiggered-backup.zip`, `protected.zip.enc` and `.tmp-archive-example.zip` are eligible for tracking. ZIP contents do not match the raw-DB ignore rule. `COPY . .` sends allowed files to the builder, so private backups can enter commits, remote build context and build caches. Root archives are not embedded in the final binary; the demonstrated exposure is Git/build context. `CLAUDE.md` incorrectly says the backups directory is excluded from Docker context.
- **Fix:** Add documented backup archive patterns to both ignore files, including `jiggered-backup*.zip*`, `protected.zip.enc`, `.tmp-archive-*`, and `/backups/` in `.dockerignore`; decide whether this project can simply exclude `*.zip` and `*.zip.enc` globally. Change backup examples to an explicitly private directory outside the checkout. Check already tracked files before adding ignores; ignoring does not untrack existing files.
- **Risk:** Safe and mechanical. No backup archives are tracked at this SHA. Check whether future ZIP fixtures need explicit allow-list exceptions; do not delete user backups or rewrite history as part of this change.

## 2. High impact

### H1. Frontend source is effectively hand-minified and has no enforced conventions

- **Pass:** Maintainer review
- **Where:** `web/editor.js`, `web/help.js`, `web/history-matrix.js`, `web/security.js`, `web/services.js`, `web/style.css`, `test/browser*.cjs`; `.github/workflows/image.yml`.
- **Problem:** `editor.js` contains a 2,515-character line; `style.css` a 1,798-character line; whole templates, handlers and assertions share single lines. Quote style, spacing and statement layout differ sharply from newer expanded HTML/CSS. This makes diffs harder to inspect, blame less informative and debugging needlessly slow. CI checks Go formatting/vet but has no equivalent frontend check. Two recent commits (`7d9359e`, `e6985db`) exist just to repair Go formatting for CI, demonstrating the value of a local check entry point too.
- **Fix:** Add a pinned formatter for JS/CJS/MJS, HTML, CSS, JSON and YAML; configure a small ESLint baseline for undefined names and unused bindings, including browser/Node/service-worker globals. Apply formatting in a dedicated behavior-free PR and run check-only formatting/lint commands in CI. Add `.editorconfig`. Establish a baseline before enabling rules that require logic changes.
- **Risk:** Mostly mechanical, but review template whitespace, ASI-sensitive statements, CSS order and generated-looking HTML carefully. Run existing logic/browser tests after formatting. Do not convert the frontend to TypeScript or add an application bundler for this cleanup.

### H2. History's fixture seeding can exhaust Chromium resources

- **Pass:** New contributor walkthrough / Maintainer review
- **Where:** `test/browser-history.cjs:44–60`.
- **Problem:** The script seeds 600 days and 900 episodes through batches of 25 fetches, reads response status, and leaves bodies unconsumed. The unmodified script failed twice locally during seeding; request-failure diagnostics identified `net::ERR_INSUFFICIENT_RESOURCES`, presented to the user as a generic `TypeError: Failed to fetch`. The audited GitHub CI run passes, so this is a reproducible local portability/flakiness issue, not evidence that current CI is universally broken.
- **Fix:** Consume each seed response body before advancing the batch, retaining its status for assertions. A `/tmp` diagnostic copy changing only that map callback to `async`, awaiting `response.arrayBuffer()`, then returning the response **passes the entire History script**. Keep concurrency bounded; include the failed document ID/status in seed diagnostics.
- **Risk:** Low. Only test setup changes; preserve all 1,500 records and assertions. Verify the original script after applying the fix under Node 22/CI and local Chromium.

### H3. Seven browser scripts duplicate lifecycle management and cleanup defects

- **Pass:** Maintainer review / New contributor walkthrough
- **Where:** `test/browser.cjs`, `test/browser-{today,history,mobile,security,accounts,admin}.cjs`; workflow browser job.
- **Problem:** Every script repeats temporary directories, optional Go compilation, spawning the server, polling health, browser launch, sign-in and teardown. Readiness loops continue after their deadline instead of explaining startup failure. Port variables and support for `JIGGERED_BROWSER_ARGS` differ. `browser-accounts.cjs` and `browser-admin.cjs` never remove their temporary directories; Accounts lacks a shared `finally` cleanup path, and Admin discards server output. Initial compile failure also occurs before cleanup in several scripts. CI rebuilds the same binary in all seven scripts unless a prebuilt path is supplied.
- **Fix:** Add `test/support/browser.cjs` owning startup, health timeout/error diagnostics, log capture, browser launch options and idempotent cleanup. Retain seven independent scenario scripts. Use ephemeral ports or documented per-scenario overrides. Build once in the browser CI job and set the already-supported `JIGGERED_TEST_BINARY` for all scripts. Always close browser, SMTP relay, server and temporary directory on success and failure.
- **Risk:** Needs care with process exit/signal handling, the Accounts SMTP relay and scripts that reopen browsers. This consolidates actual duplicated infrastructure; do not combine all scenarios into one large test.

### H4. Shared API helper violates its documented error contract

- **Pass:** Maintainer review
- **Where:** `web/util.js:61–77`; callers in `web/security.js`, `web/account.js`, `web/services.js`.
- **Problem:** `api()` promises it “never throws” and callers expect `{ok,status,data,error}`. Its `try/catch` covers only `fetch`; `await r.text()` is outside it. A connection interrupted after headers arrive rejects the helper instead of yielding an actionable message. Reproduced with a successful fake response whose `text()` throws `TypeError('terminated body')`: `api('GET', '/api/me/security')` rejects. This undermines the common error-handling convention and leaves async view handlers without their expected feedback.
- **Fix:** Include response-body consumption in the transport error boundary. Return the documented failure shape on a body-read timeout/interruption, preserve deliberate 401 handling, and add a regression for a body-read failure alongside existing utility tests. Define the helper's transport/protocol failure behavior in one place.
- **Risk:** Small runtime change. Check identity-loss handling and malformed/non-JSON responses; preserve the sync engine's separate conflict/retry semantics rather than replacing it with this UI helper.

### H5. Database schema has two live definitions for the same table

- **Pass:** Maintainer review
- **Where:** `security_accounts.go:23–32`, `remote_services.go:80–85`, `db.go:63–65`, `main.go:146–149`.
- **Problem:** Migration 5 creates `remote_backup_runs`, and `initServices()` separately executes `CREATE TABLE IF NOT EXISTS` with the same columns whenever a server is constructed. This introduces schema mutation outside the append-only migration/version/snapshot discipline. A future column change has two apparent homes, and startup can silently recreate a missing table without explaining why schema version 5 lacked it. Both paths are referenced and live; neither whole function is dead.
- **Fix:** Make migrations the sole schema authority. Preserve shipped migration 5 unchanged. Once all constructor callers are proven to receive migrated databases, remove only the redundant startup DDL, retaining service-settings initialization. New schema changes must append migrations. Add coverage for the constructor prerequisite and legacy upgrade behavior.
- **Risk:** Needs care. Reviewed constructor references in main and tests currently obtain databases through `openDB`; confirm that contract before removing the statement. Do not edit or remove a shipped migration or drop any table/data.

### H6. Current contributor instructions are scattered and the architecture index is incomplete

- **Pass:** New contributor walkthrough
- **Where:** `README.md:499–535`, `CLAUDE.md:37–69`, `.env.example`, workflow.
- **Problem:** The useful human setup guide starts after extensive product/operator documentation, while the directory map and asset/SQLite/migration rules live in an agent-specific file. README says six browser scripts although CI runs seven; the runnable block lists four. The layout omits new backup-archive, email, security, TOTP and QR boundaries. Someone changing enrollment or encrypted backups must infer where the feature lives and which checks run. Compose's optional structured `env_file` also requires a modern Compose version without a documented minimum.
- **Fix:** Add a short `CONTRIBUTING.md` linked near the top of README with clone/cwd instructions, Go/Node/C-toolchain/Compose requirements, the fresh-server/two-terminal account setup using a consistent local `APP_DB`, all check commands and all seven browser scripts. Include an up-to-date module map and the new-asset/migration rules. Keep operator documentation in README; have `CLAUDE.md` link to the shared human instructions instead of maintaining a second full command/map reference.
- **Risk:** Safe documentation change. Verify commands verbatim in a fresh checkout; CLI account creation requires the server to have initialized the database first. Do not imply that legacy seeds change an existing DB.

### H7. Historical audit and copied comments contradict the live project

- **Pass:** Maintainer review / New contributor walkthrough
- **Where:** `UI_AUDIT.md:8–12`, `remote_s3.go:23–28`, `main.go:1–4`, `CLAUDE.md`.
- **Problem:** The dated UI audit states there is no landing page or signup; both now exist and are tested. It also contains recommendations already implemented without a clear disposition list. S3 commentary refers to nonexistent `internal/backend`, a Docker SDK and a “controller”, confusing readers about actual module boundaries. The main file's introductory claim that admins never see logs is broader than README's accurate explanation of password-reset and whole-database-backup powers. These are concrete stale/copied statements, not a reason to discard every historical document.
- **Fix:** Label the UI audit prominently as a historical snapshot and add a concise resolved/superseded/open disposition list linked to current guidance. Rewrite the S3 rationale around Jiggered's actual four-operation client, removing references to another codebase. Align the main introduction and architecture guidance with current accounts, backups, registration and privacy behavior.
- **Risk:** Safe documentation/comment changes. Preserve the audit's original date/commit and evidence; do not delete it merely because it is old. Confirm product/security wording with the current README and tests.

### H8. New service paths ignore database persistence errors

- **Pass:** Maintainer review
- **Where:** `remote_services.go:301`, `remote_services.go:645–661`, `remote_services.go:691`.
- **Problem:** Backup completion, email outcome, retention-history cleanup, interrupted-run marking and scheduler-failure insertion discard `ExecContext` errors. The Admin status query also discards its `Scan` error. Most request code consistently uses `serverError`; this subsystem can report stale operational status with no diagnostic explaining the failed persistence. That makes an already multi-responsibility 696-line file especially hard to troubleshoot.
- **Fix:** Check each state-write/query result. Return a request error for failed Admin status reads; log contextual background failures with run ID and operation, without credentials. Clearly separate completed S3 transfer from failure to persist its status. Extract narrowly named status-persistence helpers if that makes the repeated checks readable.
- **Risk:** Needs care. Do not retry the whole remote backup just because recording its result failed, and do not turn a successful transfer into a claim that no object exists. Exercise failure handling with a closed/unavailable DB.

## 3. Nice to have

### N1. Remove confirmed runtime-unused bindings

- **Pass:** Maintainer review
- **Where:** `web/account.js:3`, `web/today.js:6`, `web/picker.js:66`, `test/picker.test.mjs:41`.
- **Problem:** Account imports `appendHTML` without using it; Today imports `emptyDay` without using it. `groupNames` has no production caller and only one assertion testing the helper itself. It adds a second grouping-related API beside the live `groupItems` helper.
- **Fix:** Remove the two unused imports, leaving the underlying functions that have real callers. Remove `groupNames` and its single self-test assertion while retaining the surrounding `groupItems` test.
- **Risk:** Safe internal cleanup. Confirmed by whole tracked-text searches, named/star imports, dynamic-import inspection and string/config/CI searches. The sole test reference is explicitly identified, so this is runtime-unused rather than wholly unreferenced. Do not remove `appendHTML` or `emptyDay` themselves: Admin and the model use them.

### N2. Delete unreferenced screenshots of the old UI

- **Pass:** Maintainer review
- **Where:** `n1.png`, `n2.png`.
- **Problem:** These root files total 124,336 bytes and show the old mobile layout. They have opaque names, no caption and no link from docs/tests/config/scripts. History ties them to `c77582e` on 2026-10-01. They make the root look like a working scratch directory.
- **Fix:** Delete both tracked screenshots. If a maintainer wants them as historical evidence, move them to a named, captioned documentation location instead.
- **Risk:** Mechanical. Viewed both files and searched all tracked text, asset references, dynamic/string paths, embed boundaries and CI/scripts: no consumer found. They sit outside `web/`, so Go does not embed them. Docker copies them into the builder without consuming them. Do not delete `assets/brand/` or fonts: brand sources are documented, README uses the logo, and font assets are referenced.

### N3. Extend routine local-file exclusions

- **Pass:** Maintainer review
- **Where:** `.gitignore`, `.dockerignore`.
- **Problem:** Only exact `.env` is excluded; `.env.local` is eligible for commit/context upload. `.DS_Store`, editor swap files and local artifacts are also uncovered. There is no evidence these files are currently committed. Docker also sends a locally built root `jiggered` binary despite compiling its own output.
- **Fix:** Ignore `.env.*` with an explicit exception for `.env.example`; add OS/editor temporary files and the locally built binary to Docker exclusions. Keep archive/backups exclusions from C1 consistent between Git and Docker.
- **Risk:** Safe. Check future fixture/config exceptions before broad patterns; do not remove tracked templates or legitimate static assets.

### N4. Guard duplicated factory defaults and cross-language limits against drift

- **Pass:** Maintainer review
- **Where:** `web/model.js` (`DEFAULTS`, `LIMITS`), `web/defaults.json`, `defaults.go`, `validate.go`, defaults tests.
- **Problem:** The complete factory lists/settings are hand-maintained in JavaScript and JSON; server validation also mirrors supported locales and limits. A direct deep comparison during this audit shows factory defaults currently agree. Existing tests validate behavior/individual boundaries, but do not compare the entire frontend factory object with the JSON the server reads.
- **Fix:** Add an exact Node parity assertion for `DEFAULTS` versus `web/defaults.json`, and focused server/frontend contract checks for locales/limits when changing them. Document the paired edit requirement. Consider generating one representation only if defaults churn later justifies it.
- **Risk:** Low; adds a useful contract check. Preserve synchronous offline startup and existing defaults compatibility. Do not delete either live representation without replacing its consumers.

### N5. Make test-only dependency installation reproducible

- **Pass:** Maintainer review / New contributor walkthrough
- **Where:** README browser install instructions, workflow's Playwright install, missing npm test manifest/lockfile.
- **Problem:** Playwright's direct version is pinned, but installation deliberately disables a lockfile and local execution has no declared scripts/Node engine. The setup depends on manually matching README/CI commands and ambient module resolution. The application itself correctly needs no npm install.
- **Fix:** Add a test-only `test/package.json` and committed lockfile, pin Playwright and any formatter/linter tools, declare the supported Node version, and document `npm ci --prefix test` plus one command running the seven browser scripts. Use those commands in CI; keep frontend serving build-free. Add test-dependency updates to Dependabot if using this manifest.
- **Risk:** Low tooling change. Confirm CJS module resolution and Chromium's OS dependencies. This is not evidence that currently installed Go dependencies are unused, deprecated or outdated.

### N6. Clarify stylesheet ownership before adding more visual overrides

- **Pass:** Maintainer review / New contributor walkthrough
- **Where:** `web/style.css`, `web/dashboard.css`, `web/presence.css`, HTML stylesheet links.
- **Problem:** The app combines a 51 KiB base stylesheet with a 1,040-line dashboard layer; public pages combine the base with a 1,242-line presence layer. This is live, intentional styling, but component/base/theme ownership is implicit and repeated palettes make the right edit location harder to find. The source has accumulated chronological “additions” sections.
- **Fix:** Document base/shared, signed-in and public-page ownership in the contributor guide; put future rules in the responsible layer. If consolidating a specific component later, compare computed styles across signed-in/public pages, light/dark, mobile/desktop, print, reduced motion and forced colours first.
- **Risk:** Documentation is safe. Selector/property deletion or stylesheet consolidation **Needs confirmation** through cascade/runtime checks; file size or repeated selector names alone do not establish dead CSS. No blanket stylesheet deletion is recommended.

### N7. Add targeted CI diagnostics and avoid repeated expensive setup

- **Pass:** Maintainer review
- **Where:** `.github/workflows/image.yml` browser job.
- **Problem:** Browser failures have no uploaded screenshots/traces/logs, and Chromium downloads/system-package setup repeat each run. Build caching already exists for Docker and setup-go supplies Go caching; the biggest avoidable application compile duplication is addressed in H3.
- **Fix:** Upload failure-only Playwright traces/screenshots and captured server logs from the shared harness. Measure download time, then cache browser binaries using OS/Playwright version keys if worthwhile; still install required system libraries. Keep PR builds and the existing failure gates.
- **Risk:** Low. Artifacts must use disposable fixtures and avoid captured credentials; cache misses must remain functional. No need to add a second CI workflow or duplicate existing Go/image caches.

### N8. Define public contribution and branch-lifecycle policy when opening the project

- **Pass:** New contributor walkthrough / Maintainer review
- **Where:** Missing root LICENSE, CONTRIBUTING, CODEOWNERS, issue/PR templates; repository branches/releases; `web/landing.html` planned-source wording.
- **Problem:** A private project with a planned public release has no application license or public contribution/review policy yet. The only LICENSE is for fonts. `codex/admin-navigation` and `copilot/merge-all-prs` remain as merged remote branches; the active energy-activity branch is unmerged. These refs are hours old, so they are not evidence of an abandoned repository. Branch metadata reports main unprotected, but effective ruleset/merge policy was not established by this audit.
- **Fix:** Before public release, have the owner choose an application license and add it without altering third-party font notices. Add concise issue/PR templates and owner/review guidance where useful. Confirm required-check/ruleset behavior, and enable automatic deletion of merged feature branches if that matches the team's workflow. Link GitHub release notes from the contributor guide; a duplicate CHANGELOG is optional.
- **Risk:** Licensing/review-policy changes need owner decisions. Remote branch deletion **Needs confirmation** even for merged refs; check active PRs and workflows first. Do not delete the unmerged energy-activity branch or invent a release/changelog gap: `v1.0` and its release notes exist.

## Ordered cleanup plan: small, independently mergeable PRs

All PRs below are proposed, not implemented. Start with mechanical changes; keep behavior changes and broad formatting separate.

| Order | PR | Scope | Acceptance evidence |
| --- | --- | --- | --- |
| 1 | Protect backup/local artifacts | C1 + N3: Git/Docker ignore rules and private backup output examples | `git check-ignore` matrix covers documented outputs/templates; Docker context excludes backups; no source/runtime changes |
| 2 | Repair current and historical guidance | H6 + H7 + N6: CONTRIBUTING, complete browser list/module map, truthful comments, historical audit banner/status | Run documented commands from a clean checkout; check all listed paths and links; leave historical evidence intact |
| 3 | Remove confirmed dead weight | N1 + N2: two unused imports, one runtime-unused helper/assertion, two unlinked screenshots | Repeat reference searches; 100-test baseline changes only by the removed redundant assertion; existing browser scenarios still pass |
| 4 | Fix History seed resource use | H2: consume seed responses and improve per-record diagnostics | Unmodified repository script passes locally and in CI with all 1,500 records; preserve History assertions |
| 5 | Declare shared test tooling | N5: test-only manifest/lockfile, Node version, documented npm scripts | `npm ci --prefix test`; all existing logic/browser scripts run without global packages; no frontend bundle/build added |
| 6 | Format frontend and enforce the baseline | H1: formatter/editor config, narrowly scoped lint, check-only CI | Separate formatting from logic changes; review template whitespace; formatting/lint and existing tests pass |
| 7 | Consolidate browser lifecycle | H3 + N7: common harness, one CI binary build, reliable cleanup/readiness, failure artifacts | All seven scenarios pass; forced startup/assertion failures terminate children, clean temp files and preserve useful diagnostics |
| 8 | Repair UI request-error contract | H4 only: catch interrupted bodies and retain documented error shape | Body-read regression, existing utility tests and account/admin/browser flows pass |
| 9 | Give schema one authority | H5 only: remove redundant startup DDL after checking migrated-DB precondition | Fresh/legacy upgrade, CLI, restore and server tests pass; shipped migration 5 unchanged |
| 10 | Report service-state persistence failures | H8 only: checked DB operations and contextual background diagnostics | Closed/unavailable-DB cases observable; successful S3 transfer is not repeated solely to repair logging/status |
| 11 | Pin factory-default contracts | N4: full-default parity and focused shared-limit contracts | Current representations match; deliberate drift makes the check fail; no defaults behavior changes |
| Later, owner-led | Public project policy | N8: license, ownership, templates, merge policy and branch lifecycle | Owner decisions recorded; active branches preserved; existing release notes linked |

## Boundaries and non-findings

- The flat root Go package is appropriate for this single binary; `internal/qr` has a clear purpose. No catch-all production helpers directory, parallel application implementation, abandoned route tree, or duplicate package manager was found. `helpers_test.go` is purposeful shared test setup.
- Both direct Go dependencies have production imports; nine declared indirect modules are part of their graph. `go.sum` has additional transitive/test checksums, and `tidy -diff` confirms they should not be deleted merely because they are absent from `go.mod`.
- No tracked `.env`, DB, archive backup, local service key, compiled application binary, backup-copy filename or text TODO/FIXME/HACK/XXX backlog was found. There are therefore no stale TODO ages to report. The three conditional Go skips relate to platform/corruption fixtures, not abandoned features; Node CI reports no skipped/todo tests.
- CI triggers PRs, fails on formatting/build/test errors, limits package-write permission to the image job, pins actions/images/tools, cancels superseded PR runs and gates publishing on both test jobs. It is not stale or duplicated. Dependabot covers Go, Docker and GitHub Actions.
- History is small and recent, commit subjects are generally informative, and release notes exist. No large-binary purge or history rewrite is justified. Brand-source/runtime SVG duplication is intentional; retain documented editable brand sources.
- Unreferenced screenshots/imports and the self-tested helper are the only concrete deletion candidates above. Broader asset, stylesheet, compatibility-seed, migration or branch deletion requires the specific confirmation noted in the corresponding finding.
