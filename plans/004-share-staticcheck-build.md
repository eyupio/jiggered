# Plan 004: Share the Go 1.27-compatible staticcheck build

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6ab9483..HEAD -- Makefile CONTRIBUTING.md .github/workflows/image.yml .github/scripts/build-staticcheck.sh`
> If any listed existing file changed since this plan was written, compare the
> excerpts below against the live files. On mismatch, stop and report.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/001-single-claude-context-block.md`
- **Category**: dx
- **Planned at**: commit `6ab9483`, 2026-10-20

## Why this matters

The Makefile tells contributors to install staticcheck with a plain
`go install`, but this repository's CI says the pinned staticcheck release
cannot read Go 1.27.2 export data with its pinned `x/tools`. CI works around
that by building the same staticcheck tag against `x/tools@v0.50.0`. A single
shared build script will keep local guidance and CI aligned and prevent a
contributor following `make check`'s error hint from installing an unusable
checker.

## Current state

- `Makefile:9-10` checks whether `staticcheck` is on `PATH`, suggests
  `go install honnef.co/go/tools/cmd/staticcheck@v0.8.1`, then runs it.
- `.github/workflows/image.yml:40-47` explains why plain installation is not
  enough and runs:

```sh
src="$(mktemp -d)"
git clone --quiet --depth 1 --branch v0.8.1 https://github.com/dominikh/go-tools.git "$src"
(cd "$src" && go get golang.org/x/tools@v0.50.0 && go build -o "$HOME/go/bin/staticcheck" ./cmd/staticcheck)
"$HOME/go/bin/staticcheck" ./...
```

- `CONTRIBUTING.md:93-104` lists `staticcheck ./...` and notes the required
  `x/tools` override, but does not give a reusable install command.
- CI runs this workflow on Go 1.27.2. Dependencies are pure Go; do not add a
  cgo dependency or make the runtime image depend on staticcheck.

Repository convention: `Makefile` collects local checks, CI uses
`.github/workflows/image.yml`, and `CONTRIBUTING.md` is the user-facing exact
setup/check guide. Keep the implementation in one shell script under
`.github/scripts/` and call it from both Makefile guidance and CI. Follow the
existing script convention in `.github/scripts/ghcr-prune.sh` for strict shell
mode and temporary-directory cleanup.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Script syntax | `bash -n .github/scripts/build-staticcheck.sh` | Exit 0 with no diagnostics. |
| Integrated Go checks | `set -euo pipefail; tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT; .github/scripts/build-staticcheck.sh "$tmp/staticcheck"; "$tmp/staticcheck" -version; go vet ./...; "$tmp/staticcheck" ./...; CGO_ENABLED=0 go build ./...; go test -race ./...` | Tool builds, prints its version, and every Go check exits 0. |
| Frontend check | `npm ci --prefix test && npm --prefix test run check` | Formatting, ESLint and frontend logic tests pass. |

The staticcheck build needs network access to clone the pinned source and
resolve Go modules. Keep all downloaded source/build changes in a temporary
directory; do not alter `go.mod` or `go.sum` in the application repository.

## Scope

**In scope**:
- `Makefile`
- `CONTRIBUTING.md`
- `.github/workflows/image.yml`
- New `.github/scripts/build-staticcheck.sh`

**Out of scope**:
- `go.mod`, `go.sum`, `staticcheck.conf`, Go application code and test logic.
- Changing staticcheck versions or the `x/tools` override without verifying
  that a newer release supports Go 1.27.2.
- Docker runtime image contents, CI action pins, and unrelated CI jobs.

## Git workflow

No branch or commit convention is prescribed. Keep this tooling alignment as
one logical change; do not commit, push or open a PR unless asked.

## Steps

### Step 1: Add a shared installer/build script

Create `.github/scripts/build-staticcheck.sh` with Bash strict mode. Require
one output-path argument, create its parent directory, create a temporary
source directory, and remove that temporary directory on exit. Clone
`https://github.com/dominikh/go-tools.git` at tag `v0.8.1` with a shallow clone;
in that temporary checkout, apply `go get golang.org/x/tools@v0.50.0` and build
`./cmd/staticcheck` to the requested output path. Do not run `go get` in this
repository, print credentials, or leave source artifacts behind. Set the new
script's executable bit because CI invokes it directly.

**Verify**: `bash -n .github/scripts/build-staticcheck.sh` → exit 0.

### Step 2: Use the script in CI and document the local invocation

Replace the duplicated inline clone/override/build block in
`.github/workflows/image.yml` with a call to the script writing to
`$HOME/go/bin/staticcheck`; retain the existing `staticcheck ./...` invocation.
Update `Makefile`'s missing-tool message to give the exact script invocation
and tell contributors to add `$HOME/go/bin` to `PATH`. Update
`CONTRIBUTING.md` near its verification commands with the same install command
and PATH note. Do not make `make check` silently download or install a tool.

**Verify**: inspect the three files and run
`git diff --check` → no whitespace errors in tracked changes; the old plain
`go install` hint is absent and CI calls the shared script. The new script's
syntax is checked separately in Step 1.

### Step 3: Build and verify the pinned analyzer

Run the temporary-output command in the Commands table. Then run the standard
Go and frontend checks. The Go suite requires Plan 001 to have restored the
passing baseline.

**Verify**: the integrated Go-check command and frontend command in the table
→ all exit 0.

## Test plan

- No new application unit test is required for the build wrapper. Validate
  shell syntax; the integrated Go-check command builds the script into a
  temporary output path, runs `-version`, and analyzes this repository.
- The script's output must analyze this repository without Go 1.27.2
  export-data errors.
- Verify the workflow, Makefile and contributor guide all call/document the
  same script and pinned versions; use `git diff --check` and `git diff` to
  review the result.

## Done criteria

- [ ] `.github/scripts/build-staticcheck.sh` builds tag `v0.8.1` against
  `golang.org/x/tools@v0.50.0` in a temporary checkout.
- [ ] The script leaves no clone or modified module files in the repository.
- [ ] CI uses the shared script, while still running `staticcheck ./...`.
- [ ] The Makefile error guidance and CONTRIBUTING setup instructions name the
  same invocation and PATH requirement.
- [ ] `bash -n`, temporary analyzer build/version/run, Go checks and
  `npm --prefix test run check` pass.
- [ ] Only the four in-scope paths are modified outside `plans/`.
- [ ] The status row for Plan 004 in `plans/README.md` is updated.

## STOP conditions

Stop and report instead of improvising if:

- CI no longer uses the `v0.8.1` and `x/tools@v0.50.0` combination shown above.
- Building that exact combination fails with Go 1.27.2, or the repository has
  adopted a supported staticcheck release since this plan was written. Do not
  silently change versions; report the evidence and request an updated plan.
- The build needs modifications to the application's `go.mod` or `go.sum`.
- The script cannot clean temporary files on success and failure, or it would
  install into the container/runtime image.
- CI's shell environment cannot execute a checked-in Bash script.

## Maintenance notes

- When staticcheck publishes a release that handles Go 1.27.2 without the
  override, update this script, CI and contributor instructions together after
  verifying that release.
- Keep the tool build separate from the application dependency graph and
  preserve the pure-Go runtime constraint.
- Review the temporary-directory trap, output path quoting, tag pin and
  x/tools version whenever the script changes.
