# CLAUDE.md

Guidance for Claude Code in this repository. `README.md` is the user-facing
setup guide; this file is the index and the rules.

## What this is

Jiggered ("worn out", Yorkshire) is a small self-hosted tracker for daily
energy check-ins and symptom episodes. One Go binary (module
`github.com/jnnngs/jiggered`, Go 1.27.1) serves a static ES-module frontend and a
JSON API backed by SQLite. Several people can each have an account, with an
admin to manage them; password login. It ships as one container image on GHCR.

## Contributor guide

[CONTRIBUTING.md](CONTRIBUTING.md) owns the local setup, code map, checks and
browser-scenario list. Use `npm ci --prefix test` for the locked development
tools, `npm --prefix test run check` for formatting/lint/logic tests, and
`npm --prefix test run browser` for all eight scenarios with one fixture build.
Keep those instructions current when changing the workflow or tooling.

## How it works

- **Storage** (`db.go`): `users`, `docs(user_id, id, body, rev, size, updated_at)`,
  `sessions(.., user_id, ..)`, `audit_log`, `instance_settings`, `doc_revs(user_id, id, rev)` (the last revision of a
  deleted doc, so recreating it never reuses a revision; a DELETE with `If-Match` of an older revision gets a 409). Docs are opaque
  JSON objects per person; the server does not interpret them, the frontend owns
  their shape. Ids are allow-listed: `d-YYYY-MM-DD`, `e-<digits>`, `settings`.
- **Sync**: the frontend queues _operations_ ("add this entry"), shows the server
  copy with them applied, and saves with `If-Match: "<rev>"`. A 409 returns the
  current doc and the operations are replayed on it, so two devices merge. `GET /api/docs` is always the whole account (never a
  page: omitted docs would look deleted) with a weak ETag over each doc's id, revision, size and save time; a client that
  holds the current snapshot sends it and gets 304. `sync.js` forgets the tag whenever anything else changes its copy.
- **Accounts**: created by an admin (temporary password, must be changed before
  anything else works), by `jiggered user add`, or through verified-email registration when enabled.
  `/register` and `/login` share the account forms; `/welcome` is the public landing page.
  Signed-out `/` serves the landing; signed-in `/` serves the private app. The last active
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
- **Admin writes require `X-Jiggered-Password` for a fresh password check and revalidate actor/session/role in the mutation transaction.**
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
package; frontend and browser tooling is managed by `test/package.json`.
