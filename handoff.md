# Handoff

## Objective

Ship the Impeccable critique fixes for the public landing, sign-in and account
recovery pages, and record the product and design context they build on.

## Current state

- Branch: `reet/jiggered-31a0ee07c50b43f98789d6b0426c4f93`
- PR: [#192](https://github.com/eyupio/jiggered/pull/192)
- Phase: implementation complete, local validation green, awaiting CI and review

## Completed

- `PRODUCT.md` records the product truth from `impeccable init`.
- `DESIGN.md` and `.impeccable/design.json` record the incumbent visual system
  from `impeccable document`.
- P1 contrast: `--field-line` is at least 3:1 in light and dark themes.
- P1 recovery: reset links name the masked account and hide the authenticator
  field unless two-step is on. `POST /api/auth/reset-info` answers without
  spending the link; the field reappears if the form cannot learn the state.
- Sign-in failures render server-side, so a no-JS sign-in explains itself.
- The help disclosure has a 44px target, "Join free" is in the mobile
  accessible name, and every auth control uses one focus ring.
- The auth aside carries product truth and follows the form being shown.
- Reset and verify screens name the account the link is for.
- Landing copy no longer says "you're on Today"; the trust list uses dividers
  instead of a nested card; print reveals are visible; `text-wrap: pretty`
  removes single-word last lines.
- A dark Today capture ships through `<picture>` for dark-mode visitors.

## Validation

- `go vet ./...`, `CGO_ENABLED=0 go build ./...`, `go test ./...` pass.
- `go test -race ./...` passes (148s).
- `npm --prefix test run check` passes (154 logic tests).
- `node test/browser-accounts.cjs` and `node test/browser-public.cjs` pass.
- Visual checks at 1440 and 390 in light and dark, including the mobile
  accessible name and the 44px help target.
- The design detector reports only raw-template false positives and pre-existing
  token advisories.

## Outstanding

- Merge this PR after CI is green.
- After merge, re-run `$impeccable critique` on `/welcome` and `/login` to
  confirm the score has moved.
- Verify links use the static "This link is for the account that requested it"
  sentence; a verify-token info endpoint was deliberately not added.

## Decisions and risks

- Reset info is a POST with the page header and same-origin checks and no public
  form budget, so reloading the link does not spend the attempts the real
  submission needs. The token is the capability; the response masks the address.
- The dark Today capture is 390×932 while the light capture is 390×850, so the
  hero is slightly taller in dark mode.
- The documented palette reflects the effective `dashboard.css`/`presence.css`
  theme; older teal tokens in `style.css` remain in the cascade but are
  overridden.
