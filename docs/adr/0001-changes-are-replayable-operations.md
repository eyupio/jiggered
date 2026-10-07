# Changes are replayable operations, not whole-document overwrites

Several devices edit the same Account, some offline. Instead of "last write wins" on whole documents, the frontend queues each Change as an operation, saves with `If-Match: "<rev>"`, and on a 409 replays the queued operations on the server's current copy, so two devices merge. A Change that cannot be applied (same-field edit, deleted record) becomes a Held change rather than being lost or silently overwritten.

The cost is that every kind of edit has to be written as an operation that is safe to apply twice, and the server's revision numbers (including `doc_revs` for deleted records) must never be reused. Reasoning inferred from the code and `CLAUDE.md`; the author should correct it.

## Considered options

- Last write wins on whole documents: simpler, but offline edits on two devices silently overwrite each other, which is unacceptable for a health log.
