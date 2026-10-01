<p align="center"><img src="assets/brand/logo.svg" alt="Jiggered" width="360"></p>


Yorkshire for "worn out". A small self-hosted tracker for daily energy check-ins and symptom episodes.
Go, SQLite, one container, password login.

- **Today:** green, amber or red check-in, a 10-point energy budget, a poor-sleep toggle (−3), and one-tap activity costs.
- **Log episode:** when it started, symptoms, onset, duration, likely triggers and notes.
- **History:** 14-day check-in strip, past days and all episodes.
- **Export:** download everything as JSON from the header.

Add it to your phone's home screen and it opens like an app.

## Image

GitHub Actions builds `ghcr.io/jnnngs/jiggered` for amd64 and arm64 on every push to `main`
(`latest`, `dev` and a short commit tag) and on `v*` tags (`1.2.3`, `1.2`).

The repo is private, so the image is too. On the server, log in once with a
personal access token that has `read:packages`:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u jnnngs --password-stdin
```

## Run it

```sh
cp .env.example .env
docker compose pull
docker compose run --rm jiggered hash 'your-password'
# paste the hash into .env as APP_PASSWORD_HASH='…' (keep the single quotes)
docker compose up -d
```

It listens on `127.0.0.1:8080`. Put it behind your reverse proxy with HTTPS
(Caddy, Traefik, nginx). Session cookies are HTTPS-only by default.

Caddy example:

```
jiggered.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

### Local test without HTTPS

```sh
APP_PASSWORD=testpass123 APP_SECURE_COOKIE=false APP_DB=./jiggered.db go run .
# or build the image yourself: docker build -t ghcr.io/jnnngs/jiggered:latest .
```

Then open http://localhost:8080 and sign in as `paul`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `APP_USERNAME` | `paul` | Login username |
| `APP_PASSWORD_HASH` | | bcrypt hash (recommended) |
| `APP_PASSWORD` | | Plain password, if no hash is set (min 8 chars) |
| `APP_SECURE_COOKIE` | `true` | Set `false` only for plain-HTTP testing |
| `APP_TRUST_PROXY` | `false` | Use `X-Forwarded-For` for login rate limiting |
| `APP_ADDR` | `:8080` | Listen address |
| `APP_DB` | `/data/jiggered.db` | SQLite file |

## Security

- bcrypt password check, 5 failed attempts per IP per 15 minutes.
- Random session tokens, stored hashed, HttpOnly cookies, 30-day expiry.
- API writes need a same-origin header, plus a strict Content-Security-Policy.
- Runs as non-root on a read-only distroless image with all capabilities dropped.

## Backup

The data is a single SQLite file in the `jiggered-data` volume:

```sh
docker compose cp jiggered:/data/jiggered.db ./jiggered-backup.db
```

Or use **Export** in the app.

## Health warning

This is a personal log, not a medical device. If symptoms come on suddenly, or
with weakness, face drooping, speech problems or a severe headache, call 999.

## Brand

Logo and icons live in `assets/brand/` (SVG plus PNG) and `web/` (app icons).
