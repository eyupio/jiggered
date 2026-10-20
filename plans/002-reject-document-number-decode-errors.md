# Plan 002: Reject numeric decode failures in document validation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6ab9483..HEAD -- validate.go validate_test.go`
> If either file changed since this plan was written, compare the excerpts below
> against the live code. On mismatch, stop and report.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-single-claude-context-block.md`
- **Category**: bug
- **Planned at**: commit `6ab9483`, 2026-10-20

## Why this matters

`validateDoc` is the common validation boundary for saved records, imports and
Restore. It currently ignores errors while decoding day, plan and episode JSON
into Go values. An out-of-range numeric literal in an otherwise unknown field
can be accepted on import or Restore and stored as raw JSON; a browser may read
that number as `Infinity` and serialize it later as `null`. Refusing the decode
error protects round-tripping while preserving the ADR's rule that unknown,
representable fields remain opaque and unchanged.

## Current state

- `validate.go` first parses an object into `map[string]json.RawMessage`, then
  decodes non-settings, non-tool records into `map[string]any` and validates
  known fields.
- The current unchecked decode is:

```go
var value map[string]any
json.Unmarshal(raw, &value)
if err := validateRecordFields(value); err != nil {
    return err
}
```

  (`validate.go:30-34`.)
- `docs.go:471-475` uses `validateDoc` for import records. `restore.go:35-44`
  uses it to reject an entire Restore before writing anything.
- `putDoc` separately decodes a request body before calling `validateDoc`, so a
  numeric overflow sent by direct PUT may already be rejected there. Keep the
  shared validator correct for import and Restore as well.
- `validate_test.go` defines `invalidDocs` and
  `TestInvalidDocumentsAreRefusedEverywhere` (`:24-38`, `:79-103`). That test
  checks PUT, import, Restore and that refused data is not stored.

Repository design constraints from ADR 0002: the server validates fields it
knows but treats the record as opaque otherwise, and admin APIs must not expose
record bodies. This change must not normalise or rewrite accepted raw JSON.
Follow the existing validation style: return a concise error from
`validateDoc`; table-test boundary inputs in `validate_test.go`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Regression test | `go test ./... -run 'Test(InvalidDocumentsAreRefusedEverywhere|ValidDocumentsAreAcceptedEverywhereAndKeptAsSent)$'` | Both validation test groups pass, including numeric-overflow invalid cases. |
| Go suite | `go test ./...` | All Go packages pass. |
| Race suite | `go test -race ./...` | All Go packages pass with the race detector. |
| Go static analysis/build | `go vet ./... && staticcheck ./... && CGO_ENABLED=0 go build ./...` | All commands exit 0. |

## Scope

**In scope**:
- `validate.go`
- `validate_test.go`

**Out of scope**:
- `docs.go`, `restore.go` — both already call the shared validator.
- Frontend decoding or record migrations — reject unrepresentable input at the
  shared server validation boundary; do not rewrite stored records.
- `db.go`, migrations, admin endpoints, and exported document shape.

## Git workflow

No branch or commit convention is prescribed. Keep code and regression test in
one logical change; do not commit, push or open a PR unless asked.

## Steps

### Step 1: Add failing invalid-document cases

Add `invalidDocs` cases with a valid object containing a numeric literal outside
Go's `float64` range in an unknown extension field. Cover at least one Day ID
and one Episode ID so both `validateDayDoc` and the episode return path are
covered. Use the existing test harness rather than adding a new test function:
`TestInvalidDocumentsAreRefusedEverywhere` already asserts import counts the
record invalid, Restore returns 422, and nothing is stored. Direct PUT may
return 400 before the shared validator; preserve that accepted behavior.

**Verify**: `go test ./... -run '^TestInvalidDocumentsAreRefusedEverywhere$'`
→ the new cases fail because import accepts them or Restore does not reject
them. Do not proceed if the test does not expose the missing validation.

### Step 2: Return the JSON decode error

In `validateDoc`, check the error from `json.Unmarshal(raw, &value)` before
calling `validateRecordFields`. Return a client-safe validation error using the
existing error style. Do not use `UseNumber`, silently coerce the value, mutate
the `json.RawMessage`, or discard unknown representable fields.

**Verify**: `go test ./... -run 'Test(InvalidDocumentsAreRefusedEverywhere|ValidDocumentsAreAcceptedEverywhereAndKeptAsSent)$'`
→ both groups pass; invalid overflows are refused and valid extension fields
still round-trip unchanged.

### Step 3: Run full Go verification

Run the full Go tests, static analysis and pure-Go build after Plan 001 has
restored the suite baseline.

**Verify**: `go test ./... && go test -race ./... && go vet ./... && staticcheck ./... && CGO_ENABLED=0 go build ./...`
→ exit 0 for every command.

## Test plan

- Extend `invalidDocs` in `validate_test.go`; this is the established shared
  test table for document contract validation.
- Cover overflowing numbers inside an unknown property for both a Day and an
  Episode. The existing valid fixture with `futureField` and the test
  `TestValidDocumentsAreAcceptedEverywhereAndKeptAsSent` protect the opaque
  extension-field behavior.
- Run the focused invalid and valid test groups, then `go test ./...` and
  `go test -race ./...`.

## Done criteria

- [ ] `validateDoc` returns an error when decoding the raw non-settings/tool
  record into `map[string]any` fails.
- [ ] Import refuses both overflow fixtures and counts them invalid.
- [ ] Restore refuses the overflow fixtures without storing any record.
- [ ] Existing unknown-but-representable extension fields remain unchanged.
- [ ] Focused validation tests, full Go suite, race suite, vet, staticcheck and
  `CGO_ENABLED=0 go build ./...` pass.
- [ ] Only `validate.go` and `validate_test.go` are modified outside `plans/`.
- [ ] The status row for Plan 002 in `plans/README.md` is updated.

## STOP conditions

Stop and report instead of improvising if:

- The current validator or test table differs materially from the excerpts.
- A JSON number outside `float64` range is not reproducibly rejected by Go's
  `encoding/json` decode into `map[string]any`; do not invent a custom parser.
- The fix would reject ordinary unknown JSON fields or alter raw bodies that
  currently round-trip.
- Either Restore or import does not use `validateDoc` in the current code.
- The regression requires touching `docs.go`, `restore.go`, the frontend, or a
  database migration.

## Maintenance notes

- Future fields may remain opaque, but their JSON values must be representable
  by the browser and Go validation path to preserve round-tripping.
- Review new code that ignores `json.Unmarshal` errors at persistence
  boundaries. Keep error text free of record contents.
- ADR 0002's privacy boundary and no-admin-record-body rule remain unchanged.
