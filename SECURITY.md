# Security policy

## Supported versions

Security fixes are made on `main` and included in the next tagged release.
Operators should use the latest stable release. Older releases do not receive
separate security backports; the `dev` image is for evaluation rather than a
stable deployment.

## Report a vulnerability privately

Use [GitHub private vulnerability reporting](https://github.com/jnnngs/jiggered/security/advisories/new).
If GitHub does not offer **Report a vulnerability**, private reporting has not
been enabled yet: do not post the details in a public issue or pull request.
The maintainer must enable private reporting before the public launch.

Include the affected version, deployment settings, impact, and minimal steps
to reproduce using synthetic accounts and records. Never attach real health
records, database backups, passwords, service keys or live tokens. Coordinate
public disclosure through the private advisory. No response-time guarantee
or bug bounty is offered.

## Deployment boundaries

Use HTTPS and keep the backend private. Trust only the actual reverse proxy
addresses. Registration and email recovery are optional instance settings.
Server operators can access databases and backups; administrators can reset
accounts and download whole-instance backups. This is not end-to-end encryption.
Keep the separate service key and backup encryption passwords secure. See the
README for installation, access controls and backup/restore procedures.
