-- 050_bookwhen_import_dedupe.sql
-- Idempotency keys for the BookWhen importer, so a franchisee can re-run the
-- import (e.g. again on switchover morning to catch new bookings) without
-- creating duplicate courses or bookings.
--
-- BookWhen's EventID (one dated occurrence) and BookingID (one booking) are
-- globally unique and stable. We stamp them on import and skip anything already
-- present. The partial unique indexes make the de-dupe belt-and-braces at the DB
-- level (a concurrent re-run hits 23505 rather than double-inserting).

ALTER TABLE da_course_instances ADD COLUMN IF NOT EXISTS bookwhen_event_id TEXT;
ALTER TABLE da_bookings ADD COLUMN IF NOT EXISTS bookwhen_booking_id TEXT;

COMMENT ON COLUMN da_course_instances.bookwhen_event_id IS
  'BookWhen EventID this course was imported from (migration 050). NULL for courses created in-app.';
COMMENT ON COLUMN da_bookings.bookwhen_booking_id IS
  'BookWhen BookingID this booking was imported from (migration 050). NULL for bookings made in-app.';

-- One imported course per BookWhen event per franchisee; one imported booking
-- per BookWhen booking per franchisee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_course_instances_bw_event
  ON da_course_instances (franchisee_id, bookwhen_event_id)
  WHERE bookwhen_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_bw_booking
  ON da_bookings (franchisee_id, bookwhen_booking_id)
  WHERE bookwhen_booking_id IS NOT NULL;
