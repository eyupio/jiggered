<p align="center">
  <img src="assets/brand/logo.svg" alt="Jiggered" width="360">
</p>

<p align="center"><strong>Understand your energy. Plan your day. Keep your own record.</strong></p>
<p align="center">Daily energy planning and symptom tracking, on infrastructure you control.</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/ADMINISTRATION.md">Administration guide</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

## About Jiggered

**Jiggered** is Yorkshire for “worn out”. It is a self-hosted application for recording daily energy, planning activities and recovery, and keeping a history of symptom episodes.

Use points or the optional Spoon Theory language to make your available energy and commitments easier to see. Review what you planned alongside what actually happened, and export a record when you want to share it.

Built with Go, SQLite and an embedded JavaScript frontend, Jiggered runs in a single container with no separate database service or frontend build step. It supports individual use and multiple accounts, each with their own records and preferences.

## Features

| Area | What you can do |
| --- | --- |
| **Today** | Check in with green, amber or red; account for poor sleep; log activities and recovery; see available, planned and used energy. Correct earlier days when needed. |
| **Plan** | Plan one, three or seven days ahead, repeat activities, estimate daily allowances and see projected balances before and after recovery. Confirm completed activities with their actual cost and time. |
| **Episodes** | Record symptoms, onset, duration, possible triggers and notes. Track ongoing episodes and update them later. |
| **History** | Explore an activity calendar, charts and records over preset or custom periods. Filter your history, compare planned and actual activity costs, and prepare CSV exports or printable summaries. |
| **Personalisation** | Choose points or spoons, arrange personal activities and lists, set budgets, and select light, dark or device appearance. |
| **Offline access** | Add Jiggered to your home screen. Record changes offline and sync when connectivity returns, with visible save status and tools for resolving conflicts. |
| **Account security** | Manage signed-in devices, verified recovery email and optional authenticator-based two-step verification with recovery codes. |
| **Administration** | Manage accounts and shared defaults, configure email and registration, review operational activity, and schedule encrypted backups to S3-compatible storage. |

### Planning that stays separate from your records

Planned activities reserve energy without counting as actual usage. Marking an activity **Done** confirms its details, logs it once and releases the reservation. Unfinished plans remain plans.

Each day has its own allowance; balances do not carry forward. Recovery values and activity costs are personal estimates, and the charts describe your records rather than establish medical causes.

## Quick start

### Requirements

- Docker with Docker Compose **2.24 or later**.
- An HTTPS reverse proxy for deployment.
- Access to this repository and either the published container image or a local build.

### 1. Get the project

```sh
git clone https://github.com/jnnngs/jiggered.git
cd jiggered
```

### 2. Start Jiggered and create an administrator

```sh
docker compose up -d
docker compose exec jiggered /jiggered user add admin --admin
```

The command displays a temporary password once. No `.env` file is required for the default configuration.

Compose binds the service to **127.0.0.1:8080** and stores data in the persistent `jiggered-data` volume. Session cookies require HTTPS by default.

If the image is unavailable or its package is private, build it locally before starting:

```sh
docker build -t ghcr.io/jnnngs/jiggered:latest .
```

### 3. Configure HTTPS

For Caddy running on the same host:

```caddyfile
jiggered.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Replace the hostname with your own. Open `https://jiggered.example.com/login`, sign in as `admin` and replace the temporary password.

In **Admin → Connection**, configure the actual trusted proxy CIDRs before enabling reverse-proxy support. Trust depends on the proxy's source address as seen by Jiggered; containerised proxies may use a different address from host proxies. See the [proxy configuration guide](docs/ADMINISTRATION.md#configuration).

### 4. Make it yours

Set your energy allowance and preferred language in **Account**, customise your activity lists, and complete your first check-in. Registration is closed by default; administrators can add accounts directly or enable verified-email signup after configuring SMTP and a trusted public application URL.

For local HTTP development, follow [CONTRIBUTING.md](CONTRIBUTING.md#run-locally).

## Deployment and configuration

The default image is `ghcr.io/jnnngs/jiggered:latest`, built for **amd64** and **arm64**. Package visibility is separate from repository visibility.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_DB` | `/data/jiggered.db` | SQLite database path. |
| `APP_ADDR` | `:8080` | Server listen address. |
| `JIGGERED_TAG` | `latest` | Compose image tag. Use a release version to pin deployment, or `dev` to follow main. |
| `APP_PUBLIC_ORIGIN` | Unset | Canonical origin for public-page metadata. |
| `APP_PUBLIC_INDEXING` | Disabled | Opt public pages into search indexing; requires a configured public origin. |

Account, proxy, email and backup settings are stored in the database. Legacy environment settings seed missing values once; they do not override saved settings.

Check container health with `docker compose ps`. Before upgrading, take a consistent backup and preserve the separate credential key. Schema-changing upgrades create a local safety copy; do not run an older build against an upgraded database.

Read the [administration guide](docs/ADMINISTRATION.md) for image tags, upgrades, CLI commands, proxy trust, public-page indexing and recovery procedures.

## Backups and data ownership

Users can export and restore their own records from **Account**. Administrators can download whole-instance ZIP backups or configure scheduled uploads to a private S3-compatible bucket, with optional encryption, upload verification and retention controls.

For a consistent local backup while the service is running:

```sh
docker compose exec jiggered /jiggered backup
```

This saves an archive under `/data/backups`. Copy backups off the host: a backup in the same volume does not protect against losing that volume. Do not back up a running instance by copying `jiggered.db` alone; recent writes may be in SQLite's WAL file.

**Preserve `/data/.jiggered-service-key` separately.** Database backups exclude this key, which is needed to decrypt saved service credentials and authenticator secrets on a replacement host. Keep encryption passwords separately too.

Whole-instance restores require the server to be stopped and sign everyone out. See [backup and restore](docs/ADMINISTRATION.md#backup-and-restore) for permissions, encrypted archives and restore rehearsals.

## Privacy and trust

Personal records are separated by account. Admin screens expose account and operational metadata, not the contents of other people's logs. This is an application access boundary, not end-to-end encryption:

- Administrators can download backups containing everyone's records and reset account security.
- Anyone with access to the server or database volume can read the unencrypted database.
- Offline access stores sensitive, unencrypted copies on the device. Use a device you trust; an offline device learns about remote session revocation only after reconnecting.

Offline changes remain queued until the server acknowledges them. Recovery tools retain refused changes for review, but browser eviction or device failure can still remove local copies. Resolve queued changes before exporting or restoring account data.

Optional local usage measurement is disabled by default and requires separate user consent. It uses bounded task counts, excludes health content and has no external analytics service. See the [detailed privacy and recovery guidance](docs/ADMINISTRATION.md).

## Help and contributions

The in-app **Help** tab provides searchable guidance for energy tracking, planning, episodes, privacy and saving problems, including offline access.

- [Contributing](CONTRIBUTING.md): local setup, code map and validation commands.
- [Security policy](SECURITY.md): private vulnerability reporting.
- [Administration guide](docs/ADMINISTRATION.md): deployment and operational reference.
- [Publication checklist](docs/PUBLIC_RELEASE.md): preparation for a public release.

Jiggered is a personal record and planning tool, not a medical device or a substitute for medical advice. For a medical emergency, contact your local emergency service.

## License

Jiggered's application source is [MIT licensed](LICENSE). Bundled Atkinson Hyperlegible and Bricolage Grotesque fonts retain their [SIL Open Font License notices](web/fonts/LICENSE.txt).
