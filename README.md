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
  say whether a reverse proxy sits in front, download a backup. The tab exists only for admins.

Add it to your phone's home screen and it opens like an app, even with no signal. What you log while offline
waits on the phone and is sent when you're back online.

## People and the admin

There is no sign-up page. You create the first account, an admin, from the command line (see **Run it**). Admins
add everyone else from the **Admin** tab or the command line: the new person gets a random temporary password,
shown once, and must choose their own the first time they sign in. Accounts, and everything else about how
Jiggered behaves, live in the database; the environment only says where that is.

**What an admin can see:** who has an account, their role, when they last signed in, how many entries they have
and how much space it takes, and how many devices they're signed in on. **What they can't:** anyone's check-ins,
episodes or notes **through the Admin screens**: no admin screen or endpoint returns the contents of someone's
log, and there is no "sign in as". The activity log, which admins can read, also shows when and from which address
each person signed in.

That is a boundary in the app, not encryption, and it has limits you should know about:

- An admin can reset anyone's password and then sign in with the temporary one, which shows them that person's
  data (and signs the person out). The activity log records the reset, but then records what they do as that
  person.
- A backup is a copy of the whole database: everyone's logs, password hashes and the activity log. Any admin can
  download one.
- The database file isn't encrypted, so anyone with access to the server or its volume can read it.

So host it somewhere you trust, give the admin role only to someone the others trust, and tell people who that is.

- An admin can't disable or demote themselves, or delete themselves from the Admin tab. They can delete their own
  account from Account while another active admin remains, and the last active admin can never be removed.
- Resetting a password, disabling an account or changing a password signs the affected devices out.
- Each person can store up to 10,000 entries and 25 MB.
- If you lose the admin's password, reset it from the command line (below). That works even when the web page
  is out of reach.
- The Admin tab doesn't exist for anyone else: the page only loads it, and the server only answers its requests,
  for admins, and a change of role takes effect as soon as the app is next opened.

## Image

GitHub Actions builds `ghcr.io/jnnngs/jiggered` for amd64 and arm64:

| Trigger | Tags |
|---|---|
| Push to `main` | `dev`, `sha-` and the short commit |
| Tag `v1.2.3` (not `v1.2.3-rc1`) | `latest`, `1.2.3`, `1.2`, `sha-` and the short commit |

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
docker compose up -d
docker compose exec jiggered /jiggered user add paul --admin     # prints a temporary password
```

That's all the setup there is: no `.env` to edit. Open the page, sign in as `paul` with the temporary password,
and choose your own. Until someone has an account, the sign-in page says how to make one.

It listens on `127.0.0.1:8080`. Put it behind your reverse proxy with HTTPS (Caddy, Traefik, nginx), then tick
**Jiggered runs behind a reverse proxy** in **Admin, Connection** so sign-in lockouts and the device list see
real addresses (the page shows what Jiggered thinks your address is, so you can check it's right). Session
cookies are HTTPS-only by default.

Caddy example:

```
jiggered.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

`docker compose ps` shows whether it's healthy: the image checks itself every 30 seconds.

### Local test without HTTPS

```sh
APP_PASSWORD=testpass123 APP_SECURE_COOKIE=false APP_DB=./jiggered.db go run .   # the old variables still work for a first run
# or build the image yourself: docker build -t ghcr.io/jnnngs/jiggered:latest .
```

Then open http://localhost:8080 and sign in as `paul`. (Plain-http testing is the one time to turn secure cookies
off, with `go run . settings set secure_cookie false` after the first run, or `APP_SECURE_COOKIE=false` on the very
first run.)

### Upgrading from the single-user version

Pull and start with your existing `.env`. Your `APP_USERNAME` becomes the first admin and keeps all your data, and
you stay signed in. Before it changes anything it saves a copy of your database as
`/data/backups/pre-upgrade-*.db`. Your `APP_TRUST_PROXY`, `APP_SECURE_COOKIE` and `APP_PROXY_HOPS` are copied into
the database once; from then on the database is the source, and you can delete those lines (and
`APP_PASSWORD_HASH`) from `.env`.

Leave `APP_USERNAME` and the password line in place for that first start: a database from the single-user version
won't open without them (the log says so, and nothing is changed). Once `docker compose exec jiggered /jiggered
user list` shows your account, they can go.

Change your password in **Account**. Don't start an older version on an upgraded data folder: a build that knows about schema versions refuses it, but the
original single-user one opens it without complaint, shows everyone's entries merged, and can delete them. To go back,
stop Jiggered, restore the
`pre-upgrade` copy (see **Backup and restore**).

## Configuration

The environment only has to say where things are, and both have sensible defaults:

| Variable | Default | Purpose |
|---|---|---|
| `APP_DB` | `/data/jiggered.db` | The SQLite file. Everything else lives in it. |
| `APP_ADDR` | `:8080` | Listen address (in Docker leave it: the port mapping in `compose.yaml` points at 8080) |

Everything else is stored in the database, so it survives upgrades, travels with a backup, and an admin can change
it while the app runs:

| Setting | Default | What it does | Change it in |
|---|---|---|---|
| `trust_proxy` | off | Take the client's address from `X-Forwarded-For` (needed behind a reverse proxy) | Admin, Connection |
| `proxy_hops` | `1` | How many proxies sit in front. The address is read from the **right-hand** end of `X-Forwarded-For`: the entry your own proxy added. Anything further left was sent by the client and is ignored. | Admin, Connection |
| `secure_cookie` | on | Sign-in cookies only travel over HTTPS. Turn off only to test over plain http. | `jiggered settings set secure_cookie false` |

`secure_cookie` isn't in the web page on purpose: turning it on while you're using plain http would lock you out.
From the command line, `jiggered settings` lists all three and `jiggered settings set KEY VALUE` changes one; a
running server notices within a couple of seconds.

### Environment variables from earlier versions

`APP_USERNAME`, `APP_PASSWORD_HASH`, `APP_PASSWORD`, `APP_SECURE_COOKIE`, `APP_TRUST_PROXY` and `APP_PROXY_HOPS`
are not needed any more. If they are set they are read **once**, to fill in something the database doesn't have
yet (the first admin, while there are no accounts, and the settings above), and the log says when it does. After
that the database wins: an environment value that disagrees is ignored, and the log says so. `docker compose run
--rm jiggered hash 'password'` still prints a bcrypt hash if you want to seed the first admin that way.

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
docker compose exec jiggered /jiggered settings                  # show the instance settings
```

If the container is stopped, use `docker compose run --rm jiggered user list` instead.

Sign-in lockouts are kept in memory, so `docker compose restart jiggered` clears them. (Resetting a password in the Admin
tab clears that account's lockout; the command line can't reach the running server, so after `user reset-password` for
someone locked out, restart too.) Restoring a backup brings back its accounts, roles, password hashes and sessions as they were then.

## Backup and restore

The data is a single SQLite file in the `jiggered-data` volume, plus `-wal` and `-shm` files beside it while the app runs.
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
  account out for the rest of the window, and only a few passwords are checked at once. A guess is counted as it
  starts, so a burst of requests gets no more tries than a slow trickle. A locked account answers exactly like a
  wrong password, so the sign-in page can't be used to find out which usernames exist.
- Random session tokens, stored hashed, HttpOnly cookies, 30-day expiry, at most 25 signed-in devices per account
  (the oldest are signed out beyond that). Signing out, changing the password, disabling or deleting the account
  ends sessions, including one whose sign-in was already under way; you can also sign out other devices yourself.
- Writes need a same-origin header, and browsers' `Sec-Fetch-Site` is checked on every write, which also stops an
  attacker signing you in to their own account. A strict Content-Security-Policy; fonts are served from the app,
  so it makes no requests to third parties.
- Temporary passwords are random, shown once, and must be replaced at first sign-in.
- Everything an admin or the command line does, and every successful sign-in and wrong password for an existing account,
  is in the activity log (180 days; the newest 10,000 events of each kind). Attempts with unknown names, and attempts
  refused by a lockout, appear only in the server's own log.
- Runs as non-root on a read-only distroless image with all capabilities dropped.

## Development

```sh
go vet ./... && go test -race ./...     # -race needs a C compiler; Node 22+ for the front-end tests below
#     # server: accounts, isolation, upgrade from the old schema, CLI, backups
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
