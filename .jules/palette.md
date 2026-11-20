## 2026-11-19 - A toggle states its state once
**Learning:** The password Show/Hide button changed both its `aria-label` and `aria-pressed`, so a screen reader said "Hide password, pressed": two contradictory statements of one state.
**Action:** A toggle either keeps a fixed label and sets `aria-pressed`, or swaps its label and omits `aria-pressed`. Never both.
