# CLAUDE.md

Guidance for Claude Code in this repository. `README.md` is the user-facing
setup guide; this file is the index and the rules.

## What this is

Jiggered ("worn out", Yorkshire) is a small self-hosted tracker for daily
energy check-ins and symptom episodes. One Go binary (module
`github.com/jnnngs/jiggered`, Go 1.26) serves a static ES-module frontend and a
JSON API backed by SQLite. Several people can each have an account, with an
admin to manage them; password login. It ships as one container image on GHCR.

## Commands

```sh
gofmt -l .                       # should print nothing; CI fails if it does
go vet ./...
CGO_ENABLED=0 go build ./...     # what the image builds (pure Go, no cgo)
go test -race ./...              # server tests, about 20s once compiled (-race needs cgo; tests only)
node --test "test/*.test.mjs"    # frontend logic tests; Node 22, no npm install
node test/browser-today.cjs      # real Chromium (needs Playwright, see README); CI also runs test/browser.cjs
```

Measured on a cold module cache: building took about 2m20s (pure-Go SQLite
compiles slowly), so give the first run a generous timeout.

Run locally without HTTPS, then open <http://localhost:8080>:

```sh
APP_DB=./jiggered.db go run .                                   # terminal 1: starts with no accounts, and says so
APP_DB=./jiggered.db go run . user add paul --admin             # terminal 2: prints a temporary password
APP_DB=./jiggered.db go run . settings set secure_cookie false  # plain-http testing only
```

`go run . help` lists every subcommand (`user`, `settings`, `backup`, `restore`,
`healthcheck`, `hash`, `version`). There is no Makefile, no linter config and no
frontend build step.

## Layout

| Path | What it is |
| --- | --- |
| `main.go` | Wiring: config, `server`, `routes()`, security headers, cross-site guard, static files |
| `db.go` | Opening SQLite, the append-only `migrations` list, the pre-upgrade snapshot |
| `auth.go` | Sessions, `requireAuth`/`requireAdmin` (`guard`), login, lockouts, client address |
| `users.go` | Account store, last-admin guard, audit log, pruning |
| `account.go`, `admin.go` | `/api/me/...` (self-service) and `/api/admin/...` (admins only) |
| `docs.go`, `restore.go`, `validate.go` | Personal docs, quotas, legacy import and atomic preview-bound restores; `validateDoc` is the one document rule used by saves, imports and restores |
| `defaults.go` | Validated shared product defaults, authenticated read, admin-only compare-and-swap write |
| `settings.go` | Instance settings stored in the database, and seeding them from old env vars |
| `backup.go`, `cli.go` | Snapshot helpers; the subcommands (`user`, `settings`, `backup`, `restore`, ...) |
| `*_test.go`, `test/*.test.mjs` | Go tests (real server on a temp DB) and Node tests for the frontend logic |
| `web/` | The frontend, hand-written, embedded with `//go:embed web` (below) |
| `assets/brand/` | Logo and mark sources. Not embedded, not served |
| `Dockerfile`, `compose.yaml` | Multi-stage build to distroless nonroot with a `HEALTHCHECK`; read-only compose service, `cap_drop: ALL` |
| `.env.example` | Template for compose's optional `.env` |
| `.github/workflows/image.yml` | gofmt, vet, build, `go test -race`, `node --test`, real-browser tests, then build and push the image |

`web/`: `app.js` boots and owns the tabs; `sync.js` is the sync engine;
`device.js` provides IndexedDB-backed cache/drafts; `editor.js` shares accessible list ordering. `picker.js` is the pure long-list logic (search, favourites by recent use, groups, paging) used by Today and Episodes; lists show none of it until they pass `PICKER.searchFrom` items. Activities carry an optional `g` group; symptoms and triggers stay plain strings. List limit is 200 (`LIMITS` in `model.js`, mirrored in `defaults.go`). `model.js`
holds the data rules (settings, a day's budget, operations, trends, CSV); `util.js`
has `html` and `api()`; `today.js`, `episodes.js`, `history.js`, `account.js` are
the tabs; `admin.js` is mounted only for admins; `sw.js` is the service worker;
`help.js` provides task-focused help and `tooltips.js` handles hover/focus/touch guidance; `fonts/` are self-hosted. `sync.js` and `model.js` touch no DOM, which is why
`test/` can run them.

## How it works

- **Storage** (`db.go`): `users`, `docs(user_id, id, body, rev, size, updated_at)`,
  `sessions(.., user_id, ..)`, `audit_log`, `instance_settings`, `doc_revs(user_id, id, rev)` (the last revision of a
  deleted doc, so recreating it never reuses a revision; a DELETE with `If-Match` of an older revision gets a 409). Docs are opaque
  JSON objects per person; the server does not interpret them, the frontend owns
  their shape. Ids are allow-listed: `d-YYYY-MM-DD`, `e-<digits>`, `settings`.
- **Sync**: the frontend queues *operations* ("add this entry"), shows the server
  copy with them applied, and saves with `If-Match: "<rev>"`. A 409 returns the
  current doc and the operations are replayed on it, so two devices merge. `GET /api/docs` is always the whole account (never a
  page: omitted docs would look deleted) with a weak ETag over each doc's id, revision, size and save time; a client that
  holds the current snapshot sends it and gets 304. `sync.js` forgets the tag whenever anything else changes its copy.
- **Accounts**: created by an admin (temporary password, must be changed before
  anything else works) or by `jiggered user add`. No sign-up page. The last active
  admin can't be demoted, disabled or deleted; nobody can do that to themselves
  through the admin API.
- **Configuration lives in the database.** The environment only says where it is
  (`APP_DB`, `APP_ADDR`). `APP_USERNAME`, `APP_PASSWORD(_HASH)`, `APP_SECURE_COOKIE`,
  `APP_TRUST_PROXY`, `APP_PROXY_HOPS` are one-time seeds, read only to fill in
  what the database lacks; the database wins after that. The tables in
  `README.md` are the reference: keep them and `.env.example` in step with
  `loadConfig` and `settings.go`.
- **Routes use Go 1.22+ method patterns** on the stdlib `http.ServeMux`. No router
  framework.

## Conventions and gotchas

- **A new public static file needs a route.** Only `publicAssets` (and the
  `/fonts/` prefix) in `routes()` are served without login; everything else under
  `web/` sits behind `requireAuth`. Add a login-page asset there or it redirects to
  `/login` for a signed-out visitor.
- **Pages name their scripts and styles by version** (`/v/<hash>/app.js`, rewritten into `index.html` and `login.html`
  by `static.versionPage`; relative `import`s stay inside it). Reason: a CDN in front (Cloudflare's default is four
  hours) kept old files and ran them against a new page. A new top-level script or stylesheet that a page loads must
  be added to `versionedFiles` in `main.go`; `sw.js` is rewritten per build by `static.serviceWorker`.
- **Writes need the `X-Requested-With: jiggered` header** (in `guard`), and every
  non-GET request is checked against `Sec-Fetch-Site` (`rejectCrossSite`). Frontend
  calls go through `api()` in `web/util.js` or `web/sync.js`, which set the header.
- **The CSP is strict** (`securityHeaders`): same-origin only, no inline script or
  style, fonts self-hosted. No new third-party origins without changing it on purpose.
- **SQLite is a single connection** (`SetMaxOpenConns(1)`, WAL, `_txlock=immediate`).
  So never use `s.db` while a transaction or open `rows` is held on the same
  goroutine: it deadlocks. Call `audit()` after the commit, not inside it.
- **Schema changes append a migration** to `migrations` in `db.go`; never edit one
  that has shipped. An upgrade snapshots the database to `backups/` first, and
  `migrate_test.go` upgrades a real legacy-shaped database.
- **Everything about docs and sessions is scoped to the signed-in person**, using
  `authOf(r)`, never an id from the request.
- **Admin endpoints return account metadata only, never a personal doc body.**
  Shared product defaults (`product_defaults` in `instance_settings`) are intentionally visible to signed-in users;
  edits require admin plus a current ETag and never rewrite existing personal lists.
- **One browser editing tab owns a Web Lock**; read-only tabs never write cache/outbox/drafts. Restore holds the network queue and pauses dispatch. Baseline-aware edits surface same-field/deleted-record conflicts in Recovery.
- **Drafts expire after seven days.** Refused operations are retained explicitly in recovery, not presented as saved.
  Keep persistence acknowledgements distinct from network acknowledgements.
- **Admin endpoints do not expose personal doc bodies.** There is a test
  (`TestAdminCannotReadAnyonesLogs`); a new admin endpoint must not weaken it. The
  backup download is the one documented exception (it is the whole database).
- **The Admin tab does not exist for non-admins**: `app.js` imports `admin.js` and
  `mount()`s it only while `/api/me` says admin. Keep it out of `index.html`.
- **Build HTML with the `html` tag in `web/util.js`**, which escapes by default.
  Never concatenate typed text into `innerHTML`.
- **`web/sw.js` lists every file the app needs** (`SHELL`); a test fails if a module
  ships without being listed. It must never cache `/api/`.
- **Dependencies are pure Go** (`modernc.org/sqlite`, `golang.org/x/crypto`). The
  image builds with `CGO_ENABLED=0`; do not add a cgo dependency.
- **Secrets**: `.env`, `*.db` and `/backups/` are gitignored and excluded from the
  Docker context. Never commit them or a real password hash.
- This is a personal health log; the README carries a health warning. Keep it.

## Images and releases

Pushes to `main` publish `dev` plus a short SHA tag; a `v*` tag publishes
`latest`, the semver tags and the SHA. `latest` is reserved for releases. Pull
requests build the image but do not push. The README's tag table is the source
of truth and must change with `image.yml`.

## Git

The repository documents no branch or commit conventions beyond the above. Its
existing commit messages are short imperative sentences in sentence case.

## Memory file hierarchy

Keep every `CLAUDE.md` under 200 lines. This root file is the always-loaded
index and the universal rules. A `CLAUDE.md` in a subfolder, if one is ever
justified by that folder's own tooling, appends scoped context and must never
contradict or overwrite this file. There is none today: the Go code is one flat
package and `web/` has no tooling of its own.
