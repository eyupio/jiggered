<p align="center"><img src="assets/brand/logo.svg" alt="Jiggered" width="360"></p>


Yorkshire for "worn out". A small self-hosted tracker for daily energy check-ins and symptom episodes.
Go, SQLite, one container, password login. Run it for yourself, or let one admin look after a few more
people (a household, a support group), each with their own account.

- **Today:** green, amber or red check-in, a points budget (10 by default), a poor-sleep penalty, and one-tap
  activity costs. Open any earlier day to fill it in or correct it.
- **Episode:** when it started, symptoms, onset, duration, likely triggers and notes. Edit it later, for example
  to record when it ended.
- **History:** a tappable 14-day strip, 30-day trends, every day and episode, CSV downloads, and a printable
  summary (save it as a PDF) to show a doctor.
- **Account:** change your password, see and sign out your devices, set your own budget, activities, symptoms,
  triggers and date format, download or restore your data, delete your account.
- **Admin:** add people, reset passwords, disable or remove accounts, sign devices out, read the activity log,
  download a backup.

Add it to your phone's home screen and it opens like an app, even with no signal. What you log while offline
waits on the phone and is sent when you're back online.

## People and the admin

There is no sign-up page. The first account is created from `APP_USERNAME` and `APP_PASSWORD_HASH` and is an
admin. Admins add everyone else from the **Admin** tab (or with the command line, below): the new person gets a
random temporary password, shown once, and must choose their own the first time they sign in.

**What an admin can see:** who has an account, their role, when they last signed in, how many entries they have
and how much space it takes, and how many devices they're signed in on. **What they can't:** anyone's check-ins,
episodes or notes. There is no "sign in as", and no admin screen or endpoint returns the contents of someone's
log.

Two honest limits. A backup is a copy of the whole database, so whoever downloads one can read everything in
it. And the database file isn't encrypted, so anyone with access to the server or its volume can read it
regardless of what the app shows. This is a boundary in the app, not encryption: host it somewhere you trust,
and tell people who is running it.

- An admin can't disable, demote or delete themselves, and the last active admin can never be removed.
- Resetting a password, disabling an account or changing a password signs the affected devices out.
- Each person can store up to 10,000 entries and 25 MB.
- If you lose the admin's password, reset it from the command line (below). That works even when the web page
  is out of reach.

## Image

GitHub Actions builds `ghcr.io/jnnngs/jiggered` for amd64 and arm64:

| Trigger | Tags |
|---|---|
| Push to `main` | `dev`, short commit SHA |
| Tag `v1.2.3` | `latest`, `1.2.3`, `1.2`, short commit SHA |

Pick which one to run with `JIGGERED_TAG` in `.env` (default `latest`).
To cut a release:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

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

`docker compose ps` shows whether it's healthy: the image checks itself every 30 seconds.

### Local test without HTTPS

```sh
APP_PASSWORD=testpass123 APP_SECURE_COOKIE=false APP_DB=./jiggered.db go run .
# or build the image yourself: docker build -t ghcr.io/jnnngs/jiggered:latest .
```

Then open http://localhost:8080 and sign in as `paul`.

### Upgrading from the single-user version

Pull and start with your existing `.env`. Your `APP_USERNAME` becomes the first admin and keeps all your data, and
you stay signed in. Before it changes anything it saves a copy of your database as
`/data/backups/pre-upgrade-*.db`.

After that, `APP_PASSWORD_HASH` is only used if the database ever has no accounts at all. Change your password in
**Account**. An older version can't read the upgraded database; to go back, restore the `pre-upgrade` copy
(see **Backup and restore**).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `APP_USERNAME` | `paul` | Name of the first admin. Used once, to create it. |
| `APP_PASSWORD_HASH` | | bcrypt hash for the first admin (recommended). Used once. |
| `APP_PASSWORD` | | Plain password for the first admin, if no hash is set (min 8 chars). Used once. |
| `APP_SECURE_COOKIE` | `true` | Set `false` only for plain-HTTP testing |
| `APP_TRUST_PROXY` | `false` | Take the client address from `X-Forwarded-For`, for sign-in lockouts and the device list |
| `APP_PROXY_HOPS` | `1` | How many trusted proxies sit in front of Jiggered (only with `APP_TRUST_PROXY`) |
| `APP_ADDR` | `:8080` | Listen address |
| `APP_DB` | `/data/jiggered.db` | SQLite file |

With `APP_TRUST_PROXY`, the address is read from the **right-hand** end of `X-Forwarded-For`, which is the entry
your own proxy added. Anything further left was sent by the client and is ignored.

## Looking after it

These commands work on the database directly, so they still work if you're locked out of the web page. With the
container running:

```sh
docker compose exec jiggered /jiggered user list
docker compose exec jiggered /jiggered user add alice            # prints a temporary password, once
docker compose exec jiggered /jiggered user add bob --admin
docker compose exec jiggered /jiggered user reset-password alice # new temporary password; signs her out everywhere
docker compose exec jiggered /jiggered user disable alice        # also enable, promote, demote
docker compose exec jiggered /jiggered user delete alice --yes   # her account and everything she logged
```

If the container is stopped, use `docker compose run --rm jiggered user list` instead.

Sign-in lockouts are kept in memory, so `docker compose restart jiggered` clears them.

## Backup and restore

The data is a single SQLite file in the `jiggered-data` volume, plus a `-wal` file beside it while the app runs.
**Don't back it up by copying `jiggered.db` alone**: recent changes live in the `-wal` file, so that copy can be
stale or even empty. Use these instead, which take a consistent copy while the app is running:

```sh
docker compose exec jiggered /jiggered backup                     # saved in the volume, under /data/backups/
docker compose exec -T jiggered /jiggered backup - > jiggered-backup.db   # or straight to a file on this machine
```

Admins can also use **Download backup** in the Admin tab. A copy of your own data alone is **Download everything**
in Account, which can be restored from the same page.

To restore a backup, stop the app first:

```sh
chmod a+r jiggered-backup.db                  # the container runs as a non-root user and must be able to read it
docker compose stop jiggered
docker compose run --rm -v "$PWD:/backup:ro" jiggered restore /backup/jiggered-backup.db --yes
docker compose start jiggered
```

It checks the file first, keeps the database it replaces as `/data/backups/pre-restore-*.db`, and removes the old
`-wal` file. Upgrades also leave a `pre-upgrade-*.db` copy there. Nothing deletes the `backups` folder for you.

## Security

- bcrypt password check. Ten failed sign-ins per address and ten per account in 15 minutes lock that address or
  account out for the rest of the window, and only a few passwords are checked at once.
- Random session tokens, stored hashed, HttpOnly cookies, 30-day expiry. Signing out, changing the password,
  disabling or deleting the account ends sessions; you can also sign out other devices yourself.
- Writes need a same-origin header, and browsers' `Sec-Fetch-Site` is checked on every write, which also stops an
  attacker signing you in to their own account. A strict Content-Security-Policy; fonts are served from the app,
  so it makes no requests to third parties.
- Temporary passwords are random, shown once, and must be replaced at first sign-in.
- Everything an admin does, and every sign-in, is in the activity log.
- Runs as non-root on a read-only distroless image with all capabilities dropped.

## Development

```sh
go vet ./... && go test -race ./...     # server: accounts, isolation, upgrade from the old schema, CLI, backups
node --test "test/*.test.mjs"           # front-end logic: sync engine, settings, trends, CSV
```

The page is plain ES modules with no build step. `web/sync.js` is the part to read first: edits are queued as
operations and replayed on the server's latest copy, which is why two devices can edit the same day without
losing each other's changes.

## Health warning

This is a personal log, not a medical device. If symptoms come on suddenly, or
with weakness, face drooping, speech problems or a severe headache, call 999.

## Brand

Logo and icons live in `assets/brand/` (SVG plus PNG) and `web/` (app icons). The fonts in `web/fonts/` are
Atkinson Hyperlegible and Bricolage Grotesque, under the SIL Open Font License (see `web/fonts/LICENSE.txt`).
