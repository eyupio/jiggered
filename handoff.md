# Handoff

## Objective

Ship the signed-in critique fixes: Today's first run, the desktop energy sidebar,
the phone ordering and the follow-up polish.

## Current state

- Branch: `fix/signed-in-critique` (merged)
- PR: [#193](https://github.com/eyupio/jiggered/pull/193), squashed as `4f81a67`
- Phase: merged into `main` on 2026-11-24; all required checks passed

## Completed

- #192 (merged as `6a20c43`) recorded `PRODUCT.md`, `DESIGN.md` and
  `.impeccable/design.json`, and fixed the public landing, sign-in and recovery
  pages: field contrast, reset-link account and authenticator handling, no-JS
  sign-in errors, accessible targets and focus, landing copy, print reveals and
  a dark Today capture.
- Today's first-run setup is a compact two-step strip; the Green/Amber/Red
  check-in is on the first phone screen. Budget and wording moved to Account.
- The desktop Today sidebar no longer scrolls inside itself; its content scrolls
  with the page. The poor-sleep switch now sits in the check-in panel, and
  Starting, Used, Recovered and Remaining stay together.
- The phone timeline starts closed; "The little things in your day" follows the
  energy panel. Desktop still opens the timeline once there is something to draw.
- The energy summary uses the ledger's sign (`Net −2`), and the flow heading says
  "activity" for one.
- Browser tests cover the first-screen check-in, the closed phone timeline and
  the new picker-before-timeline order.

## Validation

- `npm --prefix test run check` passes (154 logic tests).
- The full browser suite passes (`npm --prefix test run browser`).
- Visual checks at 390×844, 320×700 and 1280×900 in light.
- The design detector reports only the side-tab treatment DESIGN.md specifies.

## Merge outcome

- PR #193 squashed into `main` as `4f81a67` on 2026-11-24.
- `test`, `browser`, `image`, CodeQL and the Codex review passed before merge.
- The remote branch was deleted after the merge.

## Outstanding

- Deferred by the critique scope: the seven-tab admin bar (P2) and the detached
  Episode symptom error (P2).
- The timeline palette remains for the tested drag and tap-to-place path; if it
  is removed later, update `test/browser-calendar.cjs`.

## Decisions and risks

- Chose to remove the sticky Today sidebar rather than compress the energy card;
  on a 900px desktop the ring starts below the fold, though the arithmetic stays
  together and the page scrolls normally.
- The phone timeline auto-opens only above 760px wide.
- Budget and points/spoons setup remain in Account; the first-run strip teaches
  only the two daily actions.
