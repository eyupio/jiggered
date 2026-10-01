# CLAUDE.md

Guidance for Claude Code in this repository. `README.md` is the user-facing
setup guide; this file is the index and the rules.

## What this is

Jiggered ("worn out", Yorkshire) is a small self-hosted tracker for daily
energy check-ins and symptom episodes. One Go binary (module
`github.com/jnnngs/jiggered`, Go 1.26) serves a static frontend and a tiny JSON
API backed by SQLite, behind single-user password login. It ships as one
container image on GHCR.

## Commands

```sh
go vet ./...                     # what CI runs
CGO_ENABLED=0 go build ./...     # what CI runs (the image also builds CGO_ENABLED=0)
gofmt -l .                       # should print nothing; CI does not check it
go test ./...                    # passes, but there are no tests yet
```

Measured on a cold module cache: `go vet` plus `go build` took about 2m20s
(pure-Go SQLite compiles slowly), so give the first run a generous timeout.

Run locally without HTTPS, then open <http://localhost:8080> and sign in as `paul`:

```sh
APP_PASSWORD=testpass123 APP_SECURE_COOKIE=false APP_DB=./jiggered.db go run .
```

Generate a password hash for `APP_PASSWORD_HASH`: `go run . hash 'your-password'`
(in Docker: `docker compose run --rm jiggered hash '...'`).

There is no Makefile, no linter config and no frontend build step.

## Layout

| Path | What it is |
| --- | --- |
| `main.go` | The entire backend: config, SQLite open and schema, routes, auth, login rate limiter, docs API |
| `web/` | The whole frontend, hand-written static files (`index.html`, `app.js`, `login.html`, `login.js`, `style.css`, icons, manifest). Embedded with `//go:embed web` |
| `assets/brand/` | Logo and mark sources (SVG, PNG). Not embedded, not served |
| `Dockerfile`, `compose.yaml` | Multi-stage build to distroless nonroot; read-only compose service with `cap_drop: ALL` |
| `.env.example` | Template for compose's `.env` |
| `.github/workflows/image.yml` | The only workflow: vet and build, then build and push the image |

## How it works

- **Storage is two tables**: `docs(id, body, updated_at)` holds the app's data as
  opaque JSON objects keyed by id, and `sessions(token_hash, expires_at)`.
  The server does not interpret doc contents; the frontend owns that shape.
- **API** (all behind `requireAuth`): `GET /api/docs`, `PUT|DELETE /api/docs/{id}`,
  `GET /api/export`. Doc ids must match `^[a-zA-Z0-9_-]{1,64}$`; bodies are
  capped at 256 KiB and must be a JSON object. `GET /healthz` is public.
- **Routes use Go 1.22+ method patterns** on the stdlib `http.ServeMux`. No router
  framework.
- **Configuration is environment only** (`APP_USERNAME`, `APP_PASSWORD_HASH`,
  `APP_PASSWORD`, `APP_SECURE_COOKIE`, `APP_TRUST_PROXY`, `APP_ADDR`, `APP_DB`).
  The table in `README.md` is the reference; keep it and `.env.example` in step
  with `loadConfig`.

## Conventions and gotchas

- **A new public static file needs a route.** Only the files listed in the loop
  in `routes()` are served without login; everything else under `web/` sits
  behind `requireAuth`. Add a login-page asset to that list or it will redirect
  to `/login` for a signed-out visitor.
- **Writes need the `X-Requested-With: jiggered` header** (the CSRF guard in
  `requireAuth`). Frontend calls go through the helper in `web/app.js`, which
  sets it. A new write path must keep the check.
- **The CSP is strict** (`securityHeaders`): scripts and connections are
  same-origin only, styles and fonts may come from Google Fonts. No inline
  scripts and no new third-party origins without changing that header
  deliberately.
- **SQLite is a single connection** (`SetMaxOpenConns(1)`, WAL, busy timeout).
  Keep it that way rather than adding a pool.
- **Schema changes must be additive.** The schema is `CREATE TABLE IF NOT EXISTS`
  in `openDB`, run on every start against a live user database.
- **Dependencies are pure Go** (`modernc.org/sqlite`, `golang.org/x/crypto`).
  The image builds with `CGO_ENABLED=0`; do not add a cgo dependency.
- **Secrets**: `.env` and `*.db` are gitignored and excluded from the Docker
  context. Never commit them or a real password hash.
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
contradict or overwrite this file. There is none today: the codebase is one Go
file and one static folder with no tooling of its own.
