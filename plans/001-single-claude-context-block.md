# Plan 001: Keep one Zoomies block in Claude-loaded guidance

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 6ab9483..HEAD -- CLAUDE.md AGENTS.md agent_context_test.go`
> If any of these files changed since this plan was written, compare the
> excerpts and test behavior below against the live repository. On mismatch,
> stop and report.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `6ab9483`, 2026-10-20

## Why this matters

`go test ./...` currently fails because Claude Code loads the Zoomies block from
both `CLAUDE.md` and its imported `AGENTS.md`. This breaks the repository's Go
verification gate and lets the two copies drift. Keep `AGENTS.md` as the sole
location for the block; its text already tells agents where to read prepared
context when needed.

## Current state

- `CLAUDE.md` is Claude Code's entrypoint and imports `AGENTS.md`.
- `AGENTS.md` contains the canonical Zoomies block and directs agents to
  `.zoomies/AI_CONTEXT.md` when prepared context is needed.
- `agent_context_test.go` expands the `@AGENTS.md` import and verifies the
  loaded text contains exactly one start marker, end marker and heading.

Current `CLAUDE.md` excerpt:

```markdown
@AGENTS.md

<!-- zoomies-ai-context:start -->

## Zoomies AI Context

Before using prepared repository context, read `.zoomies/AI_CONTEXT.md`. It explains available access routes, revision checks and selective retrieval.

@.zoomies/AI_CONTEXT.md

<!-- zoomies-ai-context:end -->
```

Current `AGENTS.md` excerpt:

```markdown
<!-- zoomies-ai-context:start -->

## Zoomies AI Context

Before using prepared repository context, read `.zoomies/AI_CONTEXT.md`. It explains available access routes, revision checks and selective retrieval.

<!-- zoomies-ai-context:end -->
```

The relevant existing test is `TestClaudeCodeLoadsOneZoomiesBlock` in
`agent_context_test.go:13-34`. It specifically requires the `@AGENTS.md`
import to remain and the three markers to occur once in the loaded text.

Repository conventions: `CLAUDE.md` is a short loader, while `AGENTS.md` owns
the shared rules. Preserve this relationship. The contributor guide's Go
verification commands are `go test ./...` and `go test -race ./...`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused regression test | `go test ./... -run '^TestClaudeCodeLoadsOneZoomiesBlock$'` | Root package passes; no duplicate-block failure. |
| Go test suite | `go test ./...` | All Go packages pass. |
| Race suite | `go test -race ./...` | All Go packages pass with the race detector. |
| Frontend/doc formatting and logic | `npm ci --prefix test && npm --prefix test run check` | Install succeeds; Prettier, ESLint and frontend logic tests pass. |

## Scope

**In scope** (the only source file to modify):
- `CLAUDE.md`

**Out of scope**:
- `AGENTS.md` — canonical shared rules and the single allowed block.
- `.zoomies/AI_CONTEXT.md` — generated/prepared context; do not edit it.
- `agent_context_test.go` — the existing regression test already expresses the requirement.
- `.github/workflows/zoomies-ai-context.yml` and
  `zoomies-ai-context.config.json` — do not change managed generation settings.
- All application source, tests, and other documentation.

## Git workflow

No branch or commit convention is prescribed. Keep this to one logical change;
do not commit, push or open a PR unless the operator asks.

## Steps

### Step 1: Remove the duplicate block from `CLAUDE.md`

Delete the Zoomies block after `@AGENTS.md`, including the `@.zoomies/AI_CONTEXT.md`
line. Leave the heading, explanatory text and `@AGENTS.md` import intact. Do not
remove or edit the corresponding block in `AGENTS.md`; it is now the canonical
copy and already directs agents to read `.zoomies/AI_CONTEXT.md` when needed.

**Verify**: `go test ./... -run '^TestClaudeCodeLoadsOneZoomiesBlock$'` →
root package passes and the test reports no duplicate markers.

### Step 2: Run the repository checks

Run the full Go suite, race suite and frontend check. The frontend check requires
the locked development dependencies; install them with the command in the table.

**Verify**: `go test ./...` and `go test -race ./...` → all packages pass;
`npm ci --prefix test && npm --prefix test run check` → formatting, lint and
logic tests pass.

## Test plan

- No new test is needed. Use `TestClaudeCodeLoadsOneZoomiesBlock` in
  `agent_context_test.go` as the regression test; it fails on the current
  duplicate and checks that `@AGENTS.md` remains.
- Run `go test ./...` after the focused test to confirm the previously failing
  repository baseline is restored.

## Done criteria

- [ ] `CLAUDE.md` imports `AGENTS.md` and contains no duplicate Zoomies block.
- [ ] `go test ./... -run '^TestClaudeCodeLoadsOneZoomiesBlock$'` passes.
- [ ] `go test ./...` passes.
- [ ] `go test -race ./...` passes.
- [ ] `npm ci --prefix test && npm --prefix test run check` passes.
- [ ] Only `CLAUDE.md` is modified outside `plans/`.
- [ ] The status row for Plan 001 in `plans/README.md` is updated.

## STOP conditions

Stop and report instead of improvising if:

- `CLAUDE.md` no longer imports `AGENTS.md`, or the excerpt does not match.
- Removing the duplicate section would remove a rule that is absent from
  `AGENTS.md`; do not rewrite or duplicate shared instructions to compensate.
- The focused test still fails after removing the block. Do not weaken the test
  or edit the generated Zoomies context as a workaround.
- Passing the focused test requires changing any file outside this plan's scope.

## Maintenance notes

- Review future AI-context reinstalls to ensure they keep the block in
  `AGENTS.md` only. The Go test exists specifically to catch regressions.
- Preserve the `@AGENTS.md` import: removing it would bypass the shared
  contributor and safety guidance.
- The detailed prepared context remains at `.zoomies/AI_CONTEXT.md`; the
  canonical AGENTS block tells agents when to consult it.
