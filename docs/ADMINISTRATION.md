# Administration and product reference

Detailed guidance for operating Jiggered and understanding its saving, recovery and privacy behaviour. For an overview and quick start, see [README.md](../README.md).

- **Today:** a live energy breakdown and labelled available/planned/used spoon or point cells,
  plus a running balance showing how logged activities changed your energy. Green, amber or red check-in, a points budget (10 by default), a poor-sleep penalty, and one-tap
  activity costs. Open any earlier day to fill it in or correct it.
- **Plan:** look ahead one, three or seven days. Add workload and recovery with your own costs, repeat
  activities on consecutive days, and estimate a separate starting allowance for each unlogged day.
  See energy available now, remaining commitments, the balance before recovery and the projected balance
  after estimated recovery. Recovery choices use your saved activities. Mark an activity Done to confirm
  its actual name, cost and time; it logs once and stops reserving energy. Unfinished plans never count
  as actual usage. Today shows upcoming commitments, while History compares planned and actual costs
  for completed activities. Daily allowances reset rather than carry over. Plans use the same private
  offline queue, cross-device sync, full JSON export and restore as your other records.
- **Episode:** when it started, symptoms, onset, duration, likely triggers and notes. Edit it later, for example
  to record an approximate duration or exact local end time. Ongoing episodes are shown on Today and Episode.
- **History:** an activity calendar and selected-day view, with full records, charts and patterns available
  when you want them. Explore 7 days through all time, or choose your dates. Search and filter by date,
  check-in, symptom or ongoing status; the calendar, records, graphs, printable summary and CSV use the
  same selection. Private summary notes are opt-in; CSV files include notes. Your selections, open sections
  and position stay in place when you refresh the browser tab.
- **Account:** a private profile photo, display name and focus, region, light/dark/device appearance, starting history period and
  lifetime log totals. Jump to your profile, budget and personal lists, password, devices or data tools;
  download or restore your data, or delete your account. Emergency messages follow your saved region;
  an unknown region prompts you to call your local emergency number.
- **Admin:** add people, reset passwords, disable or remove accounts, sign devices out, read the activity log,
  maintain shared starting activities, symptoms, triggers and budgets, say whether a reverse proxy sits in front, download a backup. The tab exists only for admins.

Add it to your phone's home screen and it opens like an app, even with no signal. What you log while offline
waits on the phone and is sent when you're back online. The status distinguishes a queued device copy from
server acknowledgement; blocked/full device storage warns you to keep the page open and download recovery.

### Personal lists and shared defaults

In **Account → Energy & personal lists**, drag the dotted handle to put frequently used activities, symptoms and triggers
first. Mouse and touch dragging show a floating preview and drop placeholder; handles also support arrow
keys, Home/End and move buttons. Save publishes the order to your account, so Today/Episode use it on every
device. Zero-point activities are supported. Invalid names, duplicates and list limits keep your input and
show an explanation instead of silently changing it.

Admins maintain the same lists, budget, sleep cost and date format under **Admin → Shared product defaults**.
Defaults live in the existing instance-settings table, are included in database backups, and changes appear
in the activity log. Conflicting admin saves are refused rather than overwriting newer defaults. New users
start with that version; existing personal settings are preserved. When the shared defaults gain items a person
lacks, a notice on every tab offers **Add all to my lists** (new items go on the end; nothing of theirs
changes; Undo is offered), **Review in Account** or **Not now** (remembered until the defaults change again).
Account also has **Add new shared items** and **Replace with shared defaults**; both fill a draft to review,
then Save. On Today, group pills (Work, Home, ...) narrow the activity buttons to one group. Symptoms and triggers can have
groups too (stored as a name-to-group map beside the plain lists, so episodes are unaffected); they become the same
pills on the Episode tab. Groups are decided per name: an item without a group of its own takes the shared defaults' group for that name
(so existing lists are grouped without any reset), and a group you set yourself always wins. **Use factory defaults** in Admin fills a
draft; publishing it still requires Save. No new hosted service or production dependency is introduced.

### Check-in and points

Choosing Amber or Red at the morning check-in takes points off that day (**Amber day costs** and **Red day costs** in
Account, 3 and 6 by default; shared defaults can set them too). The amount is stamped on the day when you choose, so
changing the setting later, or a day from before this existed, keeps the numbers it had. It stacks with poor sleep, and
the day never goes below zero points available.

### Optional spoon theory theme

In **Account → Profile → Energy language**, choose **Spoons** and **Save profile**.
Points remain the default. The spoon theory theme uses spoons for energy labels,
activity costs, history and printed summaries, with a spoon visual for the daily
budget. One spoon represents one point; the theme preserves budgets, calculations
and historical values. It follows your private profile across devices and can be
switched back at any time. Drafts follow the existing offline saving and recovery
flow. JSON backups include the preference; CSV column names remain stable for
existing spreadsheets.

### Staying where you were

A browser refresh returns you to the same tab (it is in the address, so a link such as `/#history` opens that tab), the
same scroll position, and the past day you were viewing on Today. The scroll position and day are kept in that browser
tab's session storage only and are cleared when you sign out.

### Exploring your history and profile

The calendar can colour days by morning check-in, net activity points, recorded episodes or poor sleep.
Select a square to pin its details, open that day, or view its episodes. Arrow keys move one day vertically
or one week horizontally; Enter selects and Escape clears the selection. A day selector offers larger targets
on small screens. Long histories page through windows of up to 366 days on desktop or 91 on a phone.

Energy graphs subtract recovery from activity costs and use each day's saved allowance. Missing activity logs
stay gaps, including on days with a check-in. Longer periods group dates into at most 60 points and average
only days with activities. Inspect a day/period or open **View graph data** for exact values. Comparisons use
the preceding interval of equal length with the same filters. Sleep and weekday patterns need at least three
check-ins per displayed group; an unmarked poor-sleep flag does not prove good sleep. These descriptions
reflect what you recorded and do not establish causes.

**Account → Profile** saves your private name, focus and preferences separately from energy settings and lists.
Your sign-in username stays the same. Appearance applies on save; the starting history period applies when
you next open the app. Profile saves use the existing offline queue and conflict recovery.

### Drafts and recovery

New episodes, individual episode edits, activity corrections, profile, personal settings and admin defaults keep separate drafts on this
device for seven days. Navigation preserves them; unfinished episode edits have a Continue action. Explicit
discard, acknowledged save or deliberate sign-out clears the relevant drafts. A different account cannot
open them. These copies contain sensitive data: use a device you trust.

The large cache/outbox uses IndexedDB, with localStorage fallback where unavailable. Migration removes the
old name-bound cache only after its IndexedDB transaction completes. Server refusals keep their content in
**Recovery**, even when other changes save successfully. Retry, edit a recovered copy, discard, or download
a private device recovery file; up to 100 refusals are retained until explicitly resolved. At that limit new
refusals stay queued, with a warning, rather than dropping content. Recovery files include unfinished drafts
and unsent operations and are for manual recovery/support, **not** the account Restore form. Server exports
and restores require queued/refused changes to be resolved first. A confirmed session expiry or revocation clears
this browser’s identity, logs and drafts before sign-in; download recovery before deliberately signing out.
Offline access uses unencrypted device copies on trusted devices. A fully offline device cannot learn of remote revocation
until it reconnects. Signing out from any tab clears the shared device copy and stops older tabs writing it back. Browser eviction or a device failure can still remove local
copies, so acknowledged server saves and private backups remain important.

### In-app help

The **Help** tab contains searchable, offline-available answers for getting started, energy points, activities,
episodes, sharing, settings, restores, privacy and saving problems. Admins also see an account/defaults guide.
Contextual Help links open the relevant answer. Useful controls have plain-language hover and keyboard-focus
tooltips; the question-mark button supports touch. Escape dismisses a tooltip. Essential guidance remains
visible in the forms and Help, so it never depends on hovering.

### Corrections, restores and concurrent edits

Use **Edit** beside a logged activity to correct its name, points or optional time; its position stays the same.
**Other activity** logs a one-off item without changing your presets. Correction and removal offer Undo.
Older entries receive deterministic identities on first edit so identical repeated activities remain distinct.

Account restore starts with a server-validated preview of additions, matches, replacements and settings changes.
Keep-existing is the default. Confirmation downloads your current server export before committing. Malformed
known fields reject the whole file with record-specific reasons; legacy optional fields and unrecognised fields
are preserved. Quotas and the preview fingerprint are checked in the same transaction as writes. If any account
record, the file or mode changed, preview again. A downloaded backup can restore replaced records; it does not
remove records added by a restore. The older `/api/import` API remains available for legacy clients; it still
skips a record instead of rejecting the file, and the new UI uses `/api/restore/preview` and `/api/restore` exclusively.
Saves, imports and restores all check records with the same rules (`validate.go`): the fields the app knows are
checked, anything else is kept exactly as sent, and an older or shorter record is accepted. A save that breaks a rule
is refused with a 422 and a reason, and the app keeps the change in Recovery.

The browser grants **one editing tab** an exclusive Web Lock; other tabs can browse/download and follow its
acknowledged device cache, without sending or overwriting its outbox. Close the editing tab, then use **Reload
to edit here** in another tab to recover and continue. HTTPS (or localhost) and a browser with Web Locks are
required for editing; unsupported environments display an actionable read-only notice. Older deployed builds
do not participate in this lock: close old Jiggered tabs when upgrading. No background heartbeat or service is
required. Independent devices still merge activity additions and disjoint episode/settings edits. Activities in
settings have stable row ids so editing one row preserves changes to another (and name/points merge separately).
Same-field or incompatible reorder edits appear in Recovery with **Keep server copy** and **Use my change**.
A deleted record wins over a queued edit; restoring the retained copy requires the explicit **Restore my record**
action. These choices do not alter other users' records. Exported backups and recovery files are private health data.

## People and the admin

The landing page explains free access and MIT-licensed self-hosting. Signup availability
follows the instance’s `/api/auth/options` response: open registration shows signup calls to action and email-verification
instructions; closed registration shows sign-in links and a closed notice. An unavailable settings request shows an
unknown status. Repository visibility and licensing remain separate from hosted registration.

To open registration on the hosted instance, configure SMTP under **Admin → Email & signup**,
then set the trusted HTTPS **Public application URL**, enable **Registration** (and **Password recovery** if wanted), and save
with your current admin password. Visit `/welcome` and `/register` signed out to confirm signup is offered.
Complete an email-verification signup before announcing the launch.

The service-admin password is remembered only in the open page’s memory for a fixed 30 minutes after a
successful request; reload, sign-out, rejected authentication or expiry clears it. The server still checks every
request. Typing that password does not mark settings changed. Email and S3 test buttons save pending settings
before testing, and do not run the test if saving fails. SMTP credentials stay in the instance’s
service settings; do not commit them or enable registration by default for other installations.

Registration is closed by default. Create the first account, an admin, from the command line (see **Run it**).
Signed-out visitors see the public landing page at `/`; `/welcome` is always the public page, including while signed in.
The landing page and public feature/help pages include search and social metadata. Personal installations and previews
are `noindex` by default. Sign-in, registration, APIs and personal logs remain `noindex` on every deployment.
`/login` opens sign-in, and `/register` opens registration when available. The public HTML renders signup availability
and links from the instance settings before JavaScript runs. The public pages use self-hosted assets and respect
reduced-motion preferences.

### Public pages and search indexing

Public feature and help pages explain energy tracking, symptom episodes, Spoon Theory, getting started, CSV/PDF
exports, offline saving, price/access and privacy. Spoon Theory is attributed to Christine Miserandino and links to
her original essay; Jiggered points are personal estimates, not a fixed spoon scale. The pages are rendered by Go
from embedded templates and work without JavaScript. Personal logs stay behind authentication.

For the **official production host**, set these deployment variables and restart the app:

```dotenv
APP_PUBLIC_ORIGIN=https://your-official-host.example
APP_PUBLIC_INDEXING=true
```

Replace the example with the real public HTTPS origin. Do not copy these settings to previews or personal instances.
If an existing official deployment previously relied on automatic indexing, configure both variables before upgrading:
otherwise its public pages will become `noindex`. These are deployment controls, not database seeds. A configured
origin without indexing enabled can be used for preview metadata. Indexing enabled without an origin fails startup.
The origin must have no path, query, fragment or credentials; localhost HTTP is accepted for testing. Keep this origin
consistent with the Public application URL used for account-verification email links.

`/sitemap.xml` automatically lists the nine canonical public pages and `/robots.txt` advertises it,
without an indexing toggle or additional setup. It uses `APP_PUBLIC_ORIGIN` when provided, otherwise
the existing Admin Public application URL, otherwise the request origin (forwarded headers are used only
from a configured trusted proxy). Personal logs and account pages are always excluded.
On an index-enabled production host, `/llms.txt` describes the product and links to those pages. Sitemap modification dates are omitted rather than
invented. The llms endpoint returns 404 on non-indexable deployments; the sitemap remains available. Robots rules allow search and AI
crawlers to read public pages and account `noindex` responses; APIs are disallowed and still require authentication.
This is a deliberate shared crawler policy, not a separate model-training permission mechanism.

The public home canonical is the absolute configured origin plus `/welcome`; signed-out `/` remains a readable alias
and signed-in `/` remains the private app. Known uppercase/trailing-slash public aliases redirect permanently to
lowercase paths without trailing slashes. Unknown URLs return real 404s. In your reverse proxy, redirect HTTP to HTTPS
and alternate hostnames to the preferred host, preserving the path and query. For example, add an alternate-host
block alongside the existing Caddy HTTPS host:

```caddyfile
www.your-official-host.example {
    redir https://your-official-host.example{uri} permanent
}
```

Use the actual hostnames, confirm the proxy's HTTPS policy, and check redirect chains before publishing. Public
HTML uses `no-store` because access availability is instance-dependent. Keep private/authenticated responses out of
shared CDN caches. The app retains its existing strict CSP; structured data uses microdata, without inline scripts.

Verify signed-out responses with `curl`: each public route should return 200 with correct content, canonical and
indexing policy; the XML sitemap should contain only canonical public pages. Submit it to Search Console after the
production host is enabled. Comparison and public self-hosting launch pages are deferred until their source, pricing,
licensing and availability claims can be verified.

The signed-in views share the landing page’s typography and palette while retaining personal light/dark/device
appearance settings. Today’s energy ring follows the day’s saved allowance; its numeric readout keeps negative
balances and recovery above the allowance visible. The ring is a personal planning visual, not a target or a
measurement of health. The dashboard styling is included in the versioned offline app shell.

Admin is organized into keyboard-accessible sections for People, Email & signup, Backups, Shared defaults,
Connection and Activity. Desktop uses a sidebar; smaller screens use a compact menu. Service settings and the
30-minute password cache stay in place while switching sections. Account actions expand per person.

Admins can enable verified-email registration in Admin after configuring SMTP, or add people from the **Admin**
tab or command line: the new person gets a random temporary password,
shown once, and must choose their own the first time they sign in. Accounts, and everything else about how
Jiggered behaves, live in the database; the environment only says where that is.

**What an admin can see:** who has an account, their role, when they last signed in, how many entries they have
and how much space it takes, and how many devices they're signed in on. **What they can't:** anyone's check-ins,
episodes or notes **through the Admin screens**: no admin screen or endpoint returns the contents of someone's
log, and there is no "sign in as". The activity log, which admins can read, also shows when and from which address
each person signed in.

That is a boundary in the app, not encryption, and it has limits you should know about:

- An admin can reset anyone's password and, if two-step verification is enabled, reset that protection too. They can then sign in with the temporary password, which shows them that person's
  data (and signs the person out). The activity log records the reset, but then records what they do as that
  person.
- A backup is a copy of the whole database: everyone's logs, password hashes and the activity log. Any admin can
  download one.
- The database file isn't encrypted, so anyone with access to the server or its volume can read it.

So host it somewhere you trust, give the admin role only to someone the others trust, and tell people who that is.

- An admin can't disable or demote themselves, or delete themselves from the Admin tab. They can delete their own
  account from Account while another active admin remains, and the last active admin can never be removed.
- Resetting a password, disabling an account or changing a password signs the affected devices out.
- Each person can store up to 10,000 live entries, 100,000 distinct entry IDs over the account lifetime and
  25 MB of live data. Deleted IDs
  retain revision metadata to prevent stale writes. Deletion frees live entry slots and bytes; it does not free distinct-ID capacity.
  Existing IDs can still be edited or recreated at the limit; older accounts above it can maintain existing IDs.
- Admin changes require the admin’s current password each time. A password change replaces all old session tokens
  and issues a fresh cookie to the caller; a copied old cookie stops working.
- Imports and restore previews admit at most two uploads globally and one per account, reject duplicate IDs and
  more than 10,000 records, and cap validation errors at 100. Compose limits the service to 512 MiB and two CPUs.
- If you lose the admin's password, reset it from the command line (below). That works even when the web page
  is out of reach.
- The Admin tab doesn't exist for anyone else: the page only loads it, and the server only answers its requests,
  for admins, and a change of role takes effect as soon as the app is next opened.

## Image

GitHub Actions builds `ghcr.io/jnnngs/jiggered` for amd64 and arm64:

| Trigger                         | Tags                                                  |
| ------------------------------- | ----------------------------------------------------- |
| Push to `main`                  | `dev`, `sha-` and the short commit                    |
| Tag `v1.2.3` (not `v1.2.3-rc1`) | `latest`, `1.2.3`, `1.2`, `sha-` and the short commit |

Pick which one to run with `JIGGERED_TAG` in `.env` (default `latest`).
To cut a release:

```sh
git tag v1.0.0 && git push origin v1.0.0
```

Pull the image without signing in when the GHCR package is public. Package visibility
is managed separately from repository visibility. If an image pull is denied,
[build from source](#build-from-source) or ask the package owner to publish it;
you do not need to give Jiggered a GitHub token.

### Build from source

```sh
git clone https://github.com/jnnngs/jiggered.git
cd jiggered
docker build -t ghcr.io/jnnngs/jiggered:latest .
```

## Run it

```sh
docker compose up -d
docker compose exec jiggered /jiggered user add admin --admin     # prints a temporary password
```

That's all the setup there is: no `.env` to edit. Open the page, sign in as `admin` with the temporary password,
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
APP_USERNAME=admin APP_PASSWORD=testpass123 APP_SECURE_COOKIE=false APP_DB=./jiggered.db go run .   # the old variables still work for a first run
# or build the image yourself: docker build -t ghcr.io/jnnngs/jiggered:latest .
```

Then open http://localhost:8080 and sign in as `admin`. (Plain-http testing is the one time to turn secure cookies
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

| Variable   | Default             | Purpose                                                                                |
| ---------- | ------------------- | -------------------------------------------------------------------------------------- |
| `APP_DB`   | `/data/jiggered.db` | The SQLite file. Everything else lives in it.                                          |
| `APP_ADDR` | `:8080`             | Listen address (in Docker leave it: the port mapping in `compose.yaml` points at 8080) |

Everything else is stored in the database, so it survives upgrades, travels with a backup, and an admin can change
it while the app runs:

| Setting               | Default | What it does                                                                                                                                                                                      | Change it in                                |
| --------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `trust_proxy`         | off     | Read forwarded headers only from configured trusted proxy addresses                                                                                                                               | Admin, Connection                           |
| `trusted_proxy_cidrs` | empty   | Comma-separated IP CIDRs of the immediate and intermediate proxies. Empty means no headers are trusted, even with `trust_proxy` on.                                                               | Admin, Connection                           |
| `proxy_hops`          | `1`     | How many proxies sit in front. The address is read from the **right-hand** end of `X-Forwarded-For`: the entry your own proxy added. Anything further left was sent by the client and is ignored. | Admin, Connection                           |
| `secure_cookie`       | on      | Sign-in cookies only travel over HTTPS. Turn off only to test over plain http.                                                                                                                    | `jiggered settings set secure_cookie false` |

`secure_cookie` isn't in the web page on purpose: turning it on while you're using plain http would lock you out.
From the command line, `jiggered settings` lists all settings and `jiggered settings set KEY VALUE` changes one; a
running server notices within a couple of seconds.

For a loopback proxy, set `trusted_proxy_cidrs` to `127.0.0.1/32,::1/128` before enabling `trust_proxy`.
For a container proxy, use its actual source CIDR and keep the backend private. Every configured hop must be
trusted. The proxy must overwrite `X-Forwarded-Host` and `X-Forwarded-Proto` with one canonical host and scheme;
comma-separated values are refused for login. Forwarded address chains must append the real client address.
Existing installations with proxy trust enabled must set the CIDRs after upgrading.

### Environment variables from earlier versions

`APP_USERNAME`, `APP_PASSWORD_HASH`, `APP_PASSWORD`, `APP_SECURE_COOKIE`, `APP_TRUST_PROXY` and `APP_PROXY_HOPS`, plus `APP_TRUSTED_PROXY_CIDRS`,
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
someone locked out, restart too.) Restoring a backup brings back its accounts, roles, password hashes and disabled state as they were then, so a password
changed or an account disabled since the backup is undone. Everyone is signed out by a restore, including sessions that
were still valid when the backup was taken.

## Backup and restore

The data is a single SQLite file in the `jiggered-data` volume, plus `-wal` and `-shm` files beside it while the app runs.
**Don't back it up by copying `jiggered.db` alone**: recent changes live in the `-wal` file, so that copy can be
stale or even empty. Use these instead, which take a consistent copy while the app is running:

```sh
docker compose exec jiggered /jiggered backup                     # saved in the volume, under /data/backups/
# Or write to a private directory outside the checkout:
backup_dir="$HOME/.local/share/jiggered-backups"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
(umask 077; docker compose exec -T jiggered /jiggered backup - > "$backup_dir/jiggered-backup.zip")
```

Keep ZIP and encrypted ZIP archives outside the source checkout. Git and Docker
ignore these archives as a second guard, not as access control.

Admins can also use **Download ZIP backup** in the Admin tab. It asks for the admin's own password every time, so a
signed-in session left open can't be used to take everyone's data. A copy of your own data alone is **Download everything**
in Account, which can be restored from the same page.

Manual downloads, remote uploads and CLI backups are compressed ZIP files containing `jiggered.db` and restore
instructions. They exclude `.jiggered-service-key`. Optional passphrase encryption wraps the ZIP in authenticated
AES-256-GCM with Argon2id (64 MiB, three passes).
Plain backups end in `.zip`; encrypted backups end in `.zip.enc` and use Jiggered’s restore command rather than
an ordinary ZIP password dialog. Keep the password separately; it cannot be recovered from the backup.
Archives support databases up to 16 GiB. Pre-upgrade and pre-restore safety copies remain raw SQLite files.

For a manual download, choose **Protect this download with an encryption password** and confirm the password.
For scheduled and manual remote uploads, enable **ZIP & encryption** in Backups. The saved backup password is
sealed using the instance’s credential key, never returned by the settings API, and blank input preserves it.
Disable encryption and explicitly remove the saved password to clear it. Changing it affects future backups;
older encrypted files still require their original password.

The CLI reads encryption passwords from a file, keeping them out of command-line arguments:

```sh
jiggered backup /private/jiggered-backups/protected.zip.enc --password-file /private/backup-password
jiggered restore /private/jiggered-backups/protected.zip.enc --password-file /private/backup-password --yes
```

The password file contains the password (at least eight characters); an optional final newline is removed.
Restoring accepts plain ZIP, encrypted ZIP and older raw `.db` backups. ZIP members, sizes and checksums are
validated before database replacement; wrong passwords, altered ciphertext and truncated files are refused.
Encrypted restore stages files beside the destination database, so the source archive can be read-only.

To restore a backup, stop the app first. The backup holds everyone's data, so keep it private. The container runs as a
non-root user, so give it the file without making it readable by everyone: put it somewhere only you can read and mount
that folder, or `chown` it to the container's user (uid 65532 in the distroless image). Don't `chmod a+r` it.

```sh
docker compose stop jiggered
backup_dir="$HOME/.local/share/jiggered-backups"
docker compose run --rm -v "$backup_dir:/backup:ro" jiggered restore /backup/jiggered-backup.zip --yes
docker compose start jiggered
```

It checks the file first (it must have every table its schema version needs), signs everyone out, keeps the database it replaces as `/data/backups/pre-restore-*.db`, and removes the old
`-wal` file. Upgrades also leave a `pre-upgrade-*.db` copy there. Nothing deletes the `backups` folder for you.

### Off-site backups, email and sign-in security

In **Admin → Backups**, configure an existing private S3-compatible bucket, endpoint,
signing region, folder prefix and credentials. AWS S3, R2, B2 and MinIO-style services are supported using
Signature Version 4. Choose path-style addressing for private/compatible services, or virtual-host addressing
for AWS. HTTPS is the default; plain HTTP requires explicit opt-in for a trusted private network. Redirects
are refused so credentials cannot be forwarded to a different endpoint. Use dedicated static credentials;
instance roles, STS session credentials and multipart uploads are not implemented.

- Set an interval from 1 to 8760 hours, pause the schedule, or run **Back up now**. Changing or enabling a schedule
  starts its interval from the save time. A successful manual backup also moves the next scheduled run.
- **Test S3 connection** checks write, read, delete and list permissions using a disposable probe.
- **Verify every upload** reads it back and compares SHA-256 before retention. It is on by default and uses extra
  transfer bandwidth. Retention keeps the latest configured number (30 by default); 0 disables deletion. Only
  correctly named backup objects belonging to this installation and prefix are deleted. Other files and other
  installations are preserved. Bucket versioning or object lock may retain older object versions separately.
- History records upload/verification/retention errors and email delivery separately. Only one backup runs at a
  time. Uploads run in the background with a 30-minute deadline; a restart marks unfinished work interrupted.
  Failed attempts observe the configured interval. Browse shows the latest 200 owned remote backups.
- Give the bucket policy `s3:ListBucket` on the bucket and `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the
  dedicated prefix. Enable the provider's encryption at rest and keep the bucket private. Uploaded ZIP
  archives contain everyone's data. Enable ZIP & encryption to protect them with a separate backup password.

SMTP supports required STARTTLS (usually 587), implicit TLS (usually 465), or an unauthenticated private relay.
All emails share Jiggered branding, an HTML version and a plain-text alternative. Verification and password-reset
emails include a clear action button and a copyable link, without external images or trackers.
TLS certificate verification stays enabled. In **Admin → Email & signup**, configure sender, recipients, credentials and success/failure
preferences, then use **Send test email**. Acceptance by SMTP does not guarantee inbox delivery. Backup alerts
contain operational status, never check-ins or episode content. The local relay option refuses authentication
credentials over plain text.

**Registration & recovery** is closed by default. To enable it, save working SMTP and a trusted HTTPS public
application URL, then opt into registration and/or forgotten-password recovery. Email links use this URL rather
than visitor-supplied Host headers (localhost HTTP is allowed for testing). Registration creates ordinary users
only after email verification. Existing users add a recovery address in **Account → Sign-in security** and verify
it before it becomes active. Links expire after 30 minutes, work once, and are removed by password changes,
account disablement and restores. Reset requests give the same public response for known and unknown addresses.

Users can optionally enable **two-step verification** in Account: scan the locally generated QR code, confirm
an authenticator code, and save the ten recovery codes shown once. It uses standard 30-second, six-digit TOTP;
replayed codes are refused and each recovery code works once. No session is created until both steps succeed.
Password recovery requires a factor if enabled and preserves protection. Disabling 2FA or replacing recovery
codes requires the current password and a valid factor. Other devices are signed out after security changes.
An admin can reset a lost authenticator from People after verifying identity; this is audited and signs out all
of that person's devices. A locked-out sole administrator can use the host-only command:

```sh
docker compose exec jiggered /jiggered user reset-two-factor NAME
```

**Keep the credential key separately.** S3 credentials, SMTP passwords and authenticator secrets are encrypted
with AES-GCM using `/data/.jiggered-service-key` (beside APP_DB for other installations), created with private
permissions. Database snapshots deliberately exclude this key. Store a secure copy separately and restore it
alongside the database on a new host; without it, saved credentials and authenticator secrets cannot be opened.
Recovery codes still work, and operators can re-enter service credentials or reset authenticator protection.
The volume and its credential key must survive container upgrades. Local backup retention is unchanged.

Saving configuration, test actions and downloading remote snapshots require the admin's current password.
Saved secrets are never returned to the UI. Empty secret fields keep existing values; explicit clear controls
remove them. Configuration saves detect conflicting revisions and ask you to reload rather than overwrite.

Download a remote snapshot in Admin and use the existing whole-database restore command. Restore clears
sessions, pending sign-in challenges and emailed tokens; it never signs anyone back in automatically.

### Keeping backups

- **Keep a copy somewhere else.** Copies in `/data/backups` sit in the same volume as the database, so they cover
  mistakes (a bad upgrade, an accidental restore) but not losing the volume or the disk. Take a copy off the machine
  now and then with `backup -` as above, and keep it as private as the database itself: every backup is a full copy
  of everyone's data.
- **Nothing is pruned for you.** `/data/backups` accumulates `pre-upgrade-*.db` (one per upgrade that changes the
  schema), `pre-restore-*.db` (every restore) and any backup you saved there. Each is a whole copy and counts against
  the volume's space. The image has no shell, so look from a throwaway container that mounts the volume read-only, or
  from the host's path to the volume, and delete the old ones by hand once a newer good copy exists elsewhere. Keep the
  newest `pre-upgrade-*.db` until the upgrade has proved itself.
- **Check a backup before you need it.** Restoring into a scratch path proves the file is sound without touching the
  live database: `APP_DB=/some/scratch/path jiggered restore your-backup.db --yes` prints "Restored ..." and exits 0,
  or names the problem and exits 1 leaving nothing behind. In Docker the service's root filesystem is read-only, so the
  scratch path has to be somewhere writable (for example a tmpfs); delete it afterwards, since it is another full copy.

## Security

- bcrypt password check. Ten failed sign-ins per address and ten per account in 15 minutes lock that address or
  account out for the rest of the window, and only a few passwords are checked at once. A guess is counted as it
  starts, so a burst of requests gets no more tries than a slow trickle. A locked account answers exactly like a
  wrong password, so the sign-in page can't be used to find out which usernames exist.
- Random session tokens, stored hashed, HttpOnly cookies, 30-day expiry, at most 25 signed-in devices per account
  (the oldest are signed out beyond that). Signing out, changing the password, disabling or deleting the account
  ends sessions, including one whose sign-in was already under way; you can also sign out other devices yourself.
- Writes need a same-origin header, and browsers' `Sec-Fetch-Site` is checked on every write, which also stops an
  attacker signing you in to their own account. A browser that sends no `Sec-Fetch-Site` is covered at sign-in by
  its `Origin` (or `Referer`) having to match the host it asked, or the one a trusted proxy forwards. A strict Content-Security-Policy; fonts are served from the app,
  so it makes no requests to third parties.
- The app's own scripts, styles and pages are sent gzip-compressed (about two thirds smaller) to browsers that accept it.
  Nothing built from your data is compressed: API answers, exports and the database download are always sent as they
  are, because compressing a reply that mixes private data with text someone else can influence can leak it through
  its size. A reverse proxy that compresses as well, or strips `Accept-Encoding`, is harmless.
- Temporary passwords are random, shown once, and must be replaced at first sign-in.
- Everything an admin or the command line does, and every successful sign-in and wrong password for an existing account,
  is in the activity log (180 days; the newest 10,000 events of each kind). Attempts with unknown names, and attempts
  refused by a lockout, appear only in the server's own log.
- Runs as non-root on a read-only distroless image with all capabilities dropped.

## Development

See [CONTRIBUTING.md](../CONTRIBUTING.md) for local setup, the code map, all eight
browser scenarios and change guidelines. Use Go 1.27.1 and Node 22.13+ or 24+.
There is no frontend build step; npm installs locked development tools only.

```sh
npm ci --prefix test
npm --prefix test run browser:install
npm --prefix test run check
go vet ./...
go test -race ./...             # requires a C compiler
npm --prefix test run browser   # compiles once, runs all eight scenarios
```

CI also runs pinned `govulncheck` and builds without cgo. Docker bases and CI
actions are pinned by immutable digest or commit; update these pins with
verified upstream releases.

## Health warning

This is a personal log, not a medical device. If symptoms come on suddenly, or
with weakness, face drooping, speech problems or a severe headache, call 999.

## Brand

Logo and icons live in `assets/brand/` (SVG plus PNG) and `web/` (app icons). The fonts in `web/fonts/` are
Atkinson Hyperlegible and Bricolage Grotesque, under the SIL Open Font License (see `web/fonts/LICENSE.txt`).

### Completed product audit improvements

The feature review is in [historical feature review](../docs/audits/FEATURES_AUDIT.md); the implementation map is in
[historical implementation map](../docs/audits/AUDIT_IMPLEMENTATION.md).

- **Today:** Other activities accept up to 60 Unicode characters, with an inline counter. Optionally add
  one to your reusable activity list with its cost and group. Capture and list updates save independently;
  check Recovery if either is refused. Help can reopen first-use setup; the allowance review is optional.
- **History:** Selected days can show every activity and episode, edit the day, or prepare a one-day summary.
  Return to the previous period restores filters and calendar selection. Activity details can be included
  in print, or downloaded as one row per activity in CSV. The private-notes checkbox controls episode CSV
  and print consistently; full JSON backups continue to contain your complete data. Empty exports explain
  which filters or dates to adjust. Episode comparisons show previous-period logging coverage.
- **Account:** Storage headroom is visible. Authenticator setup has an explicit Cancel action that clears its
  pending secret. Successful email verification and password recovery lead to a Sign in action. The optional
  weekly review is enabled in Profile: with at least three check-ins during the last completed seven days,
  Today offers a gentle review. Dismiss it for the current week or disable it; no reminder emails are sent.
- **Admin:** Search People and filter account states; view quota headroom, verified recovery readiness and
  two-step status without addresses or secrets. Filter the activity log by exact actor/target, event family
  and inclusive UTC dates; pagination keeps those filters. Events use plain language and service links.
- **Backups:** Last attempt, last usable upload and last verified upload are separate. Retention failure after
  a usable upload is a warning, not loss of the new copy. The latest usable and verified history rows survive
  history pruning. Verification checks transfer integrity, not recovery. The in-app restore guide covers
  plain/encrypted ZIPs, stopping the server, preserving the separate credential key, isolated rehearsals,
  checking restored records and rollback. Rehearsal date/outcome are explicitly self-reported.
- **Account email:** Schema v6 adds a durable encrypted delivery queue using the separate service key.
  Four attempts at most, with 1/2/4-minute retry delays, never beyond token validity. Consumed, superseded
  and expired queued links are discarded; acceptance/exhaustion erases the payload. Restart resumes pending
  sends. SMTP acceptance does not guarantee inbox delivery, and interrupted sends may be duplicated.
  Metadata is kept for seven days and Admin shows purpose/status/attempts without addresses or tokens.
  Public request responses remain generic. Resending creates a new link and invalidates the old one.
- **Optional usage:** Admin → Activity can offer local measurement, disabled by default. Each user separately
  opts in in Account. Only enumerated task names, bounded weekly counts and active-day flags are accepted;
  no health content, IPs, record identifiers or record dates. Weekly pseudonyms rotate using a per-account
  random consent seed. Underlying consent remains linked to the account to support deletion: these data are
  pseudonymous, not anonymous. Reports suppress every event group with fewer than five participants.
  Events are retained for up to 90 days; users can disable and erase theirs, account deletion erases them,
  and admins can clear all counts. No external analytics or new service costs; operators take on local
  storage and privacy responsibility. Counts measure acknowledged sync batches and explicit views/exports,
  not unique user records or clinical outcomes. Save failures count entering a page state with unresolved refused changes, including reloads; they are not a count of all failed HTTP requests. Print requests are separate from generated exports because browser print completion cannot be confirmed. Recovery acknowledgements are counted separately when refused operations save after retry.

Schema upgrades take the existing automatic pre-upgrade backup. Whole-instance restore also clears queued
account-email payloads so restoring cannot resend old authentication links. Do not run an older build on
schema v6. Usage reports and mail retries depend on the running server's maintenance scheduler.

## License and security

Jiggered's application source is available under the [MIT License](../LICENSE).
Bundled fonts retain their [SIL Open Font License notices](../web/fonts/LICENSE.txt).
Dependency licences remain with their respective projects.
See [CONTRIBUTING.md](../CONTRIBUTING.md) for development and
[SECURITY.md](../SECURITY.md) for private vulnerability reporting.
Maintainers preparing a public release should follow the
[publication checklist](../docs/PUBLIC_RELEASE.md).
