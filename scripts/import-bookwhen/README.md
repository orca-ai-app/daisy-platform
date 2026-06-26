# BookWhen import (one-off, cutover)

Imports Daisy's historical bookings + customers from a BookWhen CSV export into
the platform, so nothing is lost when BookWhen is switched off. PRD §18.

**Status:** skeleton. The exact column mapping is finalised once Jenni provides
the real CSV export (see `docs/M3-client-questions-jenni.md`). Run ONCE against
production at cutover with the service role key.

## What it does

- Parses the BookWhen CSV.
- Upserts `da_customers` by email (name-only if the export lacks email/phone — a
  known BookWhen limitation flagged to Jenni).
- Links each booking to an existing `da_course_instances` row where matchable
  (by template + date + venue), or skips/reports if no match.
- Inserts `da_bookings`: `payment_status='paid'`, `booking_status='attended'`
  for past events / `'confirmed'` for future.
- Does NOT schedule any `da_email_sequences` for historical bookings (no
  retrospective journeys).

## Run

```bash
# Dry run (default — parses + reports, writes nothing):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node import.mjs path/to/bookwhen.csv

# Real run (writes to the DB):
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node import.mjs path/to/bookwhen.csv --commit
```

Always dry-run first and eyeball the report (row counts, unmatched courses,
customers missing contact details) before `--commit`.
