# Contributing

Jiggered is a Go HTTP server with SQLite and an embedded, plain JavaScript
frontend. There is no frontend build step. Start with a small change in the
existing module responsible for the behavior.

## Tools and setup

Install Go **1.27.1** (the version in `go.mod`), Node **22.13+ or 24+**, npm,
and a C compiler for Go's race detector. Production builds use pure Go and do
not need a C compiler. Docker is optional; Compose must support the optional
`env_file` syntax (2.24+).

```sh
git clone https://github.com/jnnngs/jiggered.git
cd jiggered
npm ci --prefix test
npm --prefix test run browser:install
```

On Linux, Playwright may also need system libraries. Install them with
`test/node_modules/.bin/playwright install --with-deps chromium`.
The locked npm packages are development tools; they are neither served to users
nor installed in the production container. Commit `test/package-lock.json`
when changing `test/package.json`. Dependabot checks both Go and npm dependencies.

## Run locally

Start the server in terminal 1:

```sh
mkdir -p .local
APP_DB=./.local/jiggered.db APP_SECURE_COOKIE=false go run .
```

In terminal 2, use the **same database path** to create an administrator:

```sh
APP_DB=./.local/jiggered.db go run . user add developer --admin
```

Open <http://localhost:8080/login>, sign in with the printed temporary password,
and choose a new password. The server starts without accounts; creating the
first account is a separate step. No `.env` file is required for `go run`.
`APP_SECURE_COOKIE=false` seeds a new database for local HTTP. For an existing
local database, use `APP_DB=./.local/jiggered.db go run . settings set secure_cookie false`.
Use secure cookies behind HTTPS for deployment; see [README.md](README.md).

`go run . help` lists CLI commands. Configuration and accounts live in the
database; changing seed environment variables does not override saved settings.
Use a disposable database for development and keep real health data and backup
archives outside the checkout.

## Find the right file

| Area                                                | Files                                                                                 |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Startup, routes, static assets and security headers | `main.go`                                                                             |
| Database opening and append-only schema migrations  | `db.go`                                                                               |
| Login, accounts, sessions and administrator actions | `auth.go`, `users.go`, `account.go`, `admin.go`                                       |
| Enrollment, recovery and two-factor authentication  | `security_accounts.go`, `totp.go`, `internal/qr/`                                     |
| Personal documents, validation and restores         | `docs.go`, `validate.go`, `restore.go`                                                |
| Instance settings and shared defaults               | `settings.go`, `defaults.go`                                                          |
| CLI and local backup archives                       | `cli.go`, `backup.go`, `backup_archive.go`                                            |
| Remote backups and email                            | `remote_services.go`, `remote_s3.go`, `notifications.go`, `branded_email.go`          |
| Frontend boot and tab selection                     | `web/app.js`                                                                          |
| Data rules, queued operations and device storage    | `web/model.js`, `web/sync.js`, `web/device.js`                                        |
| Today, Episode, History, Account and Admin views    | `web/today.js`, `web/episodes.js`, `web/history.js`, `web/account.js`, `web/admin.js` |
| Shared editors, picking, help and escaped HTML      | `web/editor.js`, `web/picker.js`, `web/help.js`, `web/tooltips.js`, `web/util.js`     |
| Shared styling and dashboard/public page styling    | `web/style.css`, `web/dashboard.css`, `web/presence.css`                              |
| Server, frontend logic and browser tests            | `*_test.go`, `test/*.test.mjs`, `test/browser*.cjs`                                   |
| Browser lifecycle and suite runner                  | `test/support/`                                                                       |
| Image, local container deployment and CI            | `Dockerfile`, `compose.yaml`, `.github/workflows/image.yml`                           |

Keep Go files in the current application package unless a reusable boundary
justifies a package (as the QR encoder does). Put view-specific frontend code
beside its existing view. Do not add a second implementation of shared rules.

## Make and check a change

For a first change, correct a help sentence in `web/help.js`, format it, and
check the relevant view in a local browser. Use this same sequence for code:

```sh
gofmt -w path/to/changed.go        # for Go changes
npm --prefix test run format      # frontend, tooling and current contributor docs
npm --prefix test run check       # formatter, ESLint, frontend logic tests
go vet ./...
CGO_ENABLED=0 go build ./...
go test -race ./...
npm --prefix test run browser
```

The initial Go build can take several minutes while compiling SQLite. Browser
tests use disposable databases and local credentials; no S3 or external SMTP
account is needed. CI runs these checks on pull requests before building the image.
Do not commit build output, browser artifacts or database files.

The browser runner compiles once, then runs all shared scenarios:

| Script                          | Coverage                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `test/browser-view-state.cjs`   | Calm History, shared exports, refresh restoration, photos and regions (in-memory API fixture)                   |
| `test/browser-energy-theme.cjs` | Energy language, previews, saving, cross-device and responsive themes (in-memory API fixture)                   |
| `test/browser-planner.cjs`      | Seven-day planning, repeat activities, actual cost correction, History comparisons, refresh and mobile overflow |
| `test/browser-today.cjs`        | Activity picker, logging, adjustments and Undo                                                                  |
| `test/browser-history.cjs`      | Large-account History, search, filters and mobile calendar                                                      |
| `test/browser-mobile.cjs`       | Phone-width Account editors and History navigation                                                              |
| `test/browser-security.cjs`     | Password confirmation, revocation and reader-tab cleanup                                                        |
| `test/browser-accounts.cjs`     | Local SMTP relay, registration, recovery, 2FA and mobile layout                                                 |
| `test/browser-admin.cjs`        | Admin navigation, layout and encrypted manual backups                                                           |
| `test/browser.cjs`              | Full desktop/touch walkthrough, offline sync and recovery                                                       |

The public pages have a separate browser check for JavaScript-disabled rendering,
metadata, links, signup availability and mobile layouts. CI reuses the same fixture
binary for it:

```sh
node test/browser-public.cjs
```

Run one scenario with `node test/browser-today.cjs`; it compiles its own temporary
binary. Both entry points share readiness checks, diagnostics and cleanup. The energy-theme
and view-state scenarios use in-memory API fixtures and share browser cleanup without starting
a server.
Optional environment variables:

- `GO_BINARY`: Go executable to use for the fixture build.
- `JIGGERED_TEST_BINARY`: existing binary, absolute or relative to the repository.
- `JIGGERED_BROWSER_PATH`: a preinstalled Chromium executable.
- `JIGGERED_BROWSER_ARGS`: JSON array of Chromium launch arguments.
- `JIGGERED_TEST_PORT`: fixed port; otherwise the harness chooses a free local port.
  Existing scenario-specific port overrides remain supported.
- `JIGGERED_SCREENSHOT_DIR`: optional review screenshots.
- `JIGGERED_ARTIFACT_DIR`: server logs and screenshots on scenario failure.
  CI uploads these diagnostics when a scenario fails. They use synthetic data.

## Rules worth knowing before editing

- Append schema changes to `migrations` in `db.go`; never rewrite a shipped
  migration or create tables during server initialization. Test an upgrade,
  not only a fresh database.
- SQLite uses one connection. Release rows or commit/rollback a transaction
  before querying through `s.db` on the same goroutine. Audit after commit.
- Document/session access uses the authenticated person, never a supplied user
  ID. Admin mutations must revalidate the actor and password. Admin APIs expose
  metadata; whole-database backups are the documented exception. Preserve the
  privacy explanation in the README.
- Add new page scripts/styles to `versionedFiles` in `main.go` and app assets to
  `SHELL` in `web/sw.js`. Only assets needed before login belong in
  `publicAssets`; use the existing asset tests to check these lists. Never cache
  API responses in the service worker.
- Use the escaping `html` tag for user text. Keep strict CSP and same-origin
  writes. The sync engine queues operations and replays conflicts; preserve
  the distinction between a saved device copy and server acknowledgement.
- Report database failures with operation context; do not log credentials,
  document bodies or SQL arguments. A failed history write must not retry an
  already completed remote backup.

## Review and project policy

Make each PR explain the concrete behavior changed and the checks run. Keep
formatting-only changes separate from behavior changes when practical. Match
the existing short, imperative commit messages; no special branch naming is
required. This repository currently has no application LICENSE, CODEOWNERS,
issue/PR templates or CHANGELOG. Licensing and ownership require a maintainer
policy decision; this guide does not grant new permissions. Font licenses are
in `web/fonts/LICENSE.txt`. Tagged releases and the image tag policy are
documented in the README. Historical UI findings in `UI_AUDIT.md` are not the
current product specification.
