# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People living with chronic illness or fatigue — ME/CFS, long COVID, chronic pain — who pace daily energy and keep a record of symptoms. Usually on a phone, on their own server or on an instance run by someone they trust. A shared instance may serve several people, each with a private Account, managed by an Admin.

## Product Purpose

Jiggered records daily energy, plans activities and recovery, and keeps a history of symptom episodes, so a person can understand what a day allowed, spend within it, and keep their own record. It is a personal record and planning tool, not a medical device.

## Positioning

Account-private pacing arithmetic inside a self-hosted app: the Check-in and Poor sleep lower the day's Allowance, Planned entries hold energy without counting as spending, and Recoveries add it back. Privacy is structural — the server treats personal records as opaque JSON and an Admin sees Account metadata only.

## Operating Context

- Used daily in a browser on phone, tablet or desktop; installable to the home screen.
- Works offline: Changes queue on the device and replay on reconnect, with visible save status and Held changes for refusals.
- Instances are run by a self-hoster or an operator Admin; Registration is closed by default, with accounts added by an Admin, the CLI, or verified-email signup when enabled.
- Admins manage Accounts, Shared defaults, email, registration, public pages and encrypted backups.
- Deployment is one container behind HTTPS, configured from the database.

## Capabilities and Constraints

- **Today**: Green/Amber/Red Check-in, Poor sleep, Entries with costs and times, Recoveries, correction of earlier Days.
- **Plan**: one, three or seven days ahead; Planned entries, repeat activities, Done with actual cost, Shortfall and Projected.
- **Episodes**: onset, optional end, Symptoms, Triggers and notes; Ongoing episodes stay open.
- **History**: list, calendar and heatmap views, charts, filters, CSV Export and printable Summary.
- **Tools**: self-contained modules; currently Fretboard.
- **Accounts**: password login, optional authenticator two-step with Recovery codes, verified recovery email, Signed-in devices.
- **Technical constraints**: Go and SQLite in a single binary, pure Go (no cgo), no frontend build step, single connection, append-only migrations, strict CSP and same-origin writes.
- **Privacy limits**: the database is unencrypted; offline device copies are unencrypted; an Admin's whole-instance Backup is the one documented exception to metadata-only access.

## Brand Commitments

- Name **Jiggered**, Yorkshire for "worn out"; logo and marks in `assets/brand/`.
- Voice: plain, warm, non-clinical British English; it never implies the app knows a cause.
- "A personal record and planning tool, not a medical device or a substitute for medical advice" is a product statement, kept in the README and public pages.
- Free to use; source MIT licensed; bundled fonts retain their SIL notices.

## Evidence on Hand

- `README.md` feature table, health warning and privacy explanation.
- `GLOSSARY.md` as the canonical domain language.
- `docs/adr/0001` and `0002` for replayable Changes and opaque records.
- `web/public/` for the signed-out pages and their copy.
- No testimonials, customer counts, benchmarks, pricing tiers or medical evidence exist; future work must not fabricate them.

## Product Principles

1. Privacy is structural, not a promise: Admins see metadata; the whole-instance Backup is the only documented exception.
2. A record describes what happened; it never establishes a cause or gives medical advice.
3. Plans and records stay separate: an unfinished Plan is never a skipped day, and an unlogged day is a gap, never zero.
4. The person owns their data: self-hosted, exportable, MIT licensed.
5. Offline is first-class: Changes queue, conflicts replay, and refused Changes are Held, never shown as saved.

## Accessibility & Inclusion

Target WCAG 2.2 AA for the app and public pages: contrast, keyboard and focus, reduced motion, and reflow. The audience manages fatigue and brain fog, so legible type (Atkinson Hyperlegible is bundled), generous touch targets and calm, unhurried flows matter.
