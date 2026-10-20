# Plan 003: Make pre-upgrade snapshots collision-safe

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6ab9483..HEAD -- db.go migrate_test.go`
> If either file changed since this plan was written, compare the excerpts below
> against the live code. On mismatch, stop and report.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-single-claude-context-block.md`
- **Category**: migration
- **Planned at**: commit `6ab9483`, 2026-10-20

## Why this matters

Before applying schema migrations, the server takes a consistent SQLite
snapshot so an upgrade failure does not leave the only database copy altered.
`snapshotBeforeMigrating` currently names the copy only to one-second
precision, before migration transactions serialize competing openers. Two
processes starting on a populated outdated database in the same second can
target the same destination; `VACUUM INTO` refuses an existing destination, so
one opener can fail before it reaches the migration lock. The fix must preserve
the guaranteed pre-upgrade copy and SQLite's intentional no-overwrite behavior.

## Current state

- `openDB` calls `migrate`; `migrate` reads `PRAGMA user_version`, checks the
  legacy-admin precondition, then snapshots before beginning each migration
  transaction (`db.go:73-83, 90-141`).
- Migration transactions re-read `user_version` after obtaining SQLite's
  transaction lock and skip a version another process already applied
  (`db.go:116-128`).
- Snapshot names currently use a timestamp formatted to seconds, while
  `snapshot` uses `VACUUM INTO` and refuses an existing destination
  (`db.go:156-191`).
- `legacyDB` in `migrate_test.go:16-47` builds a populated schema-v0 database.
  `TestMigrateAdoptsLegacyData` verifies its pre-upgrade copy, and
  `TestTwoProcessesMigrateTheSameDatabaseOnce` at `:302-327` tests concurrent
  opens only on a fresh database (which has no tables to snapshot).

Relevant current code:

```go
dest := filepath.Join(dir, fmt.Sprintf("pre-upgrade-v%d-%s.db", from, time.Now().Format("20060102-150405")))
if err := snapshot(db, dest); err != nil {
    return fmt.Errorf("backing up before upgrade: %w", err)
}
```

(`db.go:166-174`.) `snapshot` deliberately returns an error if
`VACUUM INTO` cannot create its destination and removes a partial result. Keep
that no-overwrite protection; make the destination unique before invoking it.

Repository constraints: SQLite is opened with a single connection per `*sql.DB`
and `_txlock=immediate` (`db.go:27, 42-47`). Do not use `s.db` while holding a
transaction on that same connection. Migrations are append-only; this plan must
not modify migration definitions or schema versions.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Deterministic name-collision regression | `go test ./... -run '^TestUniqueSnapshotDestinationsAtSameTimestamp$'` | Two reservations with the same timestamp return distinct, absent destinations. |
| Concurrent migration regression | `go test ./... -run '^TestConcurrentMigrationsWithPopulatedLegacyDatabase$' -count=10` | Ten runs pass; both openers succeed and a valid original snapshot is retained. |
| Snapshot/migration tests | `go test ./... -run 'Test(MigrateAdoptsLegacyData|MigrateIsIdempotent|ConcurrentMigrationsWithPopulatedLegacyDatabase|TwoProcessesMigrateTheSameDatabaseOnce)$'` | All focused migration tests pass. |
| Go suite | `go test ./...` | All Go packages pass. |
| Race suite | `go test -race ./...` | All packages pass with race detection. |

## Scope

**In scope**:
- `db.go`
- `migrate_test.go`

**Out of scope**:
- Migration functions, schema version values and database schema.
- `snapshot`'s guarantee that it will not overwrite an existing file.
- Backup retention/pruning policy, restore handlers, CLI behavior, and
  deployment settings.
- Adding OS-specific file-lock dependencies or cgo SQLite features.

## Git workflow

No branch or commit convention is prescribed. Keep the migration fix and its
regression test together; do not commit, push or open a PR unless asked.

## Steps

### Step 1: Add a deterministic snapshot-name regression

Add a helper with the explicit signature
`reserveSnapshotPath(dir string, from int, at time.Time) (string, error)` and a
test named `TestUniqueSnapshotDestinationsAtSameTimestamp`. The helper should
use `os.CreateTemp` to reserve a unique path matching
`pre-upgrade-v<from>-*.db`, then close and remove the placeholder so
`VACUUM INTO` can create the destination. The test should pass the same fixed
timestamp twice, assert the returned paths differ, and assert neither path
exists after reservation. This makes the collision regression deterministic
without sleeps or a probabilistic race. If closing or removing the placeholder
fails, remove it where possible and return the error; never leave an empty
snapshot file that could make a later `VACUUM INTO` fail.

**Verify**: `go test ./... -run '^TestUniqueSnapshotDestinationsAtSameTimestamp$'`
→ the new helper and its deterministic uniqueness test pass.

### Step 2: Use reserved paths for concurrent migrations

Add `TestConcurrentMigrationsWithPopulatedLegacyDatabase` to `migrate_test.go`.
Use `legacyDB` to create a schema-v0 database containing at least one document,
create one shared `seedAdmin`, and use a start channel/barrier so two goroutines
call `openDB(path, seed)` at nearly the same time. Collect and close both
successful database handles. Assert both opens return no error, the live
database reaches `len(migrations)`, and the legacy document remains available
after migration. Assert that at least one `pre-upgrade-v0-*.db` snapshot opens
and still has schema version 0 and the original document. Avoid asserting an
exact snapshot count: two competing openers may each safely create a copy.

Update `snapshotBeforeMigrating` to call `reserveSnapshotPath` before
`snapshot`. Preserve the directory's `0700` mode, snapshot file's `0600` mode,
error context, cleanup of partial snapshots, and the existing log message. Do
not change `snapshot` to overwrite files.

**Verify**: `go test ./... -run '^TestConcurrentMigrationsWithPopulatedLegacyDatabase$' -count=10`
→ all ten runs pass; both callers succeed and at least one untouched v0 snapshot
is present.

### Step 3: Verify existing migration behavior

Run the focused tests for legacy adoption, idempotence, and concurrent fresh
database migration, then the full Go and race suites.

**Verify**: the focused command in the table, then `go test ./...` and
`go test -race ./...` → all pass. Existing adoption still produces a snapshot
containing the legacy rows and schema version 0.

## Test plan

- Add a concurrent opener test for a populated outdated database to
  `migrate_test.go`, following `TestMigrateAdoptsLegacyData` and
  `TestTwoProcessesMigrateTheSameDatabaseOnce`.
- Add `TestUniqueSnapshotDestinationsAtSameTimestamp` for the reservation helper;
  this directly checks the collision case without depending on scheduler timing.
- Keep the existing `TestSnapshotIncludesRecentWritesAndKeepsSchemaVersion`
  and `TestMigrateIsIdempotent` passing; the first protects copy semantics and
  the second protects against unnecessary snapshots on a current database.
- Run the new test repeatedly with `-count=10`, then the focused migration
  tests, full Go suite and race suite.

## Done criteria

- [ ] Concurrent opens of a populated outdated database both succeed.
- [ ] Migration reaches the latest schema and preserves the original document.
- [ ] At least one valid pre-upgrade snapshot preserves the original schema and
  data.
- [ ] No snapshot silently overwrites an existing file; snapshot permissions
  and partial-file cleanup remain intact.
- [ ] Focused repeated migration tests, `go test ./...` and `go test -race ./...`
  pass.
- [ ] Only `db.go` and `migrate_test.go` are modified outside `plans/`.
- [ ] The status row for Plan 003 in `plans/README.md` is updated.

## STOP conditions

Stop and report instead of improvising if:

- A populated legacy database cannot be opened concurrently with the same
  admin seed, or the current migration lock behavior differs from the excerpts.
- SQLite requires changing `snapshot` to overwrite a path, or the proposed
  unique reservation cannot leave a nonexistent destination for `VACUUM INTO`.
- The implementation would require an OS-specific lock package, cgo, a schema
  change, or changing migration transactions.
- The regression cannot preserve at least one complete copy of the original
  schema and data.
- Existing migrations or current-schema startup behavior need to change to make
  the test pass.

## Maintenance notes

- Keep the migration transaction's version recheck: unique snapshots address
  file-name contention but do not replace database-level migration
  serialization.
- Review path permissions, cleanup and filename patterns together. A partial
  or world-readable safety copy is not acceptable.
- Later migrations must continue to be append-only and retain the automatic
  pre-upgrade snapshot guarantee.
