## 2026-11-13 - Exempt panels need their own write guard
**Finding:** The read-only tab guard in `app.js` lets everything inside `#history-panel` through so the tab can browse and export, which also lets the episode Delete button reach `store.dispatch`. That throws in a read-only tab or during a restore, and nothing caught it: the click did nothing and said nothing.
**Learning:** The global capture-phase guard only protects panels it does not exempt. A write inside an exempt panel has to handle the store's refusal itself.
**Prevention:** When a handler in an exempt panel (or any new one) calls `store.dispatch`, catch the error and toast its message, as `history.js` now does. Check the `safe` selector list in `app.js` when adding a write control.
