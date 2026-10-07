# The server treats records as opaque JSON that the frontend owns

Days, Plans, Episodes, settings and Tool records are stored as JSON bodies keyed by an allow-listed id. The server bounds their size and validates the fields it knows, but does not interpret them: the frontend owns their shape. No admin endpoint can read a body, so an Admin sees Account metadata only. The Backup is the single documented exception (`TestAdminCannotReadAnyonesLogs` guards the rest).

This keeps the privacy promise structural rather than a matter of discipline, and lets the frontend evolve record shapes (legacy fields are preserved) without a server migration for each. The cost is that server-side reporting or search over records is not possible, and shape rules live in two places (`validate.go` and the frontend). Reasoning inferred from the code and `CLAUDE.md`; the author should correct it.
