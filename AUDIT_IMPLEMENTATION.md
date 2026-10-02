# Product audit implementation

All 18 recommendations from the 2026-10-02 source audit are implemented. This map refers to the audit IDs,
not IDs from earlier historical audits. Mobile alignment and spacing fixes accompany these changes.

| ID       | Delivered behavior                                                                        | Main implementation                                               |
| -------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| FEAT-001 | One private-note choice for print and episode CSV; full backups remain complete           | history.js, model.js                                              |
| FEAT-002 | 60 Unicode character validation and inline counter                                        | today.js, index.html                                              |
| FEAT-003 | Readable service/security audit events and relevant navigation                            | admin.js                                                          |
| FEAT-004 | Verification/reset completion with explicit Sign in action                                | login.js                                                          |
| FEAT-005 | Cancel invalidates pending authenticator setup and preserves enabled protection           | security.js, two_factor.go                                        |
| FEAT-006 | Record counts and disabled empty export buttons with filter guidance                      | history.js                                                        |
| FEAT-007 | Separate last attempt/usable/verified uploads and retention warnings                      | remote_services.go, services.js                                   |
| FEAT-008 | Optional allowance step, explicit keep-default action, setup reopening in Help            | today.js, help.js                                                 |
| FEAT-009 | Previous-period check-in coverage beside episode comparisons                              | history.js                                                        |
| FEAT-010 | Save an Other activity as a reusable choice, independently of capture                     | today.js                                                          |
| FEAT-011 | Server actor/target, family and UTC date filters with cursor pagination                   | admin.go, admin.js                                                |
| FEAT-012 | Searchable People, security readiness and quota headroom; own Account usage               | users.go, account.go, admin.js, account.js                        |
| FEAT-013 | Full selected-day records, one-day sharing and return to prior period                     | history-matrix.js, history.js                                     |
| FEAT-014 | Optional printable activity detail and per-activity CSV                                   | history.js, model.js                                              |
| FEAT-015 | Encrypted persistent account-email queue, bounded retries/expiry and safe operator status | product_improvements.go, remote_services.go, security_accounts.go |
| FEAT-016 | In-app server restore guide with isolated rehearsal and self-reported outcome             | services.js, remote_services.go                                   |
| FEAT-017 | Optional weekly in-app review, dismissal and disable                                      | today.js, profile.js                                              |
| FEAT-018 | Off-by-default local task measurement, per-user opt-in/deletion and cohort suppression    | product_improvements.go, app.js, sync.js, account.js, admin.js    |

## Validation

`test/browser-product-improvements.cjs` exercises actual UI modules with an in-memory API fixture at 320,
375, 768, 960 and 1280 pixels. It checks profile control row gaps, History stacking/alignment, horizontal
bounds, activity button padding, Unicode validation, reusable choices, all-day records, one-day sharing and
return, private-note consistency, activity print detail and disabled empty exports. The existing energy
language browser scenario also checks cross-device preferences and dark/mobile layout.

`test/product-improvements.test.mjs` checks CSV privacy/escaping, repeated activities and recovery costs,
and safe opt-in defaults. `product_improvements_test.go` covers default-off collection, consent,
small-cohort suppression, deletion, encrypted/superseded mail, cancellation and backup status separation.
The existing Go race tests, browser suites and upgrade/restore tests run in repository CI.

## Operational implications

Schema v6 is an appended migration. Automatic pre-upgrade snapshots remain in place. Preserve the separate
service key and archive password securely. SMTP may deliver an interrupted send more than once; accepted
means the relay accepted it. No browser restore of the whole instance was introduced. Rehearsal status is
self-reported. Optional analytics adds local storage/privacy responsibility, uses weekly pseudonyms and
never changes a person's recording flow if collection fails. Both instance enablement and individual
consent are required. Full JSON exports retain all private content and must be kept private.
