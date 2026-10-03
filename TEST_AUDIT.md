# Test Suite Audit

> **Update (same day): every finding below has been fixed.** The five critical mutations from Pass 1 now
> each fail the suite. New Go tests: two-factor disable/regenerate teardown, admin HTTP two-factor reset
> (including self/factor/password refusals), recovery-email change (verify, supersede, password binding),
> reset-link binding, public-auth write guard and rate limit, duplicate-registration silence, pending-link
> cap, verify-time registration gate, auth-options availability, challenge attempt cap, same-code race,
> two-step IP lockout, `recoverInterruptedWork`, `prune`, `serviceScheduler`, SMTP failure mapping per stage
> (including a real TLS listener for AUTH), `mailStatus`, migration rollback, concurrent migration, snapshot
> destination guards, S3 probe tamper/delete/list failures, backup verification/retention failures, listing
> truncation, busy sign-in flood, limiter full-map fallback, `adminUsage` aggregation, and a full start/stop
> cycle through the extracted `run(ctx)`. Browser coverage now walks two-step disable/regenerate and the
> recovery-email change through the real Account panel. Production changes (all small, for testability):
> `run(ctx)` and `maintain(ctx)` extracted from `main`, `recoverInterruptedWork` extracted from the
> scheduler, `hashWait` as a variable, and the log now prints the bound address. CI publishes a per-function
> coverage summary; a logic test keeps the browser runner's scenario list in step with the files on disk.
> Totals moved from 78.7% to 81.2% of statements; more to the point,
> `security_accounts.go` 46.2%→68.2%, `two_factor.go` 50.7%→69.0%,
> `notifications.go` 73.2%→89.3%, `serviceScheduler`/`prune`/`maintain` 0%→100%. Full race suite,
> frontend check, all eleven browser scenarios and the public check pass.

Audit date: 2025-10-03 (HEAD of `main`, Go 1.27.1, Node 22). Both passes were run
against the live suite: full coverage runs, a `-race` run, the frontend logic
tests, all eleven browser scenarios plus `browser-public.cjs`, and five
hand-made logic mutations to measure false confidence (all mutations were
reverted; the tree is clean and green).

## Summary

| Metric | Result |
| --- | --- |
| Go statement coverage (main package) | **78.7%** (`internal/qr`: 99.6%) |
| Go suite runtime | ~15–40 s without race (first run includes compiling SQLite); **180 s with `-race`**; all pass |
| Frontend logic tests (`npm --prefix test run check`) | 122 tests, ~10 s, all pass |
| Browser suite (11 scenarios + public check) | all pass locally; CI budget 20 min |
| Flaky tests observed | none in three Go runs (two `-race`-equivalent), one frontend run, one full browser run |
| CI | PR-blocking: gofmt, govulncheck, vet, build, `go test -race`, frontend check, all browser scenarios; image build is gated on both jobs |

**Overall verdict: an unusually strong suite with three genuine holes, all in
account security.** The pyramid is healthy: real integration tests over
`httptest` + real SQLite temp databases (no DB mocks, no snapshots), fast unit
tests for the frontend data/sync layer with fake `fetch`, and thin, purposeful
E2E browser scenarios. Docs, sync, backups, isolation and sign-in rate limiting
are tested to a standard I rarely see. However, the 2FA/registration/recovery
surface (`security_accounts.go` 46.2%, `two_factor.go` 50.7%) is the least
covered code in the repository, it is the highest-risk code in the repository,
and **five independent security-relevant mutations pass the entire Go suite
untouched** (details below). The suite would catch a broken day-entry save; it
would not catch a broken two-factor disable or a reset link that outlives a
password change.

Mutation results (each applied, full `go test` run, reverted):

1. `resetPasswordToken`: dropped `u.password_hash=t.payload` → **suite green**.
2. `registerAccount`: sent verification mail for duplicate usernames/emails → **suite green**.
3. `adminResetTwoFactor`: removed the reset-your-own-2FA guard → **suite green**.
4. `authPublic`: removed the `X-Requested-With`/`sameSiteLogin` write guard → **suite green**.
5. `twoFactorAction("disable")`: stopped wiping the secret, recovery codes and login challenges → **suite green**.

Risk-weighted coverage of the least-covered files:

| File | Coverage | Risk |
| --- | --- | --- |
| `security_accounts.go` | 46.2% | registration, email verification, password reset — account creation |
| `two_factor.go` | 50.7% | second factor, recovery codes — account takeover defence |
| `remote_services.go` | 70.1% | remote backups, credential sealing, scheduler |
| `product_improvements.go` | 73.2% | account mail queue, usage consent |
| `db.go` | 73.6% | schema migrations — data integrity |
| `notifications.go` | 73.2% | SMTP delivery |
| `restore.go` / `backup.go` | 75.0% / 76.9% | data restore |
| `docs.go`, `auth.go`, `validate.go` | 85.4% / 89.8% / 93.7% | core data, sign-in — well covered |

---

## 1. Critical — high-risk code paths with no meaningful test protection

### C1. Two-factor disable and regenerate are untested everywhere

- **Pass**: Coverage review + bug-hunter walkthrough (mutation-confirmed)
- **Where**: `two_factor.go:275–296` (`twoFactorAction` cases `"disable"`,
  `"regenerate"`, 47.2% covered); UI side `web/security.js` (no browser test
  clicks `#security-disable` or `#security-regenerate`). Existing tests
  (`two_factor_test.go`, `test/browser-accounts.cjs`) cover setup, enable,
  recovery-code sign-in and replay — never disable or regenerate.
- **Problem**: "Disable" is the security-critical half of the feature: it must
  wipe the sealed secret, delete all recovery codes, clear login challenges and
  sign out other devices. **A mutation that disables 2FA without wiping any of
  that passes the entire Go suite.** A realistic regression (e.g. dropping the
  `DELETE FROM recovery_codes` statement, or forgetting the session revocation
  that the message promises) ships silently. Old recovery codes for a
  "disabled" account are exactly the artifact a later bug could resurrect.
- **Fix**: Go integration tests in `two_factor_test.go` using the existing
  `enableTestFactor` helper; plus one browser assertion in
  `browser-accounts.cjs` clicking the real button.
- **Example**:
  - `TestDisableTwoFactorWipesSecretCodesChallengesAndOtherSessions` — enable,
    sign in on a second client, disable with a TOTP code; assert via SQL:
    `secret=''`, `enabled=0`, `last_step=-1`, `pending_secret=''`,
    `recovery_codes` count 0, `login_challenges` count 0, second client now
    401, current session still 200, audit row `two_factor_disable`.
  - `TestDisableTwoFactorRefusesWrongCodeAndKeepsEverything` — wrong code →
    400, and factor stays enabled (no partial wipe).
  - `TestDisableRequiresAFactorAndPassword` — empty/missing code → 400;
    wrong password → 403/401 without touching the row.
  - `TestRegenerateRecoveryCodesInvalidatesOldOnes` — regenerate with a code;
    assert 10 new codes returned, old codes now 400 at sign-in, count is 10.
  - `TestRecoveryCodeRegenerationIsAudited`.

### C2. The authenticated recovery-email change flow has no test at all

- **Pass**: Bug-hunter walkthrough
- **Where**: `security_accounts.go:364 requestRecoveryEmail` (0%),
  `security_accounts.go:248–262` (`verifyEmailToken` purpose `'email'`
  branch — the only code that attaches a new address to an account),
  `security_accounts.go:348 securityStatus` (0% in Go). `web/security.js`
  `#security-email-form` is not exercised by any browser scenario.
- **Problem**: This is the flow that decides which address password-reset links
  are mailed to — i.e. the account-recovery trust anchor. The branch contains a
  deliberate anti-hijack check (`current != parts[1]`: an email-change token
  dies when the password changes) and a supersede rule (`DELETE ... purpose
  IN ('email','reset')`), and **none of it is executed by any test, Go or
  browser**. If the password-binding comparison regressed, a stale change-email
  link could re-point recovery to an attacker's address and nothing would fail.
- **Fix**: Integration test with the existing `fakeSMTP` +
  `saveTestServices` helpers, mirroring
  `TestRegistrationVerificationRecoveryAndSingleUse`; one browser assertion for
  the form.
- **Example**:
  - `TestRecoveryEmailChangeVerifiesSupersedesAndBindsToPassword` —
    request change → token in mail; verify → `account_security.email` updated;
    old token replay → 400; a second request supersedes the first (first link
    400); change the password → outstanding link now 400 (the binding check);
    duplicate email on another account → 409; rate limit (4th request → 429).
  - `TestSecurityStatusReportsEmailTwoFactorAndCodesLeft`.

### C3. The admin HTTP two-factor reset endpoint is 0% covered in Go

- **Pass**: Coverage review + bug-hunter walkthrough (mutation-confirmed)
- **Where**: `two_factor.go:333 adminResetTwoFactor` (0%), route
  `POST /api/admin/users/{name}/two-factor-reset`. The CLI path
  (`runUserCommand reset-two-factor`) is tested
  (`TestCLIFactorResetIsAuditedAndRevokesSessions`), and one happy-path browser
  assertion exists in `browser-accounts.cjs`; the HTTP handler itself — password
  re-verification, `verifiedPasswordTx`, own-account guard, 2FA of the *admin*
  consumed with `optional=true`, factor rate limit — has no test.
- **Problem**: **Removing the "you cannot reset your own two-factor here" guard
  passes the entire Go suite.** Realistic regressions that would ship: the
  reset wiping the admin's own factor instead of the target's, the
  `X-Jiggered-Password` check being dropped (only the browser test's happy
  path would notice), or session revocation of the *target* being lost. The
  browser scenario asserts one outcome (member session 401) and nothing about
  refusal paths.
- **Fix**: Go integration tests; keep the browser assertion for the dialog only.
- **Example**:
  - `TestAdminResetTwoFactorHappyPath` — full state assertions (as the CLI
    test does: enabled=0, sessions/codes/challenges 0, audit row).
  - `TestAdminResetTwoFactorRefusesSelf` — admin names themselves → 400,
    nothing changes.
  - `TestAdminResetTwoFactorRequiresFreshPasswordAndOwnFactor` — wrong
    password → 401/403 with target intact; admin with 2FA enabled and wrong
    code → 400 and target intact; admin *without* 2FA succeeds
    (`optional=true` semantics).
  - `TestAdminResetTwoFactorUnknownUser` → 404; non-admin client → 403.

### C4. Reset tokens are not bound to the password they were issued with — and nothing would notice

- **Pass**: Bug-hunter walkthrough (mutation-confirmed)
- **Where**: `security_accounts.go:278 resetPasswordToken`
  (`AND u.password_hash=t.payload`, 61.5%); existing tests
  `TestPasswordRecoveryRequiresAndPreservesFactor`,
  `TestRegistrationVerificationRecoveryAndSingleUse`.
- **Problem**: The reset link is deliberately tied to the password hash current
  at issue time, so a link survives neither a completed reset (tested, via
  token deletion) nor *any other password change* (untested). **Dropping the
  binding from the SQL passes the whole suite.** The parallel property for
  login challenges *is* tested
  (`TestTwoFactorChallengeExpiresAndPasswordResetInvalidates` asserts a
  challenge dies on password change), which shows the intent — the reset-token
  half was just never written.
- **Fix**: One assertion inside the existing recovery test, plus a Go test:
  - `TestResetTokenDiesWhenPasswordChangedMeanwhile` — request reset link,
    then change the password through `/api/me/password`; use the old link →
    400 and the password is unchanged; request a fresh link → succeeds.

### C5. The public-auth write guard and registration gating are untested

- **Pass**: Coverage review + bug-hunter walkthrough (two mutations confirmed)
- **Where**: `security_accounts.go:35 authPublic` (42.9%) — the
  `X-Requested-With` + `sameSiteLogin` guard on register / forgot / reset /
  verify / two-step; `registerAccount` (58.5%): duplicate-username/email
  handling, the 1000-pending-token DoS cap, `verifyEmailToken`'s
  "registration has been closed" gate (line 224); `publicAuthOptions` (0% in
  Go). Existing: `TestCrossSiteWritesAreRefused` covers only the global
  `rejectCrossSite` middleware; `TestExpiredRegistrationAndClosedRegistration`
  covers closed-registration at *request* time.
- **Problem**: **Removing the write guard in `authPublic` passes the entire Go
  suite.** The test client always sends the right header, so a regression that
  stops *requiring* it — or stops rate-limiting public endpoints (`429` branch)
  — is invisible; only SameSite=Strict cookies would remain between a
  cross-site form post and account mail. Likewise **sending verification mail
  for duplicate usernames/emails passes the suite**: the duplicate branch is
  only distinguished by whether the queue gets a message, and no test observes
  the queue for the duplicate case. The pending-token cap protects the mail
  queue from unverified floods and is untested.
- **Fix**:
  - `TestPublicAuthWritesNeedTheHeaderAndSameSite` — POST `/api/auth/register`
    and `/api/auth/two-step` without `X-Requested-With` → 403; with a
    cross-site `Origin` → 403; with header and same-origin → not 403.
  - `TestPublicAuthRateLimit` — exceed `publicLimit` (it is a field: swap in
    `newLoginLimiter(2, ...)`) → 429 with the friendly message.
  - `TestDuplicateRegistrationSendsNoMailAndStaysGeneric` — register an
    existing username and an existing email; assert the SMTP channel receives
    nothing and the response is byte-identical to the unknown case.
  - `TestPendingRegistrationCap` — seed 1000 unexpired `auth_tokens` → 503,
    and nothing is queued.
  - `TestVerifyRefusesWhenRegistrationClosedAfterIssue` — issue a token with
    registration on, close it, verify → 403, no account created.
  - `TestAuthOptionsReportAvailability` (or fold into the browser test) —
    registration/recovery flags true only when email is enabled.

---

## 2. High impact — significant gaps, misleading tests, or eroding trust

### H1. Background-job startup recovery and pruning are 0% covered

- **Pass**: Coverage review
- **Where**: `main.go:200 maintain` (0%) → `users.go:341 prune`;
  `remote_services.go:715 serviceScheduler` (0%) — the three startup
  statements that recover a crashed server: account mail `'sending'` →
  queued/failed (payload and token erased at the attempt cap), backup runs
  `'running'` → `'interrupted'`, plus weekly cleanup of mail/usage rows.
- **Problem**: These are the crash-recovery paths for mail and backups. A
  regression here strands every in-flight account email in `'sending'` forever
  (or, worse, resets attempts and loops), or lets "running" backup runs lie
  about a possibly half-uploaded object until the next one overwrites the
  history. Expired `auth_tokens`/`login_challenges` pruning is defence-in-depth
  (read paths check expiry), but a broken `prune` is silent. None of it can be
  exercised by the browser suite, so it has *no* coverage anywhere.
- **Fix**: Direct unit tests — both functions are pure DB procedures on a
  `testEnv`; no need to run the loops.
- **Example**:
  - `TestSchedulerStartupRecovery` — insert mail rows `status='sending'`
    with attempts 2 and 4 and a run `status='running'`; call the three
    statements (or factor `serviceScheduler`'s prologue into
    `recoverInterruptedWork(ctx)` and call that); assert queued/failed with
    `payload=''`, `interrupted` with the message, and the attempt-4 row's
    token erased.
  - `TestPruneExpiresSessionsTokensChallengesAndAudit` — seed rows just
    before/after each cutoff; run `prune()`; assert exact survivor sets
    (including the audit retention boundary and the self-service cap).

### H2. SMTP failure mapping is mostly untested

- **Pass**: Coverage review
- **Where**: `notifications.go` (~all error branches uncovered: greeting,
  STARTTLS, auth refused, sender/recipient rejected, transfer failed),
  `sendBrandedNotification` 72.7%. Existing `fakeSMTP` accepts everything, so
  only the happy path and one fail-closed validation test exist.
- **Problem**: Every one of these branches is a user-facing message an admin
  diagnoses their relay by. If the error mapping regressed (e.g. auth failure
  reported as "SMTP refused the message"), the admin UI misleads and mail
  silently keeps failing. Also `product_improvements.go:150 mailStatus` (46%)
  is the admin's only window into the queue.
- **Fix**: A parameterised fake SMTP server whose scripted reply fails at a
  chosen stage (greeting / EHLO / AUTH / MAIL / RCPT / DATA / final dot), with
  a table test asserting the exact error string per stage. Cover
  `mailStatus`'s status transitions (queued/sending/sent/failed/expired,
  `next_at`).
- **Example**: `TestSendNotificationErrorPerStage`, `TestMailStatusReportsQueue`.

### H3. Migration failure and concurrency branches are untested

- **Pass**: Coverage review
- **Where**: `db.go migrate` (61.8%): the in-transaction version re-read
  (`now > v continue` — another process migrated while we waited), migration
  failure rollback (`tx.Rollback()` at line 108), `snapshotBeforeMigrating`
  error paths (backup dir creation, `VACUUM INTO` failure, empty/`":memory:"`
  dest guard), `migrateAccounts` error branches. Existing tests
  (`migrate_test.go`) are good: legacy adoption, first-admin requirement,
  idempotence, newer-schema refusal, no-pile-up on refusal.
- **Problem**: A half-applied migration is the classic way a schema upgrade
  bricks an install. The suite proves the happy paths and the refusal paths but
  never that a migration that fails mid-way leaves `user_version` unchanged and
  the database intact. The concurrent-migration branch (CLI and server racing)
  is written but unexercised.
- **Fix**:
  - `TestFailedMigrationRollsBackAndKeepsVersion` — append a temporary
    failing migration (or inject one via a test-only slice) that errors after
    creating a table; assert `user_version` unchanged, table absent, and a
    retry with the real migrations still succeeds.
  - `TestConcurrentOpenMigratesOnce` — two goroutines `openDB` the same
    fresh path; assert one performs the upgrade and both end at the current
    version (uses `_txlock=immediate`; keep it in the race suite).
  - `TestSnapshotBeforeMigratingRefusesNonFileDest` — unit test the
    `""`/`":memory:"`/`file:` guards in `snapshot`.

### H4. Admin backup/S3 failure branches partially uncovered

- **Pass**: Coverage review
- **Where**: `remote_services.go:477–536` (`adminServiceAction` test-email and
  S3 test: probe tamper detection "changed in transit", delete-permission
  error, owned-object listing and the `truncated > 200` flag),
  `runRemoteBackup` 642–669 (upload verified but retention listing/deletion
  failed — user-facing warnings).
- **Problem**: The S3 "test connection" flow is what admins trust to tell them
  the bucket works; its tamper and permission diagnostics are untested, so a
  regression could report success against a broken bucket. Retention-failure
  warnings keep data (fail-safe) but if the branch inverted, backups could be
  pruned after an unverified upload.
- **Fix**: Extend the existing `fakeS3` (already verifies SigV4 and digests)
  with failure modes: `X-Amz-Meta` tamper on GET, 403 on DELETE, >200
  objects in the prefix. Table test over `adminServiceAction`.
- **Example**: `TestS3TestDetectsTamperedProbe`, `TestS3TestReportsMissingDeletePermission`,
  `TestBackupListingTruncatesAt200`, `TestRetentionFailureKeepsVerifiedBackup`.

### H5. Two-factor challenge edge branches untested in the handler layer

- **Pass**: Coverage review
- **Where**: `two_factor.go` — `finishTwoFactor` 64.8%: the missing
  `X-Requested-With` 403, the IP-budget 429, `attempts<5` per-challenge cap;
  `consumeFactor` 65.5%: the guarded-update race branch (`last_step<? ... AND
  enabled=1` returning 0 rows), "not enabled" with `optional=false`.
- **Problem**: The `attempts<5` cap and the guarded update are
  defence-in-depth against concurrent replay; neither is load-bearing alone,
  which is exactly why they erode silently. The 403 guard is the same class as
  C5 but for the two-step endpoint.
- **Fix**:
  - `TestTwoStepEndpointNeedsTheHeader` (403 without `X-Requested-With`).
  - `TestChallengeLocksAfterFiveWrongCodes` — five bad codes on one challenge
    → 400 "expired" on the sixth even with a *correct* code; a fresh
    password login re-arms.
  - `TestSameCodeCannotBeUsedConcurrentlyTwice` — two goroutines finishing
    two challenges for the same account with the same code; exactly one
    session is created (the guarded update must lose one).
  - `TestTwoStepRequiredWhenFactorEnabledButMissing` — direct `consumeFactor`
    with `optional=false` on a factor-less account.

### H6. `errBusy` and limiter-capacity edges in sign-in are untested

- **Pass**: Coverage review
- **Where**: `auth.go:302/312/326` — hash-semaphore exhaustion ("too many
  sign-ins at once", redirect `?e=busy`), `checkHash`'s `errBusy`, and the
  limiter's full-bucket fallback (auth.go:522).
- **Problem**: A regression here turns a flood of logins into 500s (or removes
  the CPU guard). Low likelihood, but the paths are the DoS story of the login
  endpoint, and the suite covers every other limiter property meticulously.
- **Fix**: `TestFloodOfSignInsGetsBusyNot500` — shrink `hashSem` to 1, hold it,
    attempt a login → `/login?e=busy` redirect, not a 500; release → succeeds.
    `TestLimiterFullOfLiveEntriesLetsThrough` — unit test on `newLoginLimiter`.

### H7. `web/security.js` UI has no browser coverage for its risky actions

- **Pass**: Bug-hunter walkthrough
- **Where**: `web/security.js` — the disable/regenerate/email-change forms.
  `browser-accounts.cjs` covers setup, enable, code sign-in and admin reset
  only.
- **Problem**: The UI layer (confirm prompts, showing new codes exactly once,
  hiding forms when email is unavailable) can regress while all Go tests stay
  green — and since the *server* halves are also untested (C1, C2), the whole
  vertical slice is dark.
- **Fix**: One focused browser scenario (or an extension of
  `browser-accounts.cjs`): disable two-step with a code and assert the panel
  returns to "Password only"; regenerate codes and assert old ones are refused
  and new ones shown once; request an email change through the form and
  complete verification.

---

## 3. Nice to have — quality, speed, maintainability

### N1. Browser scenario list is maintained by hand
`test/support/run-browser.cjs` hardcodes the eleven scripts; a new
`test/browser-*.cjs` forgotten from the list silently never runs (nothing fails
like the `sw.js` SHELL test does for the frontend). Add a logic test asserting
every `test/browser-*.cjs` on disk is listed in the runner (and that
`browser-public.cjs` stays separate). (*Coverage review*)

### N2. Tighten the 2FA test helper
`enableTestFactor` in `two_factor_test.go` ignores `json.Unmarshal` errors; if
the response shape drifted, the failure message would be "no local setup QR"
rather than the actual body. Check the error, as the `req`-based helpers
elsewhere do. Several tests also ignore `e.s.db.Exec` results. (*Test quality*)

### N3. Tests that reach into internals
`TestTwoFactorWrongCodesStayLimitedAfterCorrectPasswords` flips
`e.s.cache.ok` and writes `instance_settings` directly with SQL; a handful of
tests seed tokens with raw `INSERT`s. Pragmatic and isolated, but each is
coupled to storage details. Prefer the `set()` helper where an equivalent
exists, and keep raw SQL for state *assertions* (where it shines). (*Test
quality*)

### N4. Frontend logic tests: real-time and date dependence
`model.test.mjs` uses `new Date()` indirectly via helpers; TOTP in
`browser-accounts.cjs` computes from `Date.now()` (safe with the server's ±1
step skew, but a test crossing a 30-second boundary against a server *without*
skew coverage would flake — worth a fixed-clock option in the harness if these
ever become flaky in CI). No action needed now; note for triage. (*Flakiness*)

### N5. Duplicate TOTP implementation in the browser test
Intentional (independent of the Go code — good), but it duplicates the
RFC-4226 truncation; a comment already exists in
`two_factor_test.go`'s spirit. Keep, but cross-reference the RFC vectors used
in `TestTOTPStandardVector` so both stay anchored. (*Test quality*)

### N6. `main()` and graceful shutdown are untestable as written
`main()` wires signal handling, `srv.Shutdown`, `serviceScheduler` and
`serviceJobs.Wait()` inline (0% covered). If startup/shutdown ordering ever
matters (it does: sessions and mail in flight), extract a `run(ctx)` function
so a test can drive one full start/stop cycle against a temp DB. (*Infrastructure*)

### N7. `adminUsage` (52.3%) and product-usage endpoints
The consent rules are well tested; the admin aggregation read/put paths are
only half covered. Low risk (no personal data, no writes beyond opt-out), so a
small table test over the JSON shape suffices. (*Coverage review*)

### N8. No coverage trend in CI
Not asking for a percentage gate (coverage is a vanity metric here), but a
per-file breakdown in the PR check would have flagged `security_accounts.go`
drifting to 46% before this audit. `go test -cover` is already installed;
publishing `go tool cover -func` output as a step summary is one line.
(*Infrastructure*)

### N9. Suite shape is good — keep it that way
Go tests average well under a second (slowest: 1.24 s limiter test); the
race run is 3 minutes; browser scenarios each own an isolated server and
database. Do not add sleeps or shared fixtures. The only shared mutable
globals are `bcryptCost` (set once in `TestMain`) and `userSeq` — both fine.
(*Infrastructure*)

---

## Top 10 tests to write first

Ordered by (risk of the code path) × (probability the regression ships
silently), using the mutation results as evidence:

1. **`TestDisableTwoFactorWipesSecretCodesChallengesAndOtherSessions`** (C1) —
   the only second-factor teardown path with zero coverage; mutation-confirmed
   silent failure. Include the wrong-code and no-partial-wipe variants.
2. **`TestRecoveryEmailChangeVerifiesSupersedesAndBindsToPassword`** (C2) —
   the recovery trust anchor: 0% on both the request and verify halves; a
   stale-link hijack would ship green.
3. **`TestResetTokenDiesWhenPasswordChangedMeanwhile`** (C4) — one small test,
   mutation-confirmed gap; sits naturally inside the existing recovery test.
4. **`TestAdminResetTwoFactorRefusesSelf` + happy-path Go port** (C3) — the
   HTTP handler is 0%; the CLI twin proves the assertions are easy to write.
5. **`TestPublicAuthWritesNeedTheHeaderAndSameSite`** (C5) — mutation-confirmed
   guard removal; table over register / forgot / reset / verify / two-step.
6. **`TestDuplicateRegistrationSendsNoMailAndStaysGeneric`** (C5) —
   mutation-confirmed enumeration/queue regression; assert the SMTP channel
   stays empty and responses are byte-identical.
7. **`TestRegenerateRecoveryCodesInvalidatesOldOnes`** (C1) — completes the
   recovery-code lifecycle alongside #1.
8. **`TestSchedulerStartupRecovery`** (H1) — crash recovery for mail and
   backup runs; needs a tiny factor-out of `serviceScheduler`'s prologue.
9. **`TestVerifyRefusesWhenRegistrationClosedAfterIssue` + pending-cap test**
   (C5) — the verify-time authorization gate and the mail-queue DoS cap.
10. **`TestChallengeLocksAfterFiveWrongCodes` +
    `TestSameCodeCannotBeUsedConcurrentlyTwice`** (H5) — the per-challenge
    attempt cap and the guarded-update race; best written with `-race` in mind.

Everything else in this file is real but secondary; items #1–#7 all live in
two files (`security_accounts.go`, `two_factor.go`) and reuse the existing
`newTestServer`/`fakeSMTP`/`enableTestFactor` fixtures, so the batch is a
day's work with the suite's current harness.